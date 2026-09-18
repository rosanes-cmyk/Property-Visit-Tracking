/**
 * The check that speaks up when nothing is happening — and stays quiet when it is.
 *
 *   node tests/health-check.test.mjs
 *
 * WHY IT EXISTS. Every failure this month was found because the client noticed and asked, days late:
 *
 *   - the bucket sweep had not completed once in 4.9 days
 *   - the Chat briefing had never fired from the PC since the setting was added
 *   - REI signed itself out roughly daily
 *   - the PC had not run at all since Friday 2:17 PM
 *
 * And every check they had said things were fine. Ten green scheduled tasks, all `Last Result 0`. A log line
 * reading "stood down for a booking", which sounds deliberate. A clean `EXIT code=0` on the very run that
 * had just clobbered its own cookie jar. Their words at the end of it: "WE SHOULD ALWAYS THIS IS WORKING ITS
 * ALREADY DAYS THAT HAS ISSUE WHAT TEH FUCK".
 *
 * So the check does not report health, which is what everything else was doing while being wrong. It reports
 * the ABSENCE of work — the one thing all four failures had in common and the one thing nothing watched.
 *
 * It is RUN here, against fabricated data folders, because "does it stay quiet on a good day" and "does it
 * say four days when it has been four days" are questions about behaviour. A check that cried wolf every
 * morning would be worth less than nothing: people stop reading it, and then it is silent in the only way
 * that matters.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const SRC = path.resolve('twin-visit-logger-sandbox/scripts/health-check.mjs');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/* A throwaway app: only the three local files it reads, and a notifyChat that records instead of posting. */
