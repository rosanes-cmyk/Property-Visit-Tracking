/**
 * The heartbeat and the app's own dashboard — "know its wroking".
 *
 *   node tests/dashboard.test.mjs
 *
 * The client: "add a dashboard in the app what leas is working qhat quett and if the procerss is loading
 * for nureture to be tright treavk know its wroking."
 *
 * The whole feature exists to separate two states that are indistinguishable from outside: a job wedged on
 * one lead, and a job with nothing to do. Both are silence. So most of what is tested here is the telling
 * apart — and the rule that telemetry must never be able to break the thing it is watching.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const SANDBOX = path.resolve('twin-visit-logger-sandbox');
const read = (p) => fs.readFileSync(path.join(SANDBOX, p), 'utf8');

/*
 * The module writes to ./data relative to CWD, so the tests run from a scratch directory. Without this they
 * would stamp over a real heartbeat on a developer's machine — and on the client's PC, a test run would tell
 * the dashboard a job was in progress that was not.
 */
const HERE = process.cwd();
const SCRATCH = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'hb-test-'));
process.chdir(SCRATCH);

const HB = await import(
  new URL('../twin-visit-logger-sandbox/src/utils/heartbeat.mjs', import.meta.url).href
);

console.log('=== running, idle, stuck, died — the four states ===');
{
  HB.beginJob('bucket-sweep', { total: 12, phase: 'opening REI' });
  let beat = HB.readHeartbeat();
  check('a started job reads as running', beat.state, 'running');
  check('...and carries its total', beat.total, 12);

  HB.updateJob({ phase: 'reading REI', item: 'Marlene Ruiz', index: 4, total: 12 });
  beat = HB.readHeartbeat();
  check('progress names the lead', beat.item, 'Marlene Ruiz');
  check('...and how far through', [beat.index, beat.total], [4, 12]);
  /*
   * updateJob must PRESERVE startedAt. It reads the file rather than taking a start time, because a caller
   * in the middle of a loop that had to carry it would eventually forget — and the elapsed clock would
   * silently reset on every lead, making a two-hour hang look like it began seconds ago.
   */
  check('...without losing when the job started', typeof beat.startedAt, 'string');

  HB.endJob({ summary: '12 checked, 3 updated' });
  beat = HB.readHeartbeat();
  check('a finished job reads as idle', beat.state, 'idle');
  /*
   * Marked done rather than deleted. A missing file cannot say whether the last run finished cleanly or was
   * killed — and "the last sweep ended at 8:52 having checked 12" is exactly what somebody wants to see when
   * nothing is running.
   */
  check('...and keeps what it did, so an idle screen still says something', beat.summary, '12 checked, 3 updated');
}
{
  /*
   * DIED, not stuck. A run that was Ctrl+C'd or crashed leaves a heartbeat that simply stops updating, which
   * looks identical to a hang from timestamps alone. Whether the process still exists is the only reliable
   * answer — the same lesson the run lock learned when a dead run held it for thirty minutes.
   */
  const beatFile = path.join(SCRATCH, 'data', 'heartbeat.json');
  const beat = JSON.parse(fs.readFileSync(beatFile, 'utf8'));
  fs.writeFileSync(beatFile, JSON.stringify({ ...beat, done: false, pid: 999999 }));
  check('an unfinished job whose process is gone reads as died', HB.readHeartbeat().state, 'died');
}
{
  const beatFile = path.join(SCRATCH, 'data', 'heartbeat.json');
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(beatFile, JSON.stringify({
    job: 'bucket-sweep', pid: process.pid, startedAt: old, updatedAt: old, done: false, item: 'Pam Long'
  }));
  check('a live process that has gone quiet reads as stuck', HB.readHeartbeat().state, 'stuck');
  /*
   * SIX minutes, raised from three after it cried wolf on the client's first morning: "Possibly stuck. The
   * REI sweep has not reported for 3 minutes" — on a sweep that was working and finished shortly after.
   *
   * Three was reasoned from how long a lead USUALLY takes (20-40s), which is the wrong number. The beat is
   * written once per lead, so the gap between beats is the WORST case for one lead, and that is bounded by
   * the timeouts: a 45s page timeout, plus the one retry an empty scrape is given, plus opening the Tasks
   * panel — over two minutes before anything has actually gone wrong.
   *
   * A monitor that reports healthy work as broken is worse than one that says nothing, because it teaches
   * the reader to ignore it.
   */
  check('...after six minutes', HB.STUCK_AFTER_MS, 6 * 60 * 1000);
}
{
  fs.rmSync(path.join(SCRATCH, 'data', 'heartbeat.json'));
  check('no heartbeat at all is "unknown", not idle', HB.readHeartbeat().state, 'unknown');
}

