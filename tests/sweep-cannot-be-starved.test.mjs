/**
 * A sweep that always yields is a sweep that never runs.
 *
 *   node tests/sweep-cannot-be-starved.test.mjs
 *
 * FIVE DAYS OF A BLIND WORK QUEUE, and every part of it was working as written.
 *
 * From the client's Automation Log, one line an hour, for days:
 *
 *     Bucket sweep stood down for a booking after 1 of 20 lead(s) - not stamped as a completed sweep.
 *     Work queue HELD - buckets not swept yet (last sweep 7057 min ago). Checking again in 10 min.
 *     Work queue held back again - same outage already reported today. Not repeating the card.
 *
 * 7057 minutes is 4.9 days. The sweep runs hourly, so roughly 118 consecutive stand-downs. Their words:
 * "the cheking and alert did not fioree" - and before that, "its not firing today wha is it?"
 *
 * THE LOOP, all of it mine:
 *
 *   1. fill-pending-rei claims booking priority BEFORE queueing for the lock, and it runs every 2 minutes.
 *   2. It claimed for the REI-LINK BACKFILL as well as for real bookings.
 *   3. `rowsNeedingReiLink` re-selects any row with a phone and no REI link for THIRTY DAYS, and nothing
 *      marks a row whose phone REI cannot match - so one unmatchable row means a claim on every run.
 *   4. The bucket sweep needs 5-8 minutes for 20 leads and checks for a claim between each one.
 *
 * A two-minute claimer against a five-minute yielder cannot both be satisfied. The sweep never finished,
 * so it never stamped, so the card was held - and the held-card notice is deduplicated per day, so after
 * the first morning the team heard nothing at all.
 *
 * WHAT MADE IT INVISIBLE was that every component reported success. Ten green scheduled tasks, all
 * `Last Result 0`. A log line that says "stood down for a booking", which reads like the system being
 * polite. I checked the tasks, the pause flags, the lock, the config and the webhook - four wrong causes -
 * before reading the client's own log, where it had been stated hourly in plain English for five days.
 *
 * So this file tests the two things source-matching cannot see: that a claim from housekeeping does not
 * make the sweep yield, and that yielding has a floor.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const ROOT = path.resolve('twin-visit-logger-sandbox');
const RECHECK = fs.readFileSync(path.join(ROOT, 'scripts/recheck-rei.mjs'), 'utf8');
const FILL = fs.readFileSync(path.join(ROOT, 'scripts/fill-pending-rei.mjs'), 'utf8');

/*
 * priority.mjs is imported and RUN, in a temp directory, because it resolves its paths against the process
 * working directory. Every question here is about behaviour over time - claim, yield, wait three hours,
 * yield again - and none of it can be answered by reading the file.
 */
const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starve-'));
process.chdir(tmp);
const P = await import(path.join(ROOT, 'src/utils/priority.mjs'));

console.log('=== A claim still stops a sweep. That part was right and must not break ===');
check('no claim, no stand-down', P.shouldStandDownForBooking().standDown, false);
P.claimBookingPriority('1 booking(s)');
check('a booking waiting stops the sweep', P.shouldStandDownForBooking().standDown, true);
P.clearBookingPriority();
check('...and a cleared claim releases it', P.shouldStandDownForBooking().standDown, false);

console.log('\n=== ...but not once the buckets have gone unswept for hours ===');
/*
 * THE FIX, and the reason it is a floor rather than a fairness scheme: the work-queue card is held on the
 * sweep's stamp. "Bookings first" is right, but it cannot mean "the buckets are never checked", because
 * the queue then goes out blind or does not go out at all - and on the client's machine it did not go out.
 */
P.claimBookingPriority('1 booking(s)');
P.noteSweepCompleted();
check('a sweep that just finished still yields', P.shouldStandDownForBooking().standDown, true);

// Two hours: inside the window. Politeness still wins.
fs.writeFileSync(path.join(tmp, 'data/LAST-SWEEP'),
  JSON.stringify({ completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), standDowns: 40 }));
