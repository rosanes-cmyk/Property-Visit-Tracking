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
    const lastRun = text.split(/^==== /m).pop() || '';
    /*
     * Did the last sweep FINISH, or merely run?
     *
     * The file's timestamp says when something last wrote to it, which is not the same thing at all — a
     * sweep that opened REI, found itself logged out and failed on all twelve leads writes to the log at
     * that moment and looks, from the timestamp alone, like a sweep that finished seconds ago.
     *
     * A screenshot caught exactly that: the page said "REI swept 0 min ago — the card can post" directly
     * beside a red tile reading "REI: Logged out". Reporting freshness nothing earned is the specific
     * mistake this whole feature was built to stop, so the two facts are kept apart.
     */
    const finished = /Bucket sweep finished/.test(lastRun);
    const failed = /LOGGED OUT|COULD NOT BE READ/i.test(lastRun);
    const at = fs.statSync(path.join(LOGS, 'bucket-task.log')).mtimeMs;
    return { at: new Date(at).toISOString(), minutes: Math.round((Date.now() - at) / 60000),
      lastStamp: stamps[stamps.length - 1] || '', finished, failed };
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
 * One self-contained file. No CDN, no web fonts, no build step — a page that needs the internet to render is
 * a page that fails on the morning somebody most wants to know whether the automation is alive.
 *
 * DARK ONLY, at the client's instruction: "i need professional look and black theme not white."
 *
 * The first version followed prefers-color-scheme, which is usually the considerate choice and was wrong
 * here: it meant the page was white on any PC with Windows in light mode, so what the theme looked like
 * depended on a setting nobody had thought about. `color-scheme: dark` is declared too, so the scrollbars
 * and any native control match the page instead of staying light against it.
 */
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Twin Visit Logger — is it working?</title>
<style>
  /*
   * Four surface levels rather than two. A flat panel on a flat background gives no sense of what contains
   * what, which is most of what makes a dark interface look amateur — the page reads as a list of boxes
   * instead of a hierarchy. Backdrop, card, raised, and hairline borders that are lighter than the card but
   * darker than the text.
   */
  :root{
    color-scheme: dark;
    --backdrop:#080a0d; --card:#111419; --raise:#171b22; --line:#232833; --line-soft:#1a1f28;
    --ink:#eef1f5; --dim:#98a3b5; --faint:#66707f;
    --ok:#3ddc97; --warn:#f7c948; --bad:#ff6b6b; --idle:#5a6472; --accent:#5b9dff;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6);
  }
  *{box-sizing:border-box}
  html,body{background:var(--backdrop)}
  body{margin:0;color:var(--ink);padding:26px 24px 40px;
       font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       -webkit-font-smoothing:antialiased;
       /* Numbers line up in columns: counts, times and progress all sit in tabular positions. */
       font-variant-numeric:tabular-nums}
  .wrap{max-width:1180px;margin:0 auto}

  /* ---- header ---- */
  header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
         padding-bottom:14px;margin-bottom:20px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:baseline;gap:10px}
  h1{font-size:15px;font-weight:600;letter-spacing:-.01em;margin:0}
  .tag{font-size:11px;color:var(--faint);letter-spacing:.02em}
  .meta{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dim)}
  /*
   * A pulsing dot, because a page that refreshes silently every three seconds is indistinguishable from a
   * frozen one — which on a "is it working" screen is the worst possible ambiguity to introduce.
   */
  .pulse{width:6px;height:6px;border-radius:50%;background:var(--ok);
         box-shadow:0 0 0 0 rgba(61,220,151,.55);animation:p 2.4s ease-out infinite}
  @keyframes p{0%{box-shadow:0 0 0 0 rgba(61,220,151,.5)}70%{box-shadow:0 0 0 7px rgba(61,220,151,0)}
               100%{box-shadow:0 0 0 0 rgba(61,220,151,0)}}
  .stale .pulse{background:var(--bad);animation:none}

  /* ---- banners ---- */
  .banner{display:flex;gap:11px;background:var(--card);border:1px solid var(--line);
          border-left:2px solid var(--warn);border-radius:8px;padding:12px 14px;margin-bottom:10px;
          font-size:13.5px;color:var(--ink);box-shadow:var(--shadow)}
  .banner.bad{border-left-color:var(--bad)}
  .banner.info{border-left-color:var(--accent)}
  /*
   * A CSS dot, not an emoji.
   *
   * The first version used ⏸ / ⚠️ / 🔴 / 💤, and a screenshot showed the pause glyph rendering as an empty
   * box — one font away from a monitoring page that looks broken. Mixed emoji also read as less finished than
   * a consistent shape. The dot takes its colour from the banner's severity, so it cannot disagree with the
   * border beside it, and there is no font to be missing.
   */
  .banner .ico{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--warn);
               margin-top:7px}
  .banner.bad .ico{background:var(--bad)}
  .banner.info .ico{background:var(--accent)}
  .banner b{font-weight:600}
  .banner code{background:var(--raise);border:1px solid var(--line);border-radius:4px;
               padding:1px 5px;font-size:12px;font-family:ui-monospace,Consolas,monospace;color:var(--ink)}

  /* ---- status tiles ---- */
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(216px,1fr))}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:15px 16px 16px;
        box-shadow:var(--shadow);position:relative;overflow:hidden}
  /* A hairline of the status colour along the top edge — readable at a glance, without shouting. */
  .tile::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:var(--line)}
  .tile.s-ok::before{background:var(--ok)} .tile.s-warn::before{background:var(--warn)}
  .tile.s-bad::before{background:var(--bad)} .tile.s-idle::before{background:var(--idle)}
  .tile h2{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
           color:var(--faint);margin:0 0 9px}
  .val{font-size:17px;font-weight:600;letter-spacing:-.015em;line-height:1.25;
       display:flex;align-items:center;gap:8px;min-height:22px}
  .val .dot{width:7px;height:7px;border-radius:50%;flex:0 0 7px}
  .s-ok .dot{background:var(--ok)} .s-warn .dot{background:var(--warn)}
  .s-bad .dot{background:var(--bad)} .s-idle .dot{background:var(--idle)}
  .sub2{color:var(--dim);font-size:12.5px;margin-top:7px;line-height:1.45}
  .sub2 b{color:var(--ink);font-weight:600}
  .sub2 code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--ink)}
  .bar{height:3px;background:var(--line-soft);border-radius:2px;overflow:hidden;margin-top:12px}
  .bar > i{display:block;height:100%;background:var(--ok);transition:width .45s ease}
  .s-warn .bar > i{background:var(--warn)}

  /* ---- activity ---- */
  .panel{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-top:12px;
         box-shadow:var(--shadow);overflow:hidden}
  .panel > h2{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
              color:var(--faint);margin:0;padding:14px 16px 11px;border-bottom:1px solid var(--line-soft)}
  ul{list-style:none;margin:0;padding:4px 0}
  li{display:flex;gap:14px;padding:7px 16px;font-size:13px;align-items:baseline}
  li + li{border-top:1px solid var(--line-soft)}
  li time{color:var(--faint);flex:0 0 58px;font-size:12px}
  li .txt{color:var(--dim)}
  li .txt b{color:var(--ink);font-weight:500}
  li.k-warn .txt b{color:var(--warn)} li.k-error .txt b{color:var(--bad)}
  .empty{color:var(--faint);padding:14px 16px;font-size:13px}
  footer{color:var(--faint);font-size:11.5px;margin-top:18px;text-align:center}
