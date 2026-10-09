/**
 * Every live lead comes round. The re-check queue cannot starve a lead for ever.
 *
 *   node tests/recheck-rotation.test.mjs
 *
 * WHY THIS EXISTS. `recheckUrgency` scores in separated magnitudes so the ordering can be decided by
 * reading it — and that design had a consequence nobody traced: Opportunity Priority is worth up to
 * 1,000,000 while how long a lead has waited is CAPPED at 99. A lower-scored lead could therefore never
 * age its way into a slot. Not "waits longer" — never.
 *
 * Measured against the client's real workbook (157 eligible leads, 18 distinct priority values), the
 * ordinary 20-minute run read 54 of them in 24 hours and never read the other 103, while the run banner
 * said "157 of 418 can ever be re-checked" and the health check said the job ran. Both were true. Neither
 * was the answer, and nothing in the system could have told anybody.
 *
 * The symptom of a regression here is a lead being checked LESS OFTEN — no error, no failed run, no alert.
 * That is exactly the class of fault this project has lost days to twice, so it gets a test that drives the
 * REAL picker over a real day rather than asserting anything about the shape of the formula.
 */
import {
  pickRecheckCandidates, recheckUrgency, recheckKey,
  RECHECK_PER_RUN, RECHECK_MINUTES, STARVING_HOURS
} from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const lead = (i, priority) => ({
  __rowNumber: i + 2,
  'REI Record ID': `rec${i}`,
  'REI BlackBook Link': `https://my.reiblackbook.com/contacts/${i}`,
  'Property Address': `${i} Test Street`,
  'Current Stage': 'Offer Sent',
  'Visit Status': '',
  'Opportunity Priority': priority
});

/*
 * A day of the installed schedule, driving the actual picker.
 *
 * lastCheckedAt is stamped PER LEAD as the browser works through them (recheck-rei.mjs:775), not at the
 * run's start — about 20 seconds each. That gap is load-bearing: it is why a lead read last run is still
 * inside the 20-minute window on the next one and sits it out. Modelling it as instant would make this
 * test agree with a bug.
 */
function simulate(rows, { hours = 24, secondsPerLead = 20 } = {}) {
  const state = {}, reads = new Map();
  let clock = new Date('2026-10-09T08:00:00Z').getTime(), worstGapMs = 0;
  const lastSeen = new Map(rows.map((r) => [recheckKey(r), clock]));
  const runs = Math.round((hours * 60) / RECHECK_MINUTES);

  for (let r = 0; r < runs; r += 1) {
    for (const row of rows) {
      const gap = clock - lastSeen.get(recheckKey(row));
      if (gap > worstGapMs) worstGapMs = gap;
    }
    pickRecheckCandidates(rows, state, { now: new Date(clock) }).forEach((row, i) => {
      const key = recheckKey(row);
      state[key] = { lastCheckedAt: new Date(clock + (i + 1) * secondsPerLead * 1000).toISOString() };
      reads.set(key, (reads.get(key) || 0) + 1);
      lastSeen.set(key, clock);
    });
    clock += RECHECK_MINUTES * 60 * 1000;
  }
  return {
    neverRead: rows.filter((r) => !reads.has(recheckKey(r))).length,
    worstGapHours: worstGapMs / 3600000,
    readsFor: (row) => reads.get(recheckKey(row)) || 0
  };
}

console.log('=== no shape of the priority column may starve a lead ===');
/*
 * Four shapes, because which one a workbook has is not ours to decide and each broke differently before
 * the fix: all-distinct starved 116 of 156, five tiers starved 93, two tiers starved 78, and a blank
 * column starved none — so a test written against only the blank case would have passed throughout.
 */
const SHAPES = {
  'the real sheet (18 distinct values, 38 blank)': (i) => lead(i, i < 38 ? '' : [95, 90, 88, 84, 80, 76, 74, 70, 66, 62, 58, 50, 44, 38, 30, 22, 14, 8][i % 18]),
  'every lead a different priority': (i) => lead(i, 100 - (i % 100)),
  'five coarse tiers': (i) => lead(i, [90, 70, 50, 30, 10][i % 5]),
  'two tiers': (i) => lead(i, i < 78 ? 80 : 10),
  'the column is blank or missing': (i) => lead(i, '')
};
for (const [name, make] of Object.entries(SHAPES)) {
  const rows = Array.from({ length: 157 }, (_, i) => make(i));
  check(`${name}: every lead read within 24h`, simulate(rows).neverRead, 0);
}