check('two hours unswept: still yields', P.shouldStandDownForBooking().standDown, true);

// Four hours: past it. The sweep finishes even with a booking queued.
fs.writeFileSync(path.join(tmp, 'data/LAST-SWEEP'),
  JSON.stringify({ completedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), standDowns: 40 }));
const overdue = P.shouldStandDownForBooking();
check('four hours unswept: does NOT yield', overdue.standDown, false);
check('...and says why, on screen', /have not been swept for \d+ minutes/.test(overdue.reason || ''), true);
check('...naming the consequence rather than just refusing',
  /work queue is not published blind/.test(overdue.reason || ''), true);

/*
 * A machine that has NEVER swept is not overdue. "Never" and "a long time ago" look identical to a person
 * and must not to code: on a fresh install the first sweep should still get out of a booking's way.
 */
fs.rmSync(path.join(tmp, 'data/LAST-SWEEP'));
check('never swept is not treated as overdue', P.shouldStandDownForBooking().standDown, true);
check('...and reports null rather than a number', P.minutesSinceSweep(), null);

console.log('\n=== The streak is recorded, so 118 in a row cannot look like the first ===');
P.noteSweepCompleted();
check('a completed sweep resets the streak', P.standDownStreak(), 0);
check('first stand-down', P.noteSweepStoodDown(), 1);
check('second', P.noteSweepStoodDown(), 2);
check('third', P.noteSweepStoodDown(), 3);
check('...and it persists across calls', P.standDownStreak(), 3);
P.noteSweepCompleted();
check('finishing clears it again', P.standDownStreak(), 0);

console.log('\n=== Bookkeeping may never fail a run ===');
/*
 * Rule 1 of this file's older half. A sweep must not die because a data file could not be written - the
 * whole point of the local marker is that it is cheaper and safer than a sheet read.
 */
fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true });
fs.writeFileSync(path.join(tmp, 'data'), 'not a directory');   // makes every write under it fail
let threw = null;
try {
  P.noteSweepCompleted(); P.noteSweepStoodDown(); P.minutesSinceSweep(); P.shouldStandDownForBooking();
} catch (error) { threw = error.message; }
check('an unwritable data folder throws nothing', threw, null);
check('...and reads as never swept rather than overdue', P.shouldStandDownForBooking().standDown, false);

process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n=== The call sites use the policy, not the raw claim ===');
/*
 * Comment-stripped. This project has been bitten nine times by an assertion decided by prose, including a
 * negative check that tripped on the comment explaining the removal - and the comments in both these files
 * now quote `bookingIsWaiting()` and the old claim line at length while explaining the fix.
 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const R = code(RECHECK);
const F = code(FILL);

check('the sweep asks the policy', /shouldStandDownForBooking\(\)/.test(R), true);
check('...and no longer the raw claim', /bookingIsWaiting\(\)/.test(R), false);
check('a completed sweep is recorded', /noteSweepCompleted\(\)/.test(R), true);
check('...only when it actually stamped',
  /!yieldedToBooking\) \{\s*\n\s*auditRows\.push\(sweepStamp[^\n]*\n\s*noteSweepCompleted\(\);/.test(R), true);
check('a stand-down is counted', /noteSweepStoodDown\(\)/.test(R), true);
check('...and the streak reaches the log line', /\$\{streak\} sweeps in a row/.test(RECHECK), true);
check('...escalating to WARN once it is a pattern', /streak >= 3 \? 'WARN' : 'INFO'/.test(R), true);

// THE ROOT CAUSE, in one line: housekeeping does not get to claim.
check('only a real booking claims priority',
  /if \(pending\.length\) claimBookingPriority\(`\$\{pending\.length\} booking\(s\)`\)/.test(F), true);
check('...the backfill count is no longer part of the claim',
  /claimBookingPriority\([^)]*backfill/.test(F), false);
/*
 * The backfill still runs and still takes the lock. It was never the work that was wrong, only its claim
 * to jump a queue nobody was watching it in.
 */
check('the backfill still does its work', /backfill\.rows\.length/.test(F), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