function run({ sweep, beat, sessionLog, jobLogs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/utils'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SRC, path.join(dir, 'scripts/health-check.mjs'));
  fs.writeFileSync(path.join(dir, 'src/utils/notify.mjs'),
    "export async function notifyChat(text, opts) { console.log('POSTED|' + opts.kind + '|' + opts.requested); return true; }\n");
  if (sweep) fs.writeFileSync(path.join(dir, 'data/LAST-SWEEP'), JSON.stringify(sweep));
  if (beat) fs.writeFileSync(path.join(dir, 'data/heartbeat.json'), JSON.stringify(beat));
  if (sessionLog) fs.writeFileSync(path.join(dir, 'logs/rei-session.log'), sessionLog);
  /* jobLogs: { 'fill-pending.log': minutesSinceItLastRan } — written, then back-dated. */
  for (const [file, minsAgo] of Object.entries(jobLogs || {})) {
    const at = path.join(dir, 'logs', file);
    fs.writeFileSync(at, 'x');
    const when = new Date(Date.now() - minsAgo * 60000);
    fs.utimesSync(at, when, when);
  }
  const out = execFileSync(process.execPath, ['scripts/health-check.mjs'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const healthy = {
  sweep: { completedAt: ago(30 * 60 * 1000), standDowns: 0 },
  beat: { updatedAt: ago(5 * 60 * 1000), done: true },
  sessionLog: `${ago(10 * 60 * 1000)} pid 1 AUTH   REI accepted the session\n`
};

console.log('=== A good day is a silent day ===');
/*
 * The most important test here. A card every morning saying "all good" is a card people stop reading, and
 * then it is worth nothing on the morning it says something else.
 */
{
  const out = run(healthy);
  check('nothing is posted', /POSTED\|/.test(out), false);
  check('...and it says so on screen only', /All clear/.test(out), true);
}

console.log('\n=== The 4.9-day sweep outage would have been caught on day one ===');
{
  const out = run({ ...healthy, sweep: { completedAt: ago(4 * DAY + 20 * HOUR), standDowns: 118 } });
  check('it posts', /POSTED\|warn\|true/.test(out), true);
  check('...saying HOW LONG, not just that it happened', /No REI sweep has finished for 4 days 20 hours/.test(out), true);
  check('...and naming the stand-down streak', /118 sweeps in a row stood down/.test(out), true);
  check('...and what it costs: the cards are holding', /work-queue cards are holding/.test(out), true);
}
{
  // One day is the line. An hourly sweep that has not finished in 24 hours is unambiguous.
  const out = run({ ...healthy, sweep: { completedAt: ago(23 * HOUR), standDowns: 0 } });
  check('23 hours is not yet an alarm', /POSTED\|/.test(out), false);
  const out2 = run({ ...healthy, sweep: { completedAt: ago(25 * HOUR), standDowns: 0 } });
  check('25 hours is', /POSTED\|/.test(out2), true);
}
{
  // A machine that has NEVER completed one is the loudest case, not a missing-file edge case.
  const out = run({ ...healthy, sweep: null });
  check('never swept at all is reported', /has ever finished on this PC/.test(out), true);
}

console.log('\n=== The four-day PC outage, the one no code can fix ===');
{
  const out = run({ ...healthy, beat: { updatedAt: ago(4 * DAY), done: true } });
  check('a silent PC is reported', /Nothing has run on this PC for 4 days/.test(out), true);
  check('...with the three real causes named', /off, signed out, or the timers are stopped/.test(out), true);
}

console.log('\n=== REI signed out, read from the session log\'s own words ===');
{
  const out = run({
    ...healthy,
    sessionLog: `${ago(2 * DAY)} pid 1 AUTH   REI accepted the session\n`
      + `${ago(40 * 60 * 1000)} pid 2 AUTH   REI showed a login page https://my.reiblackbook.com/services/account/login\n`
  });
  check('a login page newer than an accepted session means signed out',
    /REI is signed out/.test(out), true);
  check('...and it names the command to fix it', /scripts\\login-rei\.cmd/.test(out), true);
}
{
  // The other way round: refused earlier, accepted since. That is a session that came BACK.
  const out = run({
    ...healthy,
    sessionLog: `${ago(2 * DAY)} pid 1 AUTH   REI showed a login page\n`
      + `${ago(20 * 60 * 1000)} pid 2 AUTH   REI accepted the session\n`
  });
  check('an older refusal is not an alarm', /REI is signed out/.test(out), false);
}
{
  /*
   * THE FALSE ALARM IT GAVE THE CLIENT, thirty seconds after they had signed in.
   *
   * A sign-in writes no AUTH line -- only a scheduled run does, because only a run asks REI for a page and
   * sees what comes back. So the newest AUTH was still the refusal from before the login, and the check
   * announced "REI is signed out" at somebody who had just fixed it. Their reply: "why you are saying
   * tommorwo it should be worked his job for now as well".
   *
   * A profile OPENED with cookies since the last refusal is the evidence a login leaves behind.
   */
  const out = run({
    ...healthy,
    sessionLog: `${ago(2 * DAY)} pid 1 AUTH   REI accepted the session\n`
      + `${ago(35 * 60 * 1000)} pid 2 AUTH   REI showed a login page\n`
      + `${ago(3 * 60 * 1000)} pid 3 OPEN   profile=C:\\app\\browser-data\\rei-fresh reiCookies=19\n`
  });
  check('a fresh sign-in is not reported as signed out', /REI is signed out/.test(out), false);
}
{
  // ...but an OPEN with NO cookies is not a login, and must not silence a real refusal.
  const out = run({
    ...healthy,
    sessionLog: `${ago(35 * 60 * 1000)} pid 2 AUTH   REI showed a login page\n`
      + `${ago(3 * 60 * 1000)} pid 3 OPEN   profile=C:\\app\\browser-data\\rei-fresh reiCookies=0\n`
  });
  check('an empty profile does not count as a sign-in', /REI is signed out/.test(out), true);
}
{
  // A machine that has never run REI has nothing to say about REI. Absence of a log is not a fault.
  const out = run({ ...healthy, sessionLog: null });
  check('no session log at all is not an alarm', /POSTED\|/.test(out), false);
}

console.log('\n=== One job dying among nine ===');
/*
 * THE GAP THAT COST TWO DAYS. Everything above asks whether ANYTHING ran, and nine tasks share one
 * heartbeat — so eight healthy jobs drown one dead one. "Board Intake" stopped on the Wednesday at 13:24
 * and this check said "All clear" every morning until the Friday, while bookings sat on the board.
 *
 * Windows agreed with it: the task showed Status: Running the whole time, because a wedged instance never
 * exited and every start after it was refused with 0x800710E0. A green task and a green check, describing
 * a job that had not run in 48 hours.
 */
{
  const fresh = { 'scheduled-task.log': 1, 'fill-pending.log': 1, 'recheck-task.log': 5,
    'bucket-task.log': 30, 'audit-notes.log': 30, 'briefings.log': 300 };
  const out = run({ ...healthy, jobLogs: fresh });
  check('all nine busy is silent', /POSTED\|/.test(out), false);

  // The real case: everything fine except the one that stopped two days ago.
  const one = run({ ...healthy, jobLogs: { ...fresh, 'fill-pending.log': 2 * 24 * 60 } });
  check('one stopped job IS reported', /POSTED\|warn\|true/.test(one), true);
  check('...and it is named', /Bookings added on the board/.test(one), true);
  check('...with how long it has been quiet', /2 days/.test(one), true);
  check('...and the others are not dragged in', /REI re-check/.test(one), false);
  /* The fix is the same every time and is not guessable: end the task, the next start runs clean. */
  check('...and the command that clears it', /schtasks \/End/.test(one), true);
}
{
  /*
   * LATE IS NOT STOPPED. A laptop that slept through lunch must not produce a card, or people stop
   * reading them — which is the failure this whole file exists to avoid.
   */
  const out = run({ ...healthy, jobLogs: { 'fill-pending.log': 45 } });
  check('a job 45 minutes late on a 2-minute cycle is not an alarm', /POSTED\|/.test(out), false);
}
{
  /*
   * The diverted log counts. fill-pending writes to fill-pending-<random>.log when the shared file is held
   * open — and that fallback is exactly what hid the truth here, because the obvious file sat frozen while
   * the real output went somewhere nobody looked. Reading only the tidy name repeats a person's mistake.
   */
  const out = run({ ...healthy,
    jobLogs: { 'fill-pending.log': 3 * 24 * 60, 'fill-pending-7243.log': 2 } });
  check('a run that had to divert its log still counts as a run', /Bookings added on the board/.test(out), false);
}
{
  // A task that was never installed has no log, and a permanent false alarm would be worse than silence.
  const out = run({ ...healthy, jobLogs: { 'fill-pending.log': 1 } });
  check('a job that has never written is not reported missing', /REI re-check/.test(out), false);
}

console.log('\n=== It survives whatever it is pointed at ===');
/*
 * This is the last thing still working when everything else is stuck, so it cannot be the thing that throws.
 */
{
  const out = run({ ...healthy, sweep: { completedAt: 'not a date' } });
  check('an unreadable timestamp is treated as never, not as fine', /has ever finished|No REI sweep/.test(out), true);
}

console.log('\n=== It cannot depend on the things that break ===');
const CODE = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
check('no sheet', /googleapis|sheets\.mjs/.test(CODE), false);
check('no browser', /launchReiContext|playwright/.test(CODE), false);
check('no lock', /acquireLock/.test(CODE), false);
/* CHAT_ALERTS=off exists to stop per-lead chatter. A silenced failure notice is how a week goes by. */
check('it survives CHAT_ALERTS=off', /requested: true/.test(CODE), true);
check('the daily job runs it',
  /health-check\.mjs/.test(fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/morning-briefings.cmd'), 'utf8')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
