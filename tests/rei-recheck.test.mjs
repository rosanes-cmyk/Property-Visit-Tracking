/**
 * Going back to REI for leads already in the tracker.
 *
 *   node tests/rei-recheck.test.mjs
 *
 * The client's words: "Jose Anguiano · OVERDUE — visit was 2026-08-01 and is still marked Scheduled …
 * you will check it time to time the update in rei and then update in the dashboard, it should be
 * accurate." The chain was one-way — one scrape when the booking email arrived, then never again — so a
 * visit completed, cancelled or moved inside REI never reached the tracker.
 *
 * The risk in this feature is not the scraping. It is writing over something a person put there on
 * purpose. Most of what follows tests the refusals.
 */
import {
  RECHECKABLE, ACTIVE_STAGES, recheckSkipReason, recheckUrgency, pickRecheckCandidates,
  recheckKey, parseSheetDate, reiFieldsFromScrape, diffFromRei, calendarAffected, describeChanges
} from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const NOW = new Date('2026-08-05T17:00:00-07:00');   // Aug 5 2026, 5pm Pacific

/** Jose, the record that prompted this: visit date passed, row still says Scheduled. */
const JOSE = {
  'Seller Name': 'Jose Anguiano',
  'Property Address': '2145 Capitol Ave, East Palo Alto, CA, 94303',
  'REI BlackBook Link': 'https://my.reiblackbook.com/contacts/20473369',
  'REI Record ID': '20473369',
  'Current Stage': 'Visit Scheduled',
  'Visit Status': 'Scheduled',
  'Visit Date': '08/01/2026',
  'Visit Time': '10:30 AM',
  'Phone': '(650) 771-7814'
};

console.log('=== Only a short list of fields may ever be overwritten ===');
/*
 * This list IS the safety model. Anything on it can be rewritten from a web page without a human
 * looking; anything off it cannot. Each addition would need arguing for on its own.
 */
check('the re-checkable fields', RECHECKABLE,
  ['Visit Date', 'Visit Time', 'Visit Status', 'Seller Name', 'Phone', 'Email']);
check('Current Stage is NOT re-checkable — the team moves it', RECHECKABLE.includes('Current Stage'), false);
check('Visit Notes is NOT — the visitor wrote it', RECHECKABLE.includes('Visit Notes'), false);
check('Seller Motivation is NOT — it comes from a conversation', RECHECKABLE.includes('Seller Motivation'), false);
check('Approved Offer Amount is NOT — it is a decision, and money',
  RECHECKABLE.includes('Approved Offer Amount'), false);
check('Next Action is NOT — somebody committed to it', RECHECKABLE.includes('Next Action'), false);
check('Assigned Owner is NOT — a reassignment is a human call', RECHECKABLE.includes('Assigned Owner'), false);

console.log('\n=== Which rows are worth asking REI about ===');
check('Jose qualifies', recheckSkipReason(JOSE), '');
check('no REI link, nothing to open — this is every imported row',
  recheckSkipReason({ ...JOSE, 'REI BlackBook Link': '' }), 'no REI link');
