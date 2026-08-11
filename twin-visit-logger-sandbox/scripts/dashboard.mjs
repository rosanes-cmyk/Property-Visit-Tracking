/**
 * The app's own dashboard: what is running, what is queued, and whether it is actually working.
 *
 *   node scripts/dashboard.mjs            then open http://127.0.0.1:7777
 *   node scripts/dashboard.mjs --port 8080
 *
 * WHY
 *
 * The client: "add a dashboard in the app what leas is working qhat quett and if the procerss is loading
 * for nureture to be tright treavk know its wroking."
 *
 * The last four words are the requirement. Before this, the only windows in were `status.cmd` — a snapshot
 * of Windows scheduled-task metadata — and log files nobody opens. Neither answers "is it working?", and
 * the two states that matter most look identical from outside: a job wedged on one lead, and a job with
 * nothing to do, are both silence.
 *
 * TWO CHOICES WORTH DEFENDING
 *
 * Bound to 127.0.0.1, never 0.0.0.0. This page shows seller names, addresses and REI state. On 0.0.0.0 it
 * would be readable by anything else on the office wifi, with no password, and the project's own rule is
 * that seller data does not leave the machine. Localhost-only means the person at the PC, and nobody else.
 *
 * Sheet reads are CACHED for a minute. The page refreshes every three seconds; asking Google for queue
 * counts each time would burn quota to redraw a number that changes a few times an hour — and quota
 * exhausted by a dashboard would break the automation the dashboard is there to watch.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readHeartbeat, readActivity, JOB_NAMES, STUCK_AFTER_MS } from '../src/utils/heartbeat.mjs';

const args = process.argv.slice(2);
const portArg = (() => {
  const i = args.indexOf('--port');
  const n = i >= 0 ? Number.parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : 7777;
})();

const DATA = path.resolve('./data');
const LOGS = path.resolve('./logs');

/* ------------------------------------------------------------------ gathering */

/** The run lock, and whether whoever holds it still exists. */
function lockState() {
  try {
    const raw = fs.readFileSync(path.join(DATA, 'run.lock'), 'utf8');
    const pid = Number(/(\d+)/.exec(raw)?.[1]);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (e) { alive = e?.code === 'EPERM'; }
    const age = Date.now() - fs.statSync(path.join(DATA, 'run.lock')).mtimeMs;
    return { held: true, pid, alive, ageMinutes: Math.round(age / 60000) };
  } catch {
    return { held: false };
  }
}

/**
 * Whether REI is signed in, judged from the last sweep's log rather than by opening a browser.
 *
 * Opening REI to check would be the obvious approach and it is the wrong one: it takes the run lock, drives
 * a second browser on the same profile, and is therefore the exact collision that logs REI out. A dashboard
 * must never be able to cause the failure it reports.
 */
function reiState() {
  for (const file of ['bucket-task.log', 'recheck-task.log', 'fill-pending.log']) {
    try {
      const text = fs.readFileSync(path.join(LOGS, file), 'utf8');
      const tail = text.slice(-20000);
      const runs = tail.split(/^==== /m);
      const last = runs[runs.length - 1] || '';
      if (/LOGGED OUT/i.test(last)) return { ok: false, why: 'REI is logged out', from: file };
      if (/lead\(s\) to re-check|on the 3pm card|Nothing is due/.test(last)) {
        return { ok: true, from: file, at: fs.statSync(path.join(LOGS, file)).mtime.toISOString() };
      }
    } catch { /* no such log yet */ }
  }
  return { ok: null, why: 'no run has reported yet' };
}

/** When the bucket sweep last finished, from its own log — the same fact the Chat card gates on. */
function lastSweep() {
  try {
    const text = fs.readFileSync(path.join(LOGS, 'bucket-task.log'), 'utf8').slice(-40000);
    const stamps = [...text.matchAll(/^==== (.+?) ====$/gm)].map((m) => m[1]);
    const finished = /Bucket sweep finished/.test(text.split(/^==== /m).pop() || '');
    const at = fs.statSync(path.join(LOGS, 'bucket-task.log')).mtimeMs;
    return { at: new Date(at).toISOString(), minutes: Math.round((Date.now() - at) / 60000),
      lastStamp: stamps[stamps.length - 1] || '', finished };
  } catch {
    return null;
  }
}

