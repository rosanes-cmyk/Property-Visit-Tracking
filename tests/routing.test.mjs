/**
 * Dashboard routing tests.
 *
 *   node tests/routing.test.mjs
 *
 * These run the REAL section predicates: the SECTIONS array is extracted verbatim from
 * apps-script/Dashboard.html at test time and evaluated, so the test cannot drift from shipped code.
 * Covers the required cases A-H plus the invariant that no record may be routed nowhere.
 *
 * SCOPE: this is pure routing/decision logic. It does NOT touch REI, Gmail, Sheets or Calendar, and
 * therefore proves nothing about those integrations.
 */
import fs from 'node:fs';
import path from 'node:path';

const HTML = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');

// Pull the live SECTIONS array out of the dashboard source and evaluate it.
const start = HTML.indexOf('var SECTIONS=[');
const end = HTML.indexOf('\n];', start) + 3;
if (start < 0 || end <= start) throw new Error('Could not locate SECTIONS in Dashboard.html');
// Declare SECTIONS *inside* the evaluated scope, exactly as the browser does, so the catch-all
// predicate (which refers to SECTIONS to ask "did anything above claim this record?") resolves.
/*
 * todayISO is injected, and FIXED.
 *
 * The Follow Up section asks whether a visit date has already passed, so the predicates now need the date
 * helper the browser gives them. Passing the real one would make this suite's answers change overnight —
 * "visit next week" quietly becomes "visit last week" — so a fixed day is supplied instead and the records
 * below are written relative to it.
 */
const TODAY_ISO = '2026-08-06';
const SECTIONS = new Function('todayISO', `${HTML.slice(start, end)}\nreturn SECTIONS;`)(() => TODAY_ISO);

/** Which sections claim this record. */
function route(rec) {
  const r = { stage: '', dq: '', daysOverdue: 0, stalled: false, sla: '', conflict: false,
              gift: '', handoff: '', disposition: '', daysSince: '', gap: 0, ...rec };
  // Deliberately NOT swallowing predicate errors: a throwing predicate silently drops records, which
  // is precisely the class of bug this suite exists to catch.
  return SECTIONS.filter(([, pred]) => !!pred(r)).map(([title]) => title);
}

