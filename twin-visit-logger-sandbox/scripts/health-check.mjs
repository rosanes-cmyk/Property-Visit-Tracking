/**
 * One card a day, and ONLY when something is actually broken.
 *
 *   node scripts/health-check.mjs           post to Chat if anything is stale
 *   node scripts/health-check.mjs --print   show the answer on screen, send nothing
 *
 * WHY THIS EXISTS, and it is the lesson of the whole week rather than one bug.
 *
 * The bucket sweep did not complete once in 4.9 days. The Chat briefing had never fired from the PC since
 * the setting was added. REI signed itself out roughly daily. Bookings were announced five times, then not
 * at all. Every one of those was found because the CLIENT noticed and asked -- days late, in the middle of
 * their working day, usually after a visit had already gone out without a briefing.
 *
 * And every check they had said things were fine. Ten green scheduled tasks, all `Last Result 0`. A log line
 * reading "stood down for a booking", which sounds deliberate. A clean `EXIT code=0` on the run that had
 * just clobbered its own cookie jar. The client, at the end of it: "WE SHOULD ALWAYS THIS IS WORKING ITS
 * ALREADY DAYS THAT HAS ISSUE".
 *
 * So this does not report health. It reports the ABSENCE of work, which is the thing every one of those
 * failures had in common and the thing nothing was watching.
 *
 * THREE RULES IT KEEPS
 *
 *   SILENT WHEN WELL. A card that arrives every morning saying "all good" is a card people stop reading, and
 *   then it is worth nothing on the morning it says something else. Nothing is posted unless something is
 *   genuinely stale.
 *
 *   IT SAYS HOW LONG. "REI not checked" reads the same on day one and day five -- that is exactly how four
 *   days went by. "No completed sweep for 4 days 20 hours" does not.
 *
 *   LOCAL FILES ONLY. No sheet, no browser, no lock. It must be the one thing that still works when
 *   everything else is stuck, so it cannot depend on any of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { notifyChat } from '../src/utils/notify.mjs';

const PRINT_ONLY = process.argv.includes('--print');

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')); } catch { return null; }
};

/** "4 days 20 hours", "3 hours 12 minutes", "8 minutes" - the number IS the message. */
function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'never';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (d) return `${d} day${d === 1 ? '' : 's'} ${h} hour${h === 1 ? '' : 's'}`;
  if (h) return `${h} hour${h === 1 ? '' : 's'} ${mins} minute${mins === 1 ? '' : 's'}`;
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

const now = Date.now();
const since = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? now - t : Number.POSITIVE_INFINITY;
};

const problems = [];

/*
 * 1. THE BUCKET SWEEP. Everything the team reads hangs off this: no completed sweep means no SWEEP stamp,
 *    and the 9am/11am/4pm work-queue cards hold rather than publish a queue they cannot stand behind. It
 *    runs hourly, so a whole day without one finishing is unambiguous.
 */
const sweep = readJson('./data/LAST-SWEEP');
const sweptAgo = sweep ? since(sweep.completedAt) : Number.POSITIVE_INFINITY;
if (sweptAgo > 24 * 3600 * 1000) {
  problems.push(sweep?.completedAt
    ? `*No REI sweep has finished for ${ago(sweptAgo)}* - the work-queue cards are holding, not publishing.`
    : '*No REI sweep has ever finished on this PC* - the work-queue cards will keep holding.');
  const streak = Number(sweep?.standDowns) || 0;
  if (streak >= 3) {
    problems.push(`  ${streak} sweeps in a row stood down for a booking without finishing.`);
  }
}

/*
 * 2. ANY JOB AT ALL. The heartbeat is written by every scheduled run, so a stale one means the PC is off,
 *    signed out, asleep, or the tasks are gone -- the cause of the four-day gap in September, and the one
 *    thing no amount of code can fix from the inside.
 */
const beat = readJson('./data/heartbeat.json');
const beatAgo = beat ? since(beat.updatedAt) : Number.POSITIVE_INFINITY;
if (beatAgo > 3 * 3600 * 1000) {
  problems.push(beat?.updatedAt
    ? `*Nothing has run on this PC for ${ago(beatAgo)}* - it is off, signed out, or the timers are stopped.`
    : '*No job has ever reported in on this PC* - the scheduled tasks may not be installed.');
}

/*
 * 3. THE REI SESSION, read from the session log's own words rather than guessed at. A login page more recent
 *    than an accepted session means REI is signed out right now.
 */
try {
  const lines = fs.readFileSync(path.resolve('./logs/rei-session.log'), 'utf8').split('\n');
  let accepted = 0;
  let refused = 0;
  let openedWithCookies = 0;
  for (const line of lines) {
    const at = Date.parse((line.match(/^(\S+)/) || [])[1] || '');
    if (!Number.isFinite(at)) continue;
    if (line.includes('REI accepted the session')) accepted = Math.max(accepted, at);
    if (line.includes('REI showed a login page')) refused = Math.max(refused, at);
    /*
     * A SIGN-IN WRITES NO 'AUTH' LINE — only a scheduled run does, because only a run asks REI for a page
     * and sees what comes back. So a login that has just happened is invisible to the two counters above,
     * and the first version of this check told the client "REI is signed out" thirty seconds after they had
     * signed in. The evidence it needs is the OPEN: a profile opened with cookies since the last refusal
     * means the session was restored, whatever the older AUTH lines say.
     *
     * It does not claim the opposite either. An OPEN with cookies is not proof REI will accept them — that
     * is what the next run finds out. It is only enough to stop asserting a signed-out state that has
     * already been dealt with.
     */
    const cookies = /reiCookies=(\d+)/.exec(line);
    if (cookies && Number(cookies[1]) > 0) openedWithCookies = Math.max(openedWithCookies, at);
  }
  if (refused && refused > accepted && refused > openedWithCookies) {
    problems.push(`*REI is signed out* - last refused ${ago(now - refused)} ago`
      + (accepted ? `, last accepted ${ago(now - accepted)} ago.` : '.')
      + ' Run scripts\\login-rei.cmd on that PC.');
  }
} catch { /* no log yet is not a problem: a machine that has never run REI has nothing to report */ }

if (!problems.length) {
  console.log('All clear: a sweep has finished, jobs are running, and REI is signed in. Nothing posted.');
  process.exit(0);
}

const message = '*⚠️ The automation needs attention*\n\n'
  + problems.join('\n')
  + '\n\nNothing else is wrong that this can see. It stays quiet on the days everything works.';

console.log(message.replace(/\*/g, ''));

if (PRINT_ONLY) process.exit(0);

/*
 * requested: this is the one message that must survive CHAT_ALERTS=off. That switch exists to stop per-lead
 * chatter, and a silenced failure notice is how a week goes by with nobody told.
 */
const posted = await notifyChat(message, { kind: 'warn', requested: true });
console.log(posted ? '\nPosted to Chat.' : '\nNOT posted (reason above).');