check('a test row is skipped', recheckSkipReason({ ...JOSE, Source: 'TEST' }), 'test row');
check('a closed-out lead is not going to change usefully',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Lost / Closed Out' }), 'stage "Lost / Closed Out" is not active');
check('nor is a signed contract',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Contract Signed' }), 'stage "Contract Signed" is not active');
check('a blank stage is skipped', recheckSkipReason({ ...JOSE, 'Current Stage': '' }), 'no stage');
check('every active stage is a real dropdown value', ACTIVE_STAGES.length, 7);

console.log('\n=== A passed visit still marked Scheduled jumps the queue ===');
/*
 * This is Jose's case, and it is the whole reason the feature exists. The appointment is in the past,
 * the row still claims it is coming, and while that stays true the board is wrong about today. It gets
 * a 2-hour clock instead of 24, and a huge urgency bump so it is checked before anything else.
 */
const joseUrgency = recheckUrgency(JOSE, '2026-08-05T14:00:00-07:00', { now: NOW });
const normal = { ...JOSE, 'Visit Date': '08/20/2026' };
check('Jose is due after 3 hours', joseUrgency > 0, true);
check('a future visit checked 3 hours ago is NOT due yet',
  recheckUrgency(normal, '2026-08-05T14:00:00-07:00', { now: NOW }), 0);
check('...and IS due after 25 hours',
  recheckUrgency(normal, '2026-08-04T15:00:00-07:00', { now: NOW }) > 0, true);
check('Jose outranks an ordinary stale lead by a mile',
  joseUrgency > recheckUrgency(normal, '2026-08-01T15:00:00-07:00', { now: NOW }), true);
check('never checked at all is due immediately',
  recheckUrgency(JOSE, '', { now: NOW }) > 0, true);
check('a skipped row has no urgency however stale',
  recheckUrgency({ ...JOSE, 'REI BlackBook Link': '' }, '', { now: NOW }), 0);
// A completed visit whose date has passed is normal, not urgent — that is what completed means.
check('a passed visit marked Completed is not urgent',
  recheckUrgency({ ...JOSE, 'Visit Status': 'Completed' }, '2026-08-05T14:00:00-07:00', { now: NOW }), 0);

console.log('\n=== The run is capped, because each one opens a browser ===');
const many = Array.from({ length: 40 }, (_, i) => ({
  ...JOSE, 'REI Record ID': String(1000 + i), 'Visit Date': '08/20/2026', 'Seller Name': `Seller ${i}`
}));
check('40 due rows produce 5 candidates', pickRecheckCandidates(many, {}, { now: NOW }).length, 5);
check('the cap is adjustable', pickRecheckCandidates(many, {}, { now: NOW, limit: 2 }).length, 2);
check('an accurate sheet produces none',
  pickRecheckCandidates(many, Object.fromEntries(many.map((r) => [recheckKey(r), { lastCheckedAt: NOW.toISOString() }])),
    { now: NOW }).length, 0);
// Jose must come first even when he is buried among 40 others.
const mixed = [...many, JOSE];
check('the passed-but-scheduled lead is checked first',
  pickRecheckCandidates(mixed, {}, { now: NOW })[0]['Seller Name'], 'Jose Anguiano');
check('the state key prefers the REI record id', recheckKey(JOSE), '20473369');
check('...and falls back to the link',
  recheckKey({ ...JOSE, 'REI Record ID': '' }), 'https://my.reiblackbook.com/contacts/20473369');

console.log('\n=== Reading dates the way the sheet writes them ===');
/** yyyy-mm-dd from a local Date, so a parse can be asserted without pulling in a date library. */
const ymd = (d) => (d
  ? [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
  : null);
check("visitToRecord's own format", ymd(parseSheetDate('08/01/2026')), '2026-08-01');
check('single-digit month and day', ymd(parseSheetDate('8/1/2026')), '2026-08-01');
check('an ISO string', ymd(parseSheetDate('2026-08-01')), '2026-08-01');
check('a real Date object', ymd(parseSheetDate(new Date(2026, 7, 1))), '2026-08-01');
check('a blank cell', parseSheetDate(''), null);
check('junk text', parseSheetDate('ASAP'), null);

console.log('\n=== What REI says, in the sheet\'s own shape ===');
check('a moved appointment',
  reiFieldsFromScrape({ appointmentStartIso: '2026-08-08T14:00:00-07:00' }),
  { 'Visit Date': '08/08/2026', 'Visit Time': '2:00 PM' });
check('a cancellation in REI', reiFieldsFromScrape({ taskStatus: 'Cancelled' }), { 'Visit Status': 'Canceled' });
/*
 * A cancellation deliberately does NOT clear the date. It is the record of the slot that was held, and
 * the workbook's syncVisitCalendar_ needs it to find the event it has to tag.
 */
check('...and keeps the date it was booked for',
  Object.keys(reiFieldsFromScrape({ taskStatus: 'Cancelled', appointmentStartIso: '2026-08-08T14:00:00-07:00' })),
  ['Visit Status']);
check('contact details come through',
  reiFieldsFromScrape({ sellerName: 'Jose Anguiano', phone: '(650) 771-7814', email: 'jose@example.com' }),
  { 'Seller Name': 'Jose Anguiano', Phone: '(650) 771-7814', Email: 'jose@example.com' });
check('an empty scrape yields nothing to write', reiFieldsFromScrape({}), {});

console.log('\n=== The diff, and its three refusals ===');
check('a moved visit is a change',
  diffFromRei(JOSE, { 'Visit Date': '08/08/2026', 'Visit Time': '2:00 PM' }),
  [{ field: 'Visit Date', from: '08/01/2026', to: '08/08/2026' },
   { field: 'Visit Time', from: '10:30 AM', to: '2:00 PM' }]);
check('a cancellation in REI is a change',
  diffFromRei(JOSE, { 'Visit Status': 'Canceled' }),
  [{ field: 'Visit Status', from: 'Scheduled', to: 'Canceled' }]);
check('identical values are not a change', diffFromRei(JOSE, { 'Visit Date': '08/01/2026' }), []);
/*
 * The refusal that matters most. A field missing from a scrape usually means the page did not render or
 * a selector moved — not that the seller has no phone number. Silence is not data.
 */
check('a BLANK from REI never wipes a value in the sheet',
  diffFromRei(JOSE, { Phone: '', 'Seller Name': '' }), []);
check('...not even for the visit date', diffFromRei(JOSE, { 'Visit Date': '' }), []);
check('an entirely empty scrape changes nothing', diffFromRei(JOSE, {}), []);
// Rule 1: anything outside RECHECKABLE is ignored even if a scrape somehow offers it.
check('a stage from REI is ignored',
  diffFromRei(JOSE, { 'Current Stage': 'Offer Sent' }), []);
check('offer money from REI is ignored',
  diffFromRei(JOSE, { 'Approved Offer Amount': 999999 }), []);
check('visit notes from REI are ignored',
  diffFromRei({ ...JOSE, 'Visit Notes': 'Seller was lovely' }, { 'Visit Notes': 'something else' }), []);

console.log('\n=== The calendar has to follow the sheet ===');
/*
 * Moving the date in the sheet without moving the event is the worst possible half-job: the row would be
 * right and Juan would still drive on the old day.
 */
check('a moved date needs the calendar', calendarAffected([{ field: 'Visit Date' }]), true);
check('a moved time needs the calendar', calendarAffected([{ field: 'Visit Time' }]), true);
check('a cancellation needs the calendar', calendarAffected([{ field: 'Visit Status' }]), true);
check('a corrected phone number does not', calendarAffected([{ field: 'Phone' }]), false);
check('no changes, no calendar work', calendarAffected([]), false);

console.log('\n=== What the run reports ===');
check('no change says so plainly',
  describeChanges(JOSE, []), 'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · no change in REI');
check('a change names both values',
  describeChanges(JOSE, [{ field: 'Visit Status', from: 'Scheduled', to: 'Canceled' }]),
  'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · Visit Status: "Scheduled" -> "Canceled"');
check('a blank before is spelled out, not shown as nothing',
  describeChanges(JOSE, [{ field: 'Email', from: '', to: 'jose@example.com' }]).includes('"(blank)" -> "jose@example.com"'), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