/** The next Chat card, from the same three hours Apps Script uses. */
function nextCard() {
  const HOURS = [9, 11, 16];
  const now = new Date();
  for (const h of HOURS) {
    if (now.getHours() < h) return { in: `${h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`, hour: h };
  }
  return { in: '9am tomorrow', hour: 9 };
}

/*
 * Sheet-derived counts, cached. Read lazily and never on the critical path: if Google is unreachable the
 * page still renders everything local, with the queue section saying it could not look rather than the
 * whole dashboard failing.
 */
let sheetCache = { at: 0, data: null, error: '' };
const SHEET_CACHE_MS = 60 * 1000;

async function sheetSnapshot() {
  if (Date.now() - sheetCache.at < SHEET_CACHE_MS) return sheetCache;
  sheetCache = { ...sheetCache, at: Date.now() };
  try {
    const { config } = await import('../src/config.mjs');
    const { authorizeGoogle } = await import('../src/google/auth.mjs');
    const { google } = await import('googleapis');
    const { readAgentSettings, SETTING, machineName } = await import('../src/google/agent-settings.mjs');
    const auth = await authorizeGoogle();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${config.trackerSheet}!A1:CZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    const grid = res.data.values || [];
    const headers = (grid[0] || []).map((h) => String(h).trim());
    const col = (name) => headers.indexOf(name);
    const addressAt = col('Property Address');
    const rows = grid.slice(1).filter((r) => r[addressAt]);

    const pending = rows.filter((r) => String(r[addressAt] || '').startsWith('PENDING REI LOOKUP —')).length;
    const linkAt = col('REI BlackBook Link');
    const withLink = rows.filter((r) => String(r[linkAt] || '').trim()).length;

    let active = '';
    let settingsPublished = false;
    try {
      const settings = await readAgentSettings(sheets, config.spreadsheetId);
      if (settings) { settingsPublished = true; active = settings.get(SETTING.activeMachine) || ''; }
    } catch { /* leave blank */ }

    sheetCache = {
      at: Date.now(), error: '',
      data: {
        title: config.trackerSheet, rows: rows.length, pending, withLink,
        activeMachine: active, thisMachine: machineName(), settingsPublished
      }
    };
  } catch (error) {
    sheetCache = { at: Date.now(), data: sheetCache.data, error: error.message };
  }
  return sheetCache;
}

async function snapshot() {
  const beat = readHeartbeat();
  const sheet = await sheetSnapshot();
  return {
    now: new Date().toISOString(),
    machine: os.hostname(),
    beat: { ...beat, name: JOB_NAMES[beat.job] || beat.job || '' },
    stuckAfterMinutes: Math.round(STUCK_AFTER_MS / 60000),
    lock: lockState(),
    rei: reiState(),
    sweep: lastSweep(),
    card: nextCard(),
    paused: fs.existsSync(path.join(DATA, 'PAUSED')),
    sheet: sheet.data,
    sheetError: sheet.error,
    activity: readActivity(25)
  };
}

/* ---------------------------------------------------------------------- page */

/*
 * One self-contained file. No CDN, no fonts, no build step — a page that needs the internet to render is a
 * page that fails on the morning somebody most wants to know whether the automation is alive.
 */
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Twin Visit Logger — is it working?</title>
<style>
  :root{--bg:#0f1115;--card:#181c23;--line:#262c36;--ink:#e8ebf0;--dim:#93a0b4;
        --ok:#3ecf8e;--warn:#f5c451;--bad:#ff6b6b;--idle:#6b7789}
  @media(prefers-color-scheme:light){
    :root{--bg:#f4f6f9;--card:#fff;--line:#e2e7ee;--ink:#161a20;--dim:#5c6a7d;--idle:#8b98a9}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:18px}
  h1{font-size:17px;margin:0 0 2px}
  .sub{color:var(--dim);font-size:13px;margin-bottom:16px}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));max-width:1100px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
  .card h2{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0 0 8px}
  .big{font-size:19px;font-weight:600;display:flex;align-items:center;gap:8px}
  .note{color:var(--dim);font-size:13px;margin-top:6px}
  .dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px}
  .ok{background:var(--ok)}.warn{background:var(--warn)}.bad{background:var(--bad)}.idle{background:var(--idle)}
  .bar{height:5px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:10px}
  .bar > i{display:block;height:100%;background:var(--ok);transition:width .4s}
  .wide{grid-column:1/-1;max-width:1100px}
  ul{list-style:none;margin:0;padding:0}
  li{display:flex;gap:9px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}
  li:last-child{border-bottom:0}
  time{color:var(--dim);flex:0 0 66px;font-variant-numeric:tabular-nums}
  .pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--dim)}
  a{color:inherit}
  .banner{background:var(--card);border:1px solid var(--warn);border-left:3px solid var(--warn);
          border-radius:8px;padding:11px 13px;margin-bottom:12px;max-width:1100px;font-size:14px}
