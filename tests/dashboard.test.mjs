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
  /* Three minutes: one lead takes 20-40 seconds and a slow one has been seen at ninety. */
  check('...after three minutes', HB.STUCK_AFTER_MS, 3 * 60 * 1000);
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