console.log('\n--- telling alive from dead ---');
check('this process is alive', HB.pidAlive(process.pid), true);
check('a made-up pid is not', HB.pidAlive(999999), false);
check('pid 0 is not treated as a process', HB.pidAlive(0), false);
/*
 * EPERM means the process EXISTS but belongs to somebody else. Reading that as dead would report every run
 * started by another Windows user as a crash.
 */
check('a permissions error is read as alive, not dead',
  /error\?\.code === 'EPERM'/.test(read('src/utils/heartbeat.mjs')), true);

console.log('\n=== the activity feed ===');
{
  for (let i = 0; i < 5; i++) HB.recordActivity(`thing ${i}`, { kind: 'ok' });
  const feed = HB.readActivity(10);
  check('five events are kept', feed.length, 5);
  check('newest first', feed[0].text, 'thing 4');
  HB.recordActivity('a warning', { kind: 'warn' });
  check('the kind survives', HB.readActivity(1)[0].kind, 'warn');
}
{
  /* Trimmed on WRITE, never by a scheduled job — a rotation that never fires is how a disk fills up. */
  for (let i = 0; i < 250; i++) HB.recordActivity(`bulk ${i}`);
  const lines = fs.readFileSync(path.join(SCRATCH, 'data', 'activity.jsonl'), 'utf8')
    .split('\n').filter(Boolean);
  check('the feed is capped', lines.length, HB.ACTIVITY_KEEP ?? 200);
  check('...keeping the newest', HB.readActivity(1)[0].text, 'bulk 249');
}
{
  /* A half-written last line — a crash mid-append — must not take the whole feed down. */
  fs.appendFileSync(path.join(SCRATCH, 'data', 'activity.jsonl'), '{"at":"broken');
  check('a truncated line is skipped, not thrown', HB.readActivity(3).length > 0, true);
}

console.log('\n=== telemetry may never break the run ===');
/*
 * Rule one, and the reason every function here is wrapped. A heartbeat is telemetry: if the disk is full,
 * or a virus scanner has the file locked, or the folder vanished, the REI sweep must carry on regardless.
 * A monitoring feature that can break the thing it monitors is worse than no monitoring.
 */
{
  const dir = path.join(SCRATCH, 'data');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(dir, 'not a directory');        // makes every write under it fail
  let threw = null;
  try {
    HB.beginJob('recheck');
    HB.updateJob({ item: 'x' });
    HB.endJob({ summary: 'y' });
    HB.recordActivity('z');
    HB.readActivity(5);
    HB.readHeartbeat();
  } catch (e) { threw = e.message; }
  check('nothing throws when the data folder cannot be written', threw, null);
  fs.rmSync(dir, { force: true });
}

process.chdir(HERE);
fs.rmSync(SCRATCH, { recursive: true, force: true });

console.log('\n=== every job reports itself ===');
/*
 * A feed that only shows the jobs that CHANGED something cannot answer "is it working". The notes audit
 * finding nothing wrong is the normal outcome, and without a line for it a job that silently stopped weeks
 * ago looks identical to a job finding nothing to fix.
 */