</style></head><body>
<h1>Twin Visit Logger</h1>
<div class="sub" id="sub">connecting…</div>
<div id="banners"></div>
<div class="grid" id="cards"></div>
<div class="card wide" style="margin-top:12px">
  <h2>Recent activity</h2>
  <ul id="feed"><li>…</li></ul>
</div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock = (iso) => { try { return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch { return ''; } };
const mins = (n) => n == null ? '' : (n < 60 ? n + ' min ago' : Math.round(n/60) + ' h ago');

function card(title, dot, big, note, extra) {
  return '<div class="card"><h2>' + esc(title) + '</h2><div class="big">'
    + (dot ? '<span class="dot ' + dot + '"></span>' : '') + esc(big) + '</div>'
    + (note ? '<div class="note">' + note + '</div>' : '') + (extra || '') + '</div>';
}

function render(s) {
  $('sub').textContent = s.machine + ' · refreshed ' + clock(s.now);

  /* Banners are for things that need doing, in the order they block each other. */
  const banners = [];
  if (s.paused) banners.push('<b>PAUSED.</b> Nothing is running on its own. Run <code>scripts\\\\resume.cmd</code> to start again.');
  if (s.rei.ok === false) banners.push('<b>REI is logged out.</b> Nothing can be checked until you sign in — run <code>scripts\\\\login-rei.cmd</code>.');
  if (s.beat.state === 'stuck') banners.push('<b>Possibly stuck.</b> The ' + esc(s.beat.name) + ' has not reported for ' + Math.round(s.beat.silentFor/60000) + ' minutes.');
  if (s.beat.state === 'died') banners.push('<b>A run stopped without finishing.</b> The next scheduled one will pick up where it left off — nothing is lost.');
  if (s.lock.held && !s.lock.alive) banners.push('<b>A lock was left behind</b> by a run that died (' + s.lock.ageMinutes + ' min ago). It clears itself after 30 minutes.');
  if (s.sheet && s.sheet.settingsPublished && s.sheet.activeMachine && s.sheet.activeMachine !== s.sheet.thisMachine)
    banners.push('<b>This PC is on standby.</b> "' + esc(s.sheet.activeMachine) + '" is the active one, so nothing runs here. To move it: <code>scripts\\\\make-this-pc-active.cmd</code>');
  if (s.sheetError) banners.push('Could not read the workbook just now: ' + esc(s.sheetError));
  $('banners').innerHTML = banners.map(b => '<div class="banner">' + b + '</div>').join('');

  const cards = [];

  /* NOW — the question the whole page exists to answer. */
  if (s.beat.state === 'running' || s.beat.state === 'stuck') {
    const pct = s.beat.total ? Math.round(100 * s.beat.index / s.beat.total) : 0;
    cards.push(card('Now', s.beat.state === 'stuck' ? 'warn' : 'ok', s.beat.name,
      esc(s.beat.phase) + (s.beat.item ? ' — <b>' + esc(s.beat.item) + '</b>' : '')
        + (s.beat.total ? ' (' + s.beat.index + ' of ' + s.beat.total + ')' : ''),
      s.beat.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : ''));
  } else if (s.beat.state === 'idle') {
    cards.push(card('Now', 'idle', 'Idle',
      s.beat.summary ? 'Last: ' + esc(s.beat.name) + ' — ' + esc(s.beat.summary) : 'Waiting for the next scheduled run.'));
  } else if (s.beat.state === 'died') {
    cards.push(card('Now', 'bad', 'A run stopped', 'It was ' + esc(s.beat.name) + '. The next one carries on.'));
  } else {
    cards.push(card('Now', 'idle', 'Nothing reported yet', 'The first scheduled run will show up here.'));
  }

  /* REI */
  cards.push(card('REI', s.rei.ok === true ? 'ok' : s.rei.ok === false ? 'bad' : 'idle',
    s.rei.ok === true ? 'Signed in' : s.rei.ok === false ? 'Logged out' : 'Unknown',
    s.rei.ok === false ? 'Run <code>scripts\\\\login-rei.cmd</code> on this PC.'
      : s.rei.ok === true ? 'Last confirmed ' + clock(s.rei.at) : esc(s.rei.why || '')));

  /* Queue */
  if (s.sheet) {
    cards.push(card('Queued', s.sheet.pending ? 'warn' : 'ok',
      s.sheet.pending ? s.sheet.pending + ' waiting' : 'Nothing waiting',
      s.sheet.pending
        ? 'Booking(s) typed on the board, waiting for REI. Usually done within 2 minutes.'
        : s.sheet.rows + ' leads on the board · ' + s.sheet.withLink + ' have a REI link to check'));
  } else {
    cards.push(card('Queued', 'idle', '—', 'Could not read the workbook.'));
  }

  /* Freshness — the same fact the Chat card refuses to post without. */
  const sw = s.sweep;
  cards.push(card('Work-queue card', sw && sw.minutes <= 90 ? 'ok' : 'warn',
    'Next at ' + s.card.in,
    sw ? ('REI last swept ' + mins(sw.minutes)
          + (sw.minutes > 90 ? ' — the card will wait for a fresh sweep before it posts' : ' — the card can post'))
       : 'No sweep has run yet on this PC.'));

  /* This PC */
  if (s.sheet && s.sheet.settingsPublished) {
    const mine = s.sheet.activeMachine === s.sheet.thisMachine;
    cards.push(card('This PC', mine ? 'ok' : 'warn', mine ? 'Active' : 'Standby',
      mine ? 'This is the machine that runs everything.'
           : '"' + esc(s.sheet.activeMachine || 'nobody') + '" is active.'));
  }

  $('cards').innerHTML = cards.join('');

  $('feed').innerHTML = (s.activity || []).length
    ? s.activity.map(a => '<li><time>' + clock(a.at) + '</time><span>'
        + (a.kind === 'warn' ? '⚠️ ' : a.kind === 'error' ? '❌ ' : '')
        + esc(a.text) + '</span></li>').join('')
    : '<li><span class="pill">nothing yet — the first run will appear here</span></li>';
}

async function tick() {
  try {
    const r = await fetch('/api');
    render(await r.json());
  } catch (e) {
    $('sub').textContent = 'The dashboard stopped — close this window and run scripts\\\\dashboard.cmd again.';
  }
}
tick();
setInterval(tick, 3000);
</script></body></html>`;

/* -------------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  if (req.url === '/api') {
    let body;
    try {
      body = JSON.stringify(await snapshot());
    } catch (error) {
      /*
       * Even the snapshot failing must not take the page down — it renders whatever it received last and
       * says so. A blank screen is the one thing a "is it working?" page must never show.
       */
      body = JSON.stringify({ now: new Date().toISOString(), machine: os.hostname(),
        beat: { state: 'unknown' }, lock: {}, rei: { ok: null, why: error.message },
        card: nextCard(), activity: [], sheetError: error.message });
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});

/*
 * If the port is taken, try the next few rather than dying.
 *
 * Double-clicking dashboard.cmd twice is the obvious thing to do when the first window is behind another,
 * and "EADDRINUSE" in a console that then closes is indistinguishable from the feature being broken.
 */
function listen(port, attemptsLeft) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} is busy — trying ${port + 1}`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.log(`\n  Could not start the dashboard: ${error.message}`);
    process.exit(1);
  });
  /*
   * 127.0.0.1 explicitly. On 0.0.0.0 this page — seller names, addresses, REI state — would be readable by
   * anything else on the office wifi with no password at all.
   */
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Twin Visit Logger dashboard:  http://127.0.0.1:${port}`);
    console.log('\n  Leave this window open while you watch it. Closing it only closes the dashboard —');
    console.log('  the automation keeps running on its own either way.\n');
  });
}

listen(portArg, 8);