console.log('\n=== a lead cannot wait much longer than the escape hatch allows ===');
const real = Array.from({ length: 157 }, (_, i) => SHAPES['the real sheet (18 distinct values, 38 blank)'](i));
const run = simulate(real);
/*
 * STARVING_HOURS plus one drain of the whole book. Asserted against the constant rather than a literal, so
 * tuning the constant moves the guarantee instead of breaking the test for the wrong reason.
 */
const allowed = STARVING_HOURS + 4;
check(`the longest any lead waits is under ${allowed}h`, run.worstGapHours < allowed, true);
check('...and that is measured, not assumed', run.worstGapHours > 0, true);

console.log('\n=== the fix must not flatten the queue into a round robin ===');
/*
 * The point of the escape hatch is a FLOOR, not equality. The team's own scoring still has to decide what
 * gets read most — a fix that gave every lead the same attention would be a different bug with the same
 * test passing.
 */
const hot = real.filter((r) => Number(r['Opportunity Priority']) >= 80);
const cold = real.filter((r) => !Number(r['Opportunity Priority']));
const avg = (rows) => rows.reduce((s, r) => s + run.readsFor(r), 0) / rows.length;
check('high-priority leads are read far more often than the rest', avg(hot) > avg(cold) * 3, true);
check('...and the quiet ones are still read several times a day', avg(cold) >= 2, true);

console.log('\n=== a booked visit outranks the fairness rule ===');
/*
 * The client: "but it should prio the added visit need to be worked." A visit somebody is going to drive
 * to must never be pushed down the queue by a lead that is merely stale — being fair to a quiet lead is
 * worth nothing if it costs a wasted ninety-minute drive.
 */
const inDays = (d) => {
  const t = new Date(nowRef.getTime() + d * 86400000);
  return `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}/${t.getFullYear()}`;
};
const nowRef = new Date('2026-10-09T12:00:00Z');
const booked = (days) => ({ ...lead(9, 5), 'Visit Date': inDays(days), 'Visit Status': 'Scheduled' });
const starvingQuiet = lead(10, 5);
/*
 * 0.5h, not 0.1h. Anything inside RECHECK_MINUTES scores 0 regardless of tier — the cadence gate fires
 * before the tiers are added — so comparing a six-minute-old lead proves nothing about the ordering. The
 * first draft of this test did exactly that and "passed" three assertions on a zero.
 */
const ago = (h) => new Date(nowRef.getTime() - h * 3600000).toISOString();
const DUE = 0.5;

check('a visit booked next week beats a lead nobody has read in a day',
  recheckUrgency(booked(7), ago(DUE), { now: nowRef }) > recheckUrgency(starvingQuiet, ago(24), { now: nowRef }), true);
check('a visit booked tomorrow still beats a visit booked next week',
  recheckUrgency(booked(1), ago(1), { now: nowRef }) > recheckUrgency(booked(7), ago(1), { now: nowRef }), true);
check('a visit booked next week is genuinely due, not scoring zero on the cadence gate',
  recheckUrgency(booked(7), ago(DUE), { now: nowRef }) > 0, true);
check('a visit booked months out is NOT given the tier (it would never clear)',
  recheckUrgency(booked(90), ago(DUE), { now: nowRef }) < recheckUrgency(starvingQuiet, ago(24), { now: nowRef }), true);
check('a booked visit that is also starving ranks above one that is not',
  recheckUrgency(booked(7), ago(24), { now: nowRef }) > recheckUrgency(booked(7), ago(DUE), { now: nowRef }), true);

/*
 * The bound matters as much as the tier. A pipeline heavy with booked visits must still not starve the
 * rest, so the day's rotation is re-measured with a realistic share of the book carrying a visit date.
 */
const withVisits = Array.from({ length: 157 }, (_, i) => (i < 12
  ? { ...SHAPES['the real sheet (18 distinct values, 38 blank)'](i), 'Visit Date': inDays(2 + (i % 10)), 'Visit Status': 'Scheduled' }
  : SHAPES['the real sheet (18 distinct values, 38 blank)'](i)));
check('12 booked visits in the book still starve nobody', simulate(withVisits).neverRead, 0);

