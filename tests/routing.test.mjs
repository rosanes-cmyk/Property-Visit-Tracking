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
const SECTIONS = new Function(`${HTML.slice(start, end)}\nreturn SECTIONS;`)();

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
check('David Fischer / Visit Scheduled 2026-08-05 -> Upcoming Visits',
  route({ stage: 'Visit Scheduled', dq: 'OK', visitDate: '2026-08-05' }), has('Upcoming Visits'));
check('Test lead / Offer Preparation -> Offer Preparation',
  route({ stage: 'Offer Preparation', dq: 'OK', owner: 'Juan' }), has('Offer Preparation'));

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