for (const [file, job] of [
  ['scripts/recheck-rei.mjs', 'the REI sweep'],
  ['scripts/fill-pending-rei.mjs', 'the board intake'],
  ['src/run-once.mjs', 'the email intake'],
  ['scripts/audit-notes.mjs', 'the notes audit']
]) {
  const src = read(file);
  check(`${job} reports to the dashboard`, /beginJob\(|recordActivity\(/.test(src), true);
}
{
  const RECHECK = read('scripts/recheck-rei.mjs');
  check('the sweep beats once per lead', /updateJob\(\{\s*\n?\s*phase: 'reading REI'/.test(RECHECK), true);
  /*
   * endJob in the FINALLY. Otherwise a crashed sweep reads as "running" until the next one starts — and the
   * two states this feature exists to distinguish are precisely "working" and "stuck".
   */
  const fin = RECHECK.lastIndexOf('} finally {');
  check('...and marks itself finished even if it threw', RECHECK.indexOf('endJob(', fin) > fin, true);
  const FILL = read('scripts/fill-pending-rei.mjs');
  check('the board intake does the same', FILL.indexOf('endJob(', FILL.lastIndexOf('} finally {')) > 0, true);

  /*
   * ONE ROW MUST NOT KILL THE BATCH.
   *
   * The client's board showed a booking stuck at "Still not finished — 206m" while the run reported "0
   * finished, 0 could not be looked up" every two minutes. Neither zero was a skip — every skip path in that
   * loop counts. The run was THROWING partway through the row, after REI had been read, leaving the loop
   * through its finally with nothing counted and nothing written.
   *
   * The consequence matters more than the cause: everything queued behind it was never reached either. One
   * row carrying a value the sheet's validation rejects — the documented failure here, where a single bad
   * cell fails the ENTIRE row write — would silently stall every booking after it. On a busy morning that is
   * the whole board.
   */
  check('each row is wrapped so one failure cannot stall the rest',
    /ONE ROW MUST NOT BE ABLE TO KILL THE BATCH/.test(FILL), true);
  check('...a failed row is counted, not silently dropped',
    /FAILED on this row: \$\{error\.message\}[\s\S]{0,300}?stuck \+= 1;/.test(FILL), true);
  check('...and keeps its placeholder so the next run retries it',
    /It keeps its placeholder and the next run will try again/.test(FILL), true);
  /*
   * And the summary counts rows it never reached at all, by arithmetic rather than a flag on each branch —
   * a flag can be forgotten by a path added later, which is how this stayed invisible for hours.
   */
  check('rows never reached are reported',
    /const unaccounted = Math\.max\(0, pending\.length - filled - stuck\);/.test(FILL), true);
  check('...and named as such in the summary', /NOT REACHED/.test(FILL), true);
}
{
  /*
   * A STUCK CARD SHOWS WHAT THE LOOKUP FOUND, not what the card guesses.
   *
   * Kyle Flores's card read "Most often REI has signed itself out — run 1 - Sign in to REI" for eleven
   * days while the row beside it held the real finding: "The REI page did not finish loading, so the
   * address could not be read." REI was signed in throughout, so the one action the card kept asking for
   * could never have helped.
   *
   * fill-pending writes its finding into Exception Reason on every attempt. Nothing displayed it — the
   * pending branch returns before the line that shows r.exception on an ordinary card. Twice now the fix
   * for a wrong hint has been to write a better hint; the fix is to stop guessing when there is an answer.
   */
  const DASH = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');
  check('a stuck card prefers the reason written on the row',
    /\? \(String\(r\.exception\|\|''\)\.replace\(\/\\s\*\\\[since \[\^\\\]\]\*\\\]\\s\*\/, ' '\)\.trim\(\)/.test(DASH),
    true);
  check('...escaped, because it is text from a sheet', /\? esc\(String\(r\.exception\)/.test(DASH), true);
  // The guess survives for the one case where it is all anybody has: nothing written yet.
  check('...and the guess remains as the fallback',
    /: 'The office PC does this, and it has not\./.test(DASH), true);
  /*
   * The stamp is machinery, not a sentence: pendingSince() reads the clock out of it. Printing it would
   * put "[since 2026-09-04T22:23:06.876Z]" on a card somebody reads at a front door.
   */
  check('the [since ...] stamp is stripped before display',
    (DASH.match(/replace\(\/\\s\*\\\[since \[\^\\\]\]\*\\\]\\s\*\//g) || []).length >= 2, true);
}
{
  /*
   * THE LAYOUT THINGS THAT ONLY BREAK ON SOMEBODY ELSE'S SCREEN.
   *
   * Both were measured rather than argued about, and neither shows up in the window a person writing the
   * CSS happens to have open.
   */
  const DASH = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');
  const cssRaw = DASH.slice(DASH.indexOf('<style>'), DASH.indexOf('</style>'));
  /*
   * COMMENT-STRIPPED, and this file has now made that mistake itself. The check below forbids
   * overflow-wrap:anywhere — and failed on the comment ABOVE the fix, which names the property in order
   * to explain why it is gone. An assertion decided by prose is decided by nothing.
   */
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  /*
   * 1. THE SECONDARY TEXT SCALE. --faint measured 2.85:1 on --surface against a 4.5:1 requirement, and it
   *    was not decoration: the sub-label under every KPI number, the "no rows" line, empty fields in the
   *    detail panel, the pagination gaps. This board is read on a phone outside a house.
   */
  const tone = (name) => (css.match(new RegExp(`--${name}:(#[0-9a-f]{6})`, 'i')) || [])[1];
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const surface = tone('surface');
  for (const name of ['ink', 'muted', 'faint']) {
    const r = ratio(tone(name), surface);
    check(`--${name} clears WCAG AA on --surface (${r.toFixed(2)}:1)`, r >= 4.5, true);
  }
  // ...and the two secondary tones stay far enough apart to still mean different things.
  check('--muted and --faint remain visibly different',
    lum(tone('muted')) / lum(tone('faint')) > 1.3, true);

  /*
   * 2. THE STICKY STACK. Three bars pinned at top:0 / 45px / 93px, which assumes bars that never change
   *    height — while the tab row and the alert ribbon both wrap, and below 640px the ribbon takes a line
   *    of its own. The filter row then sat on top of the tabs.
   */
  check('the stacked bars offset from measured heights, not fixed pixels',
    /top:calc\(var\(--h-appbar\) \+ var\(--h-subbar\)\)/.test(css), true);
  check('...and no bar is pinned to a hardcoded offset again',
    /position:sticky;\s*top:\s*\d+px/.test(css.replace(/top:0/g, '')), false);
  check('something actually measures them', /new ResizeObserver\(apply\)/.test(DASH), true);
  check('...and there is a first-frame fallback before it runs',
    /--h-appbar:\d+px/.test(css), true);

  // A phone's home indicator sits over the bottom 34px; the booking button was half under it.
  check('the FAB clears the home indicator',
    /bottom:calc\(22px \+ env\(safe-area-inset-bottom/.test(css), true);

  /*
   * 3. THE CARD HEADER THAT READ DOWNWARDS.
   *
   * It rendered "F u l t o n ,  J o e" one character per line. The cause was overflow-wrap:anywhere,
   * added in the previous commit to stop a long address widening a card.
   *
   * `anywhere` and `break-word` wrap identically. They differ in one place: `anywhere` also counts those
   * break points when the browser computes MIN-CONTENT width, so the name block's minimum became one
   * character — while the status chips next to it are white-space:nowrap and therefore demand their full
   * text. Flex honoured both and gave the name the single character it had said it could live in.
   *
   * Nothing about the declaration looks wrong, which is why it is asserted rather than remembered.
   */
  check('no element offers to shrink to one character', /overflow-wrap:\s*anywhere/.test(css), false);
  check('...long text still wraps, the safe way', /overflow-wrap:break-word/.test(css), true);
  /*
   * min-width:0 is the other half. A flex item defaults to min-width:auto and refuses to shrink below its
   * content, so without this the name block cannot give way at all and pushes the chips off the card.
   */
  check('the name block can shrink inside its flex row', /\.card \.top>div\{flex:1 1 170px;min-width:0\}/.test(css), true);
  check('...and the row wraps instead of crushing it', /\.card \.top\{display:flex;[^}]*flex-wrap:wrap/.test(css), true);
  // A nowrap chip that cannot shrink is what dictated the row in the first place.
  for (const chip of ['chipstage', 'chipflag']) {
    check(`.${chip} gives way rather than dictating the row`,
      new RegExp(`\\.${chip}\\{[^}]*flex:0 1 auto;min-width:0`).test(css.replace(/\n\s*/g, '')), true);
  }
}
{
  /*
   * THE BOARD IS A WORK QUEUE, AND RED HAS TO MEAN SOMETHING.
   *
   * The card grid stopped working at this volume: 57 SLA breaches and 60 overdue, four cards to a screen,
   * every one of them red, each carrying seven pieces of metadata at equal weight. The client's verdict was
   * blunt and correct. Nothing on it answered "where do I start", which is the only question a queue has.
   *
   * These are RUN, not matched against source, because the whole point is which rows come out coloured.
   */
  const DASH = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');
  const grab = (name) => {
    const i = DASH.indexOf(`function ${name}(`);
    let depth = 0;
    for (let k = DASH.indexOf('{', i); k < DASH.length; k += 1) {
      if (DASH[k] === '{') depth += 1;
      else if (DASH[k] === '}') { depth -= 1; if (!depth) return DASH.slice(i, k + 1); }
    }
    throw new Error(`${name} not found`);
  };
  const api = new Function(
    ['esc', 'money', 'sellerLink', 'actionsFor', 'qAge', 'qWhy', 'rowHTML', 'sev'].map(grab).join('\n')
    + '; return { rowHTML, qWhy, qAge, sev };'
  )();

  /*
   * sev() returned 'crit' for anything with daysOverdue > 0. Sixty leads are overdue, so every card was
   * red — a severity applied to everything is a severity applied to nothing.
   */
  check('an ordinary overdue lead is amber, not red', api.sev({ daysOverdue: 46 }), 'warn');
  check('an SLA breach is amber too — there are 57 of them', api.sev({ sla: 'No contact 48h+' }), 'warn');
  check('a double booking IS red', api.sev({ daysOverdue: 46, conflict: true }), 'crit');
  check('so is a price gap', api.sev({ gap: 40000 }), 'crit');
  check('so is a row the automation could not parse', api.sev({ dq: 'Exception' }), 'crit');
  check('a healthy lead gets no colour at all', api.sev({ stage: 'Offer Sent' }), '');

  /*
   * And the reason line agrees with the stripe. It did not: qWhy called an SLA breach 'crit' while sev()
   * called it 'warn', which would have repainted the entire SLA section red from the other direction.
   */
  for (const [label, rec] of [['overdue', { daysOverdue: 46, sla: 'x' }], ['conflict', { conflict: true }],
    ['gap', { gap: 1 }], ['clean', { next: 'Call Thursday' }]]) {
    check(`the reason dot matches the severity on a ${label} row`, api.qWhy(rec)[0], api.sev(rec));
  }

  /*
   * ONE reason, chosen by what somebody would act on first. The card listed every badge it had, so a lead
   * with a breach, a gap and a blocker gave the eye three starting points and no ranking.
   */
  check('the worst reason wins',
    api.qWhy({ conflict: true, gap: 5, sla: 'x', blocker: 'Title' })[1], 'Double-booked');
  // The [since ...] stamp is machinery; it must not reach a row somebody reads.
  check('the parked stamp is stripped from the reason',
    /\[since/.test(api.qWhy({ exception: 'No address in REI. [since 2026-09-04T22:23:06.876Z]' })[1]), false);

  console.log('\n--- nothing was hidden to make room ---');
  /*
   * The detail panel carries Delete/Edit/Close and NONE of the stage actions, so moving them behind it to
   * save a column would have cost real work. Every button that was on the card is on the row.
   */
  const rec = { rowNum: 7, seller: 'Antoine Moore', address: '3275 Dakota St, Oakland, CA 94602',
    owner: 'Juan', daysOverdue: 46, offer: 550000, sla: 'Offer decision overdue',
    stage: 'Visit Completed — Needs Review', rei: 'https://my.reiblackbook.com/contacts/1' };
  const html = api.rowHTML(rec);
  for (const act of ['nurture', 'recordOfferSent', 'setNextAction']) {
    check(`${act} is still one click away`, html.includes(`data-act="${act}"`), true);
  }
  check('...and so is the full record', html.includes('data-detail="7"'), true);
  check('...and the REI link', html.includes('reiblackbook.com/contacts/1'), true);
  // Age is one right-aligned number, which is the entire reason for a column.
  check('age renders as a single figure', /<span class="qage hot">46d<\/span>/.test(html), true);
  check('a lead that is not overdue shows its due date instead',
    api.qAge({ due: '2026-09-20' })[0].includes('2026-09-20'), true);
}
{
  const AUDIT = read('scripts/audit-notes.mjs');
  /*
   * The QUIET path matters more than the busy one. "Nothing to correct" is the normal result and the whole
   * evidence the job is alive, and it sits behind an early process.exit(0) that a naive implementation would
   * never reach.
   */
  const quiet = AUDIT.indexOf('No lead\\\'s notes contradict its status');
  const exit = AUDIT.indexOf('process.exit(0)', quiet);
  check('the notes audit reports even when it finds nothing',
    AUDIT.indexOf('recordActivity(', quiet) > 0 && AUDIT.indexOf('recordActivity(', quiet) < exit, true);
}
{
  /*
   * The intake does NOT beat per run. It fires every two minutes with nothing to do, so a beat per run would
   * rewrite the file 720 times a day to say "idle" — and would overwrite a genuinely interesting beat from a
   * sweep that was still going.
   */
  const ONCE = read('src/run-once.mjs');
  check('the intake does not beat per lead', /updateJob\(/.test(ONCE), false);
  /* Matched across the comment's line wrap — a fixed phrase breaks the moment a sentence is re-flowed. */
  check('...and says why', /720 times a day to say "idle"/.test(ONCE), true);
}

console.log('\n=== the dashboard itself ===');
{
  const DASH = read('scripts/dashboard.mjs');
  /*
   * 127.0.0.1, never 0.0.0.0. This page shows seller names, addresses and REI state; on 0.0.0.0 it would be
   * readable by anything else on the office wifi with no password at all.
   */
  check('it listens on localhost only', /server\.listen\(port, '127\.0\.0\.1'/.test(DASH), true);
  /*
   * Asserted on the CALL, not on the string: the file names 0.0.0.0 in the comment explaining why it is not
   * used, so a bare search for the text fails on a file that is correct — and would push somebody to delete
   * the explanation to make the test pass.
   */
  check('...and never binds to all interfaces', /listen\([^)]*0\.0\.0\.0/.test(DASH), false);
  check('...and the reason is written down', /readable by\s*\n? \* anything else on the office wifi/.test(DASH), true);
  /*
   * It must NOT check REI by opening REI. That would take the run lock and drive a second browser on the
   * same profile — the exact collision that logs REI out. A dashboard that can cause the failure it reports
   * is worse than no dashboard.
   */
  check('it never opens a browser to check REI', /launchReiContext|chromium|playwright/i.test(DASH), false);
  check('...it reads the last run\'s log instead', /LOGGED OUT/.test(DASH), true);
  check('...and says why it does not look directly', /the exact collision that logs REI out/.test(DASH), true);
  /* Sheet reads are cached: the page polls every 3s and quota spent here would break the automation. */
  check('sheet reads are cached', /SHEET_CACHE_MS = 60 \* 1000/.test(DASH), true);
  check('a sheet failure still renders the page', /sheetError/.test(DASH), true);
  /* Self-contained: a page needing the internet fails on the morning somebody most wants to check. */
  check('no external assets', /https?:\/\/(?!127\.0\.0\.1)[a-z]/.test(DASH.split('const PAGE =')[1] || ''), false);
  /* Double-clicking twice is the obvious thing to do; EADDRINUSE in a window that closes looks broken. */
  check('a busy port is retried, not fatal', /EADDRINUSE/.test(DASH), true);
  check('it never writes to the sheet', /values\.update|values\.append|batchUpdate/.test(DASH), false);
  /* It reports the pause and the standby state, because both explain "why is nothing happening". */
  check('it shows when the automation is paused', /s\.paused/.test(DASH), true);
  check('it shows when this PC is on standby', /This PC is on standby/.test(DASH), true);
  check('it shows whether the card can post', /the card will wait for a fresh sweep/.test(DASH), true);

  /*
   * THE BUG A SCREENSHOT CAUGHT, and the reason this section exists.
   *
   * Freshness was taken from the log FILE'S TIMESTAMP, which says when something last wrote to it — not
   * that a sweep succeeded. A sweep that opened REI, found itself logged out and failed on all twelve leads
   * writes to the log at that moment, so the tile read "REI swept 0 min ago — the card can post" directly
   * beside a red tile reading "REI: Logged out".
   *
   * Reporting freshness that nothing earned is the exact mistake the check-first work was built to stop, so
   * "it ran" and "it finished" are now separate facts and the tile needs both.
   */
  check('a sweep only counts as fresh if it FINISHED',
    /const fresh = sw && sw\.finished && !sw\.failed && sw\.minutes <= 90;/.test(DASH), true);
  check('...and "finished" is read from the log, not from its timestamp',
    /const finished = \/Bucket sweep finished\/\.test\(lastRun\);/.test(DASH), true);
  check('...with a failed sweep detected separately',
    /const failed = \/LOGGED OUT\|COULD NOT BE READ\/i\.test\(lastRun\);/.test(DASH), true);
  check('a failed sweep is described as failed, not as fresh',
    /The last sweep <b>could not read REI<\/b>/.test(DASH), true);
  check('...and an unfinished one says so too',
    /The last sweep <b>did not finish<\/b>/.test(DASH), true);
  /* Only the LAST run block is examined: an earlier success must not vouch for a later failure. */
  check('only the most recent run is judged', /text\.split\(\/\^==== \/m\)\.pop\(\)/.test(DASH), true);

  console.log('\n--- the theme is committed, not inherited from Windows ---');
  /*
   * The client: "i need professional look and black theme not white." The first version followed
   * prefers-color-scheme, which is usually the considerate choice and was wrong here — the page was white on
   * any PC with Windows in light mode, so the theme depended on a setting nobody had thought about.
   */
  check('dark is declared, not conditional', /color-scheme: dark/.test(DASH), true);
  /*
   * Asserted on the MEDIA QUERY, not the phrase: the file names prefers-color-scheme in the comment saying
   * why it is not used. A bare text search fails on a correct file and pushes the next person to delete the
   * explanation to get a green run — which is the opposite of what a test should encourage.
   */
  check('...and there is no light-mode override',
    /@media\s*\(\s*prefers-color-scheme/.test(DASH), false);
  /*
   * Banner icons are CSS dots. The first version used emoji and a screenshot showed the pause glyph
   * rendering as an empty box — one missing font away from a monitoring page that itself looks broken.
   */
  check('banner icons do not depend on an emoji font',
    /\.banner \.ico\{flex:0 0 7px/.test(DASH), true);
  /* A silent three-second refresh is indistinguishable from a frozen page without something moving. */
  check('there is a live indicator', /@keyframes p\{/.test(DASH), true);
  check('...and losing contact is stated rather than showing stale numbers',
    /lost contact — close this window/.test(DASH), true);
}
{
  const CMD = read('scripts/dashboard.cmd');
  check('there is a double-clickable launcher', CMD.includes('dashboard.mjs'), true);
  check('...that prefers the bundled Node', /runtime\\node\.exe/.test(CMD), true);
  /*
   * The browser is opened BEFORE the server starts. The other order reads more logically and does not work:
   * the server never returns while listening, so the browser line would wait for somebody to close it.
   */
  check('the browser is opened before the blocking server call',
    CMD.indexOf('start ""') < CMD.indexOf('scripts\\dashboard.mjs'), true);
  check('...and says why', /would not run until somebody closed it/.test(CMD), true);
  check('it says closing the window does not stop the automation',
    /automation is unaffected/.test(CMD), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