console.log('\n=== the escape hatch itself ===');
const now = new Date('2026-10-09T12:00:00Z');
const quiet = lead(1, 5);
const important = lead(2, 95);
const hoursAgo = (h) => new Date(now.getTime() - h * 3600000).toISOString();

check('a fresh low-priority lead ranks below a fresh high-priority one',
  recheckUrgency(quiet, hoursAgo(1), { now }) < recheckUrgency(important, hoursAgo(1), { now }), true);
check(`a lead unread for ${STARVING_HOURS}h outranks a high-priority one checked minutes ago`,
  recheckUrgency(quiet, hoursAgo(STARVING_HOURS + 0.5), { now }) > recheckUrgency(important, hoursAgo(1), { now }), true);
check('a never-checked lead counts as starving',
  recheckUrgency(quiet, '', { now }) > recheckUrgency(important, hoursAgo(1), { now }), true);
/*
 * The two tiers that are about TODAY must still win. A visit in the past still marked Scheduled means the
 * board is wrong about today, and no amount of staleness elsewhere may push it down the queue.
 */
const pastVisit = { ...important, 'Visit Date': '10/01/2026', 'Visit Status': 'Scheduled' };
check('a past visit still marked Scheduled outranks a starving lead',
  recheckUrgency(pastVisit, hoursAgo(1), { now }) > recheckUrgency(quiet, hoursAgo(100), { now }), true);

console.log('\n=== the ordering is decided by code, not by a comment ===');
/*
 * Twice in this project an assertion was satisfied by the prose explaining a fix rather than the fix. The
 * source is stripped of comments before being searched, so a comment mentioning STARVING_HOURS cannot pass
 * this on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
const SRC = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/rei/recheck.mjs'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('STARVING_HOURS is used in executable code', /const starving\s*=/.test(CODE), true);
check('...and it is part of the urgency total', /starving\s*\?/.test(CODE), true);
check('the ageing term is still capped (the escape hatch replaces it, not the cap)', /Math\.min\(Math\.round\(since - minutes\), 98\)/.test(CODE), true);

/*
 * The bucket sweep had the same fault in a different form: `onCard.slice(0, LIMIT)` over plain sheet order,
 * so a card bigger than the limit swept the identical first N for ever while printing "they wait for the
 * next hour". It is checked here because it is the same failure and would otherwise have no test at all.
 */
const SWEEP = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/recheck-rei.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('the bucket sweep sorts before it slices', /onCard\]\.sort\(/.test(SWEEP), true);
check('...and the unsorted slice is gone', /candidates = onCard\.slice\(/.test(SWEEP), false);

console.log('\n=== a fair queue is worthless if the job never gets the browser ===');
/*
 * The other half of the same failure, and the half that actually bit.
 *
 * The scheduled re-check used to call the non-waiting acquireLock() and stand down the instant the lock was
 * busy, reasoning that "the timer fires every twenty minutes, so skipping costs nothing". Four jobs share
 * that one lock and three of them now fire every TWO minutes, so the twenty-minute job lost the race every
 * time: measured on the client's server, 13.5 hours of the task firing on schedule with Last Result 0 and
 * exactly two leads read.
 *
 * It is the worst shape of fault this project keeps hitting — the scheduler healthy, the job healthy, exit
 * code 0, and the work not happening. Standing down is a SUCCESS, so nothing could report it.
 */
check('the scheduled re-check waits for the lock instead of standing down',
  /acquireLockWaiting\('run'/.test(SWEEP), true);
check('...and the bare non-waiting acquireLock() is gone from the lock decision',
  /:\s*await acquireLock\(\)/.test(SWEEP), false);
check('...but the wait is BOUNDED, so runs cannot pile up behind a dead lock',
  /SCHEDULED_LOCK_WAIT_MS\s*=\s*\d+\s*\*\s*60\s*\*\s*1000/.test(SWEEP), true);
/*
 * The exit code is the difference between a person and a timer. A hand-typed run must fail loudly; a timer
 * that exits non-zero on a busy afternoon paints the scheduled task red for hours, and a red light nobody
 * can act on is how a real one comes to be ignored.
 */
check('a timed-out scheduled run still exits 0, leaving it to the next run',
  /if \(ONLY \|\| WAIT\) process\.exit\(1\);/.test(SWEEP), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