let pass = 0, fail = 0;
function check(name, actual, expect) {
  const ok = expect(actual);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        sections: [${actual.join(' | ') || '(none)'}]`);
  ok ? pass++ : fail++;
}
const has = (s) => (got) => got.some((t) => t.includes(s));
const lacks = (s) => (got) => !got.some((t) => t.includes(s));
const both = (...fns) => (got) => fns.every((f) => f(got));

console.log('=== A. Visit Scheduled, complete date+time ===');
check('A routes to Upcoming Visits', route({ stage: 'Visit Scheduled', dq: 'OK' }),
  both(has('Upcoming Visits'), lacks('Unrouted')));

console.log('\n=== B. Date but NO time -> not actionable ===');
// Scraper writes neither Visit Status nor Current Stage, so the sheet flags it Incomplete.
check('B routes to Exceptions Requiring Review', route({ stage: '', dq: 'Incomplete' }),
  both(has('Exceptions Requiring Review'), lacks('Upcoming Visits')));

console.log('\n=== C. Offer Preparation ===');
check('C routes to Offer Preparation (was previously unrouted)', route({ stage: 'Offer Preparation', dq: 'OK' }),
  both(has('Offer Preparation'), lacks('Unrouted'), lacks('Upcoming Visits')));

console.log('\n=== D. Follow-up / nurture, no appointment ===');
check('D routes to Long-Term Nurture', route({ stage: 'Long-Term Nurture', dq: 'OK' }),
  both(has('Long-Term Nurture'), lacks('Unrouted')));

console.log('\n=== E. Rescheduled (still scheduled, new date) ===');
check('E stays in Upcoming Visits', route({ stage: 'Visit Scheduled', dq: 'OK' }), has('Upcoming Visits'));

console.log('\n=== F. Cancelled appointment ===');
// Cancellation clears Current Stage, so the sheet flags the row for review.
check('F routes to Exceptions, NOT Upcoming Visits', route({ stage: '', dq: 'Incomplete' }),
  both(has('Exceptions Requiring Review'), lacks('Upcoming Visits')));

console.log('\n=== G. Missing REI link ===');
check('G routes to Exceptions (Missing Required Fields -> Incomplete)',
  route({ stage: 'Visit Scheduled', dq: 'Incomplete' }), has('Exceptions Requiring Review'));

console.log('\n=== H. Unknown / unmapped stage ===');
check('H is surfaced, never silently dropped', route({ stage: 'Appointment Booked', dq: 'OK' }),
  has('Unrouted'));

console.log('\n=== INVARIANT: every legal stage lands somewhere ===');
const STAGES = ['Visit Scheduled', 'Visit Completed — Needs Review', 'Offer Preparation', 'Offer Sent',
  'Active Negotiation', 'Verbal Agreement', 'Contract Sent', 'Contract Signed', 'Long-Term Nurture'];
for (const stage of STAGES) {
  check(`"${stage}" is routed`, route({ stage, dq: 'OK' }), (got) => got.length > 0);
}
check('"Lost / Closed Out" is intentionally archived (no section)',
  route({ stage: 'Lost / Closed Out', dq: 'OK' }), (got) => got.length === 0);

console.log('\n=== REGRESSION: the exact records from the audit report ===');
/*
 * David Fischer's record was written when 2026-08-05 was still ahead. Against the fixed today of 2026-08-06 it
 * is a day past, so it now belongs in Follow Up — which is the change Cherry asked for, not a regression. The
 * original intent of this check was "a Visit Scheduled lead reaches a visit section at all", so both halves are
 * asserted rather than the date being quietly moved to keep the old answer.
 */
check('David Fischer / Visit Scheduled 2026-08-05, now a day past -> Follow Up',
  route({ stage: 'Visit Scheduled', dq: 'OK', visitDate: '2026-08-05' }),
  has('Follow Up — Outcome Not Known Yet'));
check('...and the same lead dated ahead -> Upcoming Visits',
  route({ stage: 'Visit Scheduled', dq: 'OK', visitDate: '2026-08-20' }), has('Upcoming Visits'));
check('Test lead / Offer Preparation -> Offer Preparation',
  route({ stage: 'Offer Preparation', dq: 'OK', owner: 'Juan' }), has('Offer Preparation'));

console.log("\n=== Cherry's third visit section: OFF and UNKNOWN are different jobs ===");
/*
 * Cherry: "if there was lead is suddenly cancelled but not sure if the lead will go or what, should had a
 * pending tab", and about Jose: "this was for follow up, should move to follow up tab."
 *
 * Off means decide — rebook or close out. Unknown means find out first, and there is nothing to decide until
 * somebody has spoken to the seller. One heading over both told the reader to make a decision they had no
 * facts for.
 */
const FOLLOW = 'Follow Up — Outcome Not Known Yet';
const CANCELLED = 'Cancelled — Close Out or Rebook';
const UPCOMING = 'Upcoming Visits (Scheduled)';
const visit = (visitStatus, visitDate) => ({ stage: 'Visit Scheduled', dq: 'OK', visitStatus, visitDate });

// Jose Anguiano: visit was Aug 1, still marked Scheduled on Aug 6. The case Cherry named.
check('an overdue visit is in Follow Up, not Upcoming',
  route(visit('Scheduled', '2026-08-01')), both(has(FOLLOW), lacks(UPCOMING), lacks(CANCELLED)));
// A visit still to come stays exactly where it was.
check('a visit still to come stays in Upcoming',
  route(visit('Scheduled', '2026-08-12')), both(has(UPCOMING), lacks(FOLLOW)));
// Today is the boundary people get wrong: today's visit is upcoming, not overdue.
check("today's visit is upcoming, not overdue",
  route(visit('Scheduled', TODAY_ISO)), both(has(UPCOMING), lacks(FOLLOW)));
// Called off but still wanted: find out, do not decide.
check('reschedule-needed is in Follow Up, no longer under Cancelled',
  route(visit('Reschedule Needed', '2026-08-12')), both(has(FOLLOW), lacks(CANCELLED), lacks(UPCOMING)));
// Definitely off: a decision is owed.
check('a cancelled visit is in Cancelled only',
  route(visit('Canceled', '2026-08-12')), both(has(CANCELLED), lacks(FOLLOW), lacks(UPCOMING)));
/*
 * A cancelled visit whose date has also passed must not appear twice. Cancelled wins: somebody said it was off,
 * which is a fact, and "we do not know what happened" is not true of it.
 */
check('a cancelled PAST visit is in Cancelled only',
  route(visit('Canceled', '2026-08-01')), both(has(CANCELLED), lacks(FOLLOW)));

// The three visit sections must be mutually exclusive for every combination that can occur.
for (const status of ['Scheduled', 'Canceled', 'Reschedule Needed']) {
  for (const date of ['2026-08-01', TODAY_ISO, '2026-08-12', '']) {
    check(`${status} / ${date || 'no date'} lands in at most one visit section`,
      route(visit(status, date)),
      (got) => got.filter((t) => t === UPCOMING || t === FOLLOW || t === CANCELLED).length <= 1);
  }
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