</style></head><body>
<div class="wrap">
  <header id="head">
    <div class="brand"><h1>Twin Visit Logger</h1><span class="tag">automation monitor</span></div>
    <div class="meta"><span class="pulse"></span><span id="meta">connecting…</span></div>
  </header>
  <div id="banners"></div>
  <div class="grid" id="cards"></div>
  <div class="panel"><h2>Recent activity</h2><ul id="feed"></ul>
    <div class="empty" id="feedEmpty" style="display:none">Nothing yet — the first run will appear here.</div>
  </div>
  <footer>Refreshes every 3 seconds · this page is only reachable from this PC</footer>
</div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock = (iso) => { try { return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch { return ''; } };
const mins = (n) => n == null ? '' : (n < 60 ? n + ' min ago' : Math.round(n/60) + ' h ago');

function tile(label, state, value, detail, extra) {
  return '<div class="tile s-' + state + '"><h2>' + esc(label) + '</h2>'
    + '<div class="val"><span class="dot"></span>' + esc(value) + '</div>'
    + (detail ? '<div class="sub2">' + detail + '</div>' : '')
    + (extra || '') + '</div>';
}

function render(s) {
  $('meta').textContent = 'live · ' + s.machine + ' · ' + clock(s.now);
  $('head').classList.remove('stale');

  /* Banners are things that need DOING, ordered by what blocks what. */
  const banners = [];
  /* level: 'info' (deliberate state), 'warn' (worth knowing), 'bad' (nothing works until somebody acts) */
  const add = (level, html) => banners.push({ level, html });
  if (s.paused) add('info', '<b>Paused.</b> Nothing is running on its own. Run <code>scripts\\\\resume.cmd</code> to start again.');
  if (s.rei && s.rei.ok === false) add('bad', '<b>REI is logged out.</b> Nothing can be checked until somebody signs in — run <code>scripts\\\\login-rei.cmd</code> on this PC.');
  if (s.beat.state === 'stuck') add('warn', '<b>Possibly stuck.</b> The ' + esc(s.beat.name) + ' has not reported for ' + Math.round(s.beat.silentFor/60000) + ' minutes.');
  if (s.beat.state === 'died') add('warn', '<b>A run stopped without finishing.</b> The next scheduled one picks up where it left off — nothing is lost.');
  if (s.lock && s.lock.held && !s.lock.alive) add('warn', '<b>A lock was left behind</b> by a run that died ' + s.lock.ageMinutes + ' minutes ago. It clears itself after 30.');
  if (s.sheet && s.sheet.settingsPublished && s.sheet.activeMachine && s.sheet.activeMachine !== s.sheet.thisMachine)
    add('info', '<b>This PC is on standby.</b> "' + esc(s.sheet.activeMachine) + '" is the active one, so nothing runs here. To move it: <code>scripts\\\\make-this-pc-active.cmd</code>');
  if (s.sheetError) add('warn', 'Could not read the workbook just now — ' + esc(s.sheetError));
  $('banners').innerHTML = banners.map(b =>
    '<div class="banner ' + b.level + '"><span class="ico"></span><span>' + b.html + '</span></div>').join('');

  const cards = [];

  /* NOW — the question the whole page exists to answer, so it comes first and gets the progress bar. */
  const b = s.beat;
  if (b.state === 'running' || b.state === 'stuck') {
    const pct = b.total ? Math.round(100 * b.index / b.total) : 0;
    cards.push(tile('Now', b.state === 'stuck' ? 'warn' : 'ok', b.name,
      esc(b.phase) + (b.item ? ' · <b>' + esc(b.item) + '</b>' : '')
        + (b.total ? ' <span style="color:var(--faint)">(' + b.index + ' of ' + b.total + ')</span>' : ''),
      b.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : ''));
  } else if (b.state === 'idle') {
    cards.push(tile('Now', 'idle', 'Idle',
      b.summary ? 'Last run: ' + esc(b.name) + ' — <b>' + esc(b.summary) + '</b>'
                : 'Waiting for the next scheduled run.'));
  } else if (b.state === 'died') {
    cards.push(tile('Now', 'bad', 'Run stopped', 'It was the ' + esc(b.name) + '. The next one carries on.'));
  } else {
    cards.push(tile('Now', 'idle', 'Nothing yet', 'The first scheduled run will show up here.'));
  }

  /* REI */
  const r = s.rei || {};
  cards.push(tile('REI', r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'idle',
    r.ok === true ? 'Signed in' : r.ok === false ? 'Logged out' : 'Unknown',
    r.ok === false ? 'Run <code>scripts\\\\login-rei.cmd</code> on this PC.'
      : r.ok === true ? 'Last confirmed ' + clock(r.at) : esc(r.why || '')));

  /* Queued */
  if (s.sheet) {
    cards.push(tile('Queued', s.sheet.pending ? 'warn' : 'ok',
      s.sheet.pending ? s.sheet.pending + ' waiting' : 'Nothing waiting',
      s.sheet.pending
        ? 'Booking(s) typed on the board, waiting on REI. Usually done within 2 minutes.'
        : '<b>' + s.sheet.rows + '</b> leads on the board · <b>' + s.sheet.withLink + '</b> with a REI link to check'));
  } else {
    cards.push(tile('Queued', 'idle', '—', 'Could not read the workbook.'));
  }

  /* Work-queue card — the same freshness fact the Chat card refuses to post without. */
  const sw = s.sweep;
  /*
   * A sweep only counts if it FINISHED. "Something wrote to the log 30 seconds ago" is not the same claim,
   * and conflating them is how this tile once read "the card can post" beside "REI: Logged out".
   */
  const fresh = sw && sw.finished && !sw.failed && sw.minutes <= 90;
  /* Value is just the time: the label already says what it is, and "Next at 9am tomorrow" wrapped. */
  cards.push(tile('Next work-queue card', fresh ? 'ok' : 'warn', s.card.in,
    !sw ? 'No sweep has run yet on this PC.'
      : sw.failed ? 'The last sweep <b>could not read REI</b> — the card will hold, then post saying the data may be out of date.'
      : !sw.finished ? 'The last sweep <b>did not finish</b> — the card will wait for one that does.'
      : fresh ? 'REI swept <b>' + mins(sw.minutes) + '</b> — the card can post'
      : 'REI last swept <b>' + mins(sw.minutes) + '</b> — the card will wait for a fresh sweep before posting'));

  /* This PC */
  if (s.sheet && s.sheet.settingsPublished) {
    const mine = s.sheet.activeMachine === s.sheet.thisMachine;
    cards.push(tile('This PC', mine ? 'ok' : 'warn', mine ? 'Active' : 'Standby',
      mine ? 'The machine that runs everything.'
           : '<b>' + esc(s.sheet.activeMachine || 'nobody') + '</b> is active.'));
  }

  $('cards').innerHTML = cards.join('');

  const feed = s.activity || [];
  $('feedEmpty').style.display = feed.length ? 'none' : '';
  $('feed').innerHTML = feed.map(a => {
    /* Bold the part before the em dash: the subject reads first, the outcome second. */
    const parts = String(a.text || '').split(' — ');
    const head = esc(parts.shift());
    const tail = parts.length ? ' — ' + esc(parts.join(' — ')) : '';
    return '<li class="k-' + esc(a.kind || 'info') + '"><time>' + clock(a.at) + '</time>'
      + '<span class="txt"><b>' + head + '</b>' + tail + '</span></li>';
  }).join('');
}

async function tick() {
  try {
    const r = await fetch('/api');
    render(await r.json());
  } catch (e) {
    /*
     * The server is gone. Say so on the page rather than freezing on stale numbers — a monitor showing
     * two-minute-old figures as though they were current is worse than one admitting it lost contact.
     */
    $('head').classList.add('stale');
    $('meta').textContent = 'lost contact — close this window and run dashboard.cmd again';
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
