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
  recheckKey, parseSheetDate, sheetDayKey, reiFieldsFromScrape, diffFromRei, calendarAffected,
  describeChanges
} from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';
import fs from 'node:fs';

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
/*
 * The first live run reported "no change in REI" for a visit five days overdue. That reads like a clean
 * bill of health, when it could equally have meant the page returned nothing at all — and those two need
 * different actions from a person. Agreement and silence must not share a sentence.
 */
check('agreement says so', describeChanges(JOSE, [], { 'Visit Date': '08/01/2026' }),
  'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · REI agrees with the sheet');
check('silence from REI says something different',
  describeChanges(JOSE, [], {}).includes('REI returned NOTHING to compare'), true);
check('...and suggests why', describeChanges(JOSE, [], {}).includes('may not have rendered'), true);
check('with no reiFields given it stays neutral',
  describeChanges(JOSE, []), 'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · REI agrees with the sheet');
check('a change names both values',
  describeChanges(JOSE, [{ field: 'Visit Status', from: 'Scheduled', to: 'Canceled' }]),
  'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · Visit Status: "Scheduled" -> "Canceled"');
check('a blank before is spelled out, not shown as nothing',
  describeChanges(JOSE, [{ field: 'Email', from: '', to: 'jose@example.com' }]).includes('"(blank)" -> "jose@example.com"'), true);

console.log('\n=== --only ignores the schedule, never the eligibility rules ===');
/*
 * The first live run: `--only "Jose"` picked five rows, four of which had no REI link, and reported four
 * failures the run could have predicted before opening a browser. It also matched "San Jose" in the
 * address, which is how a search for one seller returned five.
 */
const RUNNER = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('seller names are tried first', /const bySeller = rows\.filter/.test(RUNNER), true);
check('the address is only a fallback', /bySeller\.length\s*\?\s*bySeller/.test(RUNNER), true);
check('it says which one matched', /matched \$\{matched\.length\} on seller name/.test(RUNNER), true);
check('eligibility is still enforced', /const why = recheckSkipReason\(row\);/.test(RUNNER), true);
check('...and it says what it dropped and why', /skipping \$\{row\['Seller Name'\]\} — \$\{why\}/.test(RUNNER), true);
check('the coverage limit is stated, not buried in a tally',
  /can ever be re-checked/.test(RUNNER), true);
// The whole point: a row with no REI link must never reach the browser.
check('a linkless row is ineligible, so --only cannot reach it',
  recheckSkipReason({ ...JOSE, 'REI BlackBook Link': '' }), 'no REI link');

console.log('\n=== REI saying the visit is DONE has to reach the tracker ===');
/*
 * The hole this closes, and it was the client's actual complaint rather than a hypothetical.
 *
 * taskStatus could only ever be 'Cancelled' or blank, so the only question a re-check knew how to ask
 * was whether the visit had been called off. Somebody could tick the appointment task complete in REI
 * and the run would report "REI agrees with the sheet" for a lead four days overdue.
 */
const DONE = reiFieldsFromScrape({
  taskStatus: 'Completed', appointmentStartIso: '2026-08-01T10:30:00-07:00'
}, { zone: 'America/Los_Angeles' });
check('a completed REI task becomes Visit Status = Completed', DONE['Visit Status'], 'Completed');
check("...spelled exactly as the workbook's dropdown spells it",
  ['Scheduled', 'Completed', 'Canceled', 'Reschedule Needed'].includes(DONE['Visit Status']), true);
check('the visit date is kept — a completed visit still says which day it happened',
  DONE['Visit Date'], '08/01/2026');
// Cancelled must still win: a visit cannot be both called off and carried out.
check('cancelled outranks completed',
  reiFieldsFromScrape({ taskStatus: 'Cancelled Appointment', appointmentStartIso: '2026-08-01T10:30:00-07:00' })['Visit Status'],
  'Canceled');
check('a blank task status still means neither',
  reiFieldsFromScrape({ taskStatus: '', appointmentStartIso: '2026-08-01T10:30:00-07:00' })['Visit Status'],
  undefined);

console.log('\n--- and it drags the stage with it, in ONE direction only ---');
/*
 * Setting Visit Status = Completed and stopping there is a worse lie than the stale "Scheduled": the 3pm
 * message would keep the lead under "Upcoming Visit — confirm the visit is going ahead" for a visit that
 * already happened, and the card would show no flag at all. The workbook makes this exact move itself
 * (onVisitStatus_) but a Sheets API write never fires onEdit, so the re-check must make it too.
 */
const doneChanges = diffFromRei(JOSE, DONE);
check('the stage advances off Visit Scheduled',
  doneChanges.find((c) => c.field === 'Current Stage')?.to, 'Visit Completed — Needs Review');
check('the em dash matches the dropdown exactly',
  doneChanges.find((c) => c.field === 'Current Stage')?.to.includes('—'), true);
// The refusal that makes it safe: never rewind human forward progress.
for (const stage of ['Offer Preparation', 'Offer Sent', 'Active Negotiation', 'Verbal Agreement',
  'Contract Sent', 'Contract Signed', 'Lost / Closed Out']) {
  check(`a lead already at "${stage}" keeps its stage`,
    diffFromRei({ ...JOSE, 'Current Stage': stage }, DONE).some((c) => c.field === 'Current Stage'), false);
}
check('a cancellation never touches the stage — that stays a human decision',
  diffFromRei(JOSE, { 'Visit Status': 'Canceled' }).some((c) => c.field === 'Current Stage'), false);
check('Current Stage is still NOT in RECHECKABLE — the exception is guarded, not general',
  RECHECKABLE.includes('Current Stage'), false);
check('a re-run changes nothing once applied',
  diffFromRei({ ...JOSE, 'Visit Status': 'Completed', 'Current Stage': 'Visit Completed — Needs Review',
    'Visit Date': '08/01/2026', 'Visit Time': '10:30 AM' }, DONE), []);

console.log('\n=== A visit happening today is on the SHORT clock ===');
/*
 * Only past-dated visits used to get the 2-hour clock, which left the window that matters uncovered: a
 * seller calling off a 2pm visit at 10am would not be looked at again for up to 24 hours — hours after
 * Juan had already driven there.
 */
const oneHourAgo = new Date(NOW.getTime() - 3600000).toISOString();
const TODAY = { ...JOSE, 'Visit Date': '08/05/2026' };
const TOMORROW = { ...JOSE, 'Visit Date': '08/06/2026' };
const NEXT_WEEK = { ...JOSE, 'Visit Date': '08/12/2026' };
check("today's visit is due after 2 hours", recheckUrgency(TODAY, new Date(NOW.getTime() - 3 * 3600000).toISOString(), { now: NOW }) > 0, true);
check("...but not after only 1", recheckUrgency(TODAY, oneHourAgo, { now: NOW }), 0);
check("tomorrow's visit is on the short clock too",
  recheckUrgency(TOMORROW, new Date(NOW.getTime() - 3 * 3600000).toISOString(), { now: NOW }) > 0, true);
check('next week is still on the 24-hour clock',
  recheckUrgency(NEXT_WEEK, new Date(NOW.getTime() - 3 * 3600000).toISOString(), { now: NOW }), 0);
check('a visit already cancelled is not urgent just because it is today',
  recheckUrgency({ ...TODAY, 'Visit Status': 'Canceled' }, oneHourAgo, { now: NOW }), 0);

console.log('\n--- strict tiers: overdue beats imminent beats stale ---');
const stale = { ...NEXT_WEEK };
const fiveHoursAgo = new Date(NOW.getTime() - 5 * 3600000).toISOString();
const uOverdue = recheckUrgency(JOSE, fiveHoursAgo, { now: NOW });        // Aug 1, passed
const uImminent = recheckUrgency(TODAY, fiveHoursAgo, { now: NOW });
const uStale = recheckUrgency(stale, new Date(NOW.getTime() - 100 * 3600000).toISOString(), { now: NOW });
check('overdue is the most urgent', uOverdue > uImminent, true);
check('imminent beats merely stale', uImminent > uStale, true);
// A never-checked lead scores 1e5; both bumps must sit above it or the ordering collapses.
check('an imminent visit outranks a never-checked one',
  uImminent > recheckUrgency(stale, null, { now: NOW }), true);
check('overdue still sorts first out of a mixed batch',
  pickRecheckCandidates([stale, TODAY, JOSE], {}, { now: NOW, limit: 3 }).map((r) => r['Visit Date']),
  ['08/01/2026', '08/05/2026', '08/12/2026']);

console.log('\n--- which day a visit is on must not depend on the server timezone ---');
/*
 * Found by this suite: parseSheetDate builds a Date at the SERVER's local midnight and dayKey rendered
 * it in Pacific, so on a UTC machine '08/05/2026' came back as '2026-08-04' and a visit happening TODAY
 * was classified as already overdue. The scheduled task runs unattended on whatever timezone the machine
 * is set to, so this had to stop depending on it.
 */
check("a written US date is the day it says", sheetDayKey('08/05/2026'), '2026-08-05');
check('a single-digit month and day too', sheetDayKey('8/5/2026'), '2026-08-05');
check('an ISO date cell is unchanged', sheetDayKey('2026-08-05'), '2026-08-05');
check('a blank is blank, not epoch', sheetDayKey(''), '');
check('the first of the month does not roll back a month', sheetDayKey('08/01/2026'), '2026-08-01');
check('new year does not roll back a year', sheetDayKey('01/01/2026'), '2026-01-01');
// The actual consequence, stated as the behaviour rather than the helper.
check("a visit today is imminent, NOT overdue — it was overdue before this fix",
  recheckUrgency(TODAY, fiveHoursAgo, { now: NOW }) < 2e6, true);
check('...and a visit yesterday still is overdue',
  recheckUrgency({ ...JOSE, 'Visit Date': '08/04/2026' }, fiveHoursAgo, { now: NOW }) > 2e6, true);

console.log('\n=== A cancelled event is TAGGED and KEPT, on BOTH sides ===');
/*
 * Cherry reversed this rule directly: "if the status of the calendar is cancelled it should not be
 * removed in the calendar and this will notify as well." The workbook side was changed to tag. The NODE
 * side still deleted — and the node side is what the timed re-check calls, so the one path that finds a
 * cancellation with nobody watching would have deleted the event and undone her rule.
 */
const CAL = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/google/calendar.mjs', import.meta.url), 'utf8');
check('the cancel branch no longer deletes', /isCancelled\(visit\.taskStatus\)\)\s*\{\s*\n\s*if \(!eventId\) return '';\s*\n\s*return tagEventCancelled/.test(CAL), true);
check('there is exactly one events.delete left in the file',
  (CAL.match(/events\.delete/g) || []).length, 0);
check('it tags with the same prefix the workbook uses', /CANCEL_TAG = '\[CANCELED\] '/.test(CAL), true);
check('every reminder is removed — a cancelled visit must not send anyone driving',
  /reminders: \{ useDefault: false, overrides: \[\] \}/.test(CAL), true);
check('tagging twice is a no-op', /if \(summary\.startsWith\(CANCEL_TAG\)\) return eventId;/.test(CAL), true);
check('the seller is never notified', /sendUpdates: 'none'/.test(CAL), true);
check('the reason and date are stamped on the description', /kept for the record/.test(CAL), true);
check('the row keeps pointing at a real event', /return eventId;\s*\n\}/.test(CAL), true);

console.log('\n=== A status change found by the timer tells the team ===');
/*
 * A Sheets API write does not fire onEdit, so NONE of the workbook's own alerts run for anything the
 * re-check changes. Without this the timer could correct a cancellation silently, and for a visit later
 * the same day silent is exactly too late.
 */
check('the runner posts to Chat', /import \{ notifyChat \}/.test(RUNNER), true);
check('only a status change is announced', /const statusChange = changes\.find\(\(c\) => c\.field === 'Visit Status'\)/.test(RUNNER), true);
check('a cancellation is flagged as a warning', /kind: statusChange\.to === 'Canceled' \? 'warn' : 'ok'/.test(RUNNER), true);
check('a cosmetic diff stays quiet', /if \(statusChange\) \{/.test(RUNNER), true);
// Tagging needs no appointment time; requiring one skipped the calendar for the worst cancellations.
check('a cancellation reaches the calendar even with no appointment time left',
  /\(cancelling \|\| scraped\.appointmentStartIso\)/.test(RUNNER), true);

console.log('\n=== The scraper can actually SEE a completed task ===');
const SCRAPER = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/scraper.mjs', import.meta.url), 'utf8');
check('taskStatus is no longer only Cancelled-or-blank',
  /taskStatus = cancelled \? 'Cancelled' : visitTaskState === 'complete' \? 'Completed' : ''/.test(SCRAPER), true);
check('it reads scoped task rows, not a page-wide regex', /readTasks\(page, selectorConfig/.test(SCRAPER), true);
check('the task must match THIS visit on phone and date', /taskMatchesVisit\(t, thisVisit\)/.test(SCRAPER), true);
// readTasks only. completeTask is the single REI write this project can make and must not be reachable
// from a read path; the name appears in the scraper only in the comment saying so.
check('it imports the read-only task lister', /^import \{ readTasks \} from '\.\/tasks\.mjs';$/m.test(SCRAPER), true);
check('it never imports the one function that WRITES to REI',
  /^import[^\n]*completeTask/m.test(SCRAPER), false);
// The distinction is asserted properly further down; nothing may collapse "could not read" into a false.
check('there is no bare boolean left to collapse the three states into two',
  /taskComplete/.test(SCRAPER), false);

console.log('\n=== "REI agrees" must not be printed when the question went unanswered ===');
/*
 * The live run on Jose printed "REI agrees with the sheet" for a lead whose visit was four days past.
 * That is true about the dates and says nothing about the thing that actually matters — did the visit
 * happen? — and it reads as a clean bill of health.
 *
 * Absent cannot be treated as complete: REI MOVES a completed task out of the panel (completeTask's own
 * confirmation logic relies on that), so 'gone' can mean 'done' — but it can equally mean the panel did
 * not render, and stamping 'Completed' on every lead whose page failed to load would be a catastrophe.
 * So the three states stay distinct and the run says which one it got.
 */
const AGREES = { 'Seller Name': 'Jose Anguiano', 'Property Address': '2145 Capitol Ave' };
const said = (state, reason) => describeChanges(AGREES, [], { 'Visit Date': '08/01/2026' },
  { visitTaskState: state, visitTaskReason: reason });

check('an unreadable task list is NOT reported as agreement',
  /could not tell us whether the visit happened/.test(said('unknown', 'no booked-appointment task rows could be read')), true);
check('...and it says exactly why',
  /no booked-appointment task rows could be read/.test(said('unknown', 'no booked-appointment task rows could be read')), true);
check('...and it names the tool that settles it',
  /rei-task-doctor/.test(said('unknown', 'x')), true);
check('an OPEN task says REI does not know either',
  /REI still has the visit task OPEN/.test(said('open', 'still open')), true);
check('...and names who has to act', /Somebody has to mark it Completed or Canceled/.test(said('open', 'x')), true);
check('a plain agreement is still short', said('not-checked', ''),
  'Jose Anguiano · 2145 Capitol Ave · REI agrees with the sheet');
// Back-compatible: the runner's summary loop calls it with two arguments.
check('it still works with no scrape passed',
  describeChanges(AGREES, [], { 'Visit Date': '08/01/2026' }),
  'Jose Anguiano · 2145 Capitol Ave · REI agrees with the sheet');
check('a real change still wins over any task state',
  /Visit Status/.test(describeChanges(AGREES, [{ field: 'Visit Status', from: 'Scheduled', to: 'Completed' }],
    {}, { visitTaskState: 'unknown', visitTaskReason: 'x' })), true);
check('"REI returned NOTHING" still takes precedence over the task state',
  /REI returned NOTHING/.test(describeChanges(AGREES, [], {}, { visitTaskState: 'unknown', visitTaskReason: 'x' })), true);

console.log('\n--- the scraper distinguishes complete / open / unknown ---');
check('only a complete task becomes Completed',
  /visitTaskState === 'complete' \? 'Completed' : ''/.test(SCRAPER), true);
check('a matched-but-open task is "open", not "unknown"', /visitTaskState = 'open'/.test(SCRAPER), true);
check('an empty task list is "unknown", never "open"',
  /if \(!tasks\.length\) \{\s*\n\s*visitTaskState = 'unknown'/.test(SCRAPER), true);
check('a task that does not match this visit is also "unknown"',
  /none matching this /.test(SCRAPER), true);
check('a thrown error is "unknown" and carries the message',
  /visitTaskState = 'unknown';\s*\n\s*visitTaskReason = `reading the task list failed/.test(SCRAPER), true);
check('the state and the reason both reach the caller',
  /visitTaskState,\s*\n\s*visitTaskReason,/.test(SCRAPER), true);
check('the runner passes the scrape in so it can say so',
  /describeChanges\(row, changes, reiFields, scraped\)/.test(RUNNER), true);

console.log('\n--- and the closing summary cannot contradict it ---');
/*
 * The live run printed the honest per-lead line and then, four lines later, "REI agrees with the sheet on
 * every lead checked. Nothing to change." The second is what a person skims and remembers, and it was the
 * one that was wrong.
 */
check('unanswered leads are collected during the run',
  /if \(scraped\.visitTaskState === 'unknown'\) unanswered\.push/.test(RUNNER), true);
check('the summary leads with them', /could NOT be verified/.test(RUNNER), true);
check('it says those rows are still possibly wrong',
  /These rows are UNCHANGED and may still be wrong/.test(RUNNER), true);
check('it hands over the command that settles it',
  /rei-task-doctor\.mjs "\$\{unanswered\[0\]\.row\['REI BlackBook Link'\]\}"/.test(RUNNER), true);
// The blanket all-clear is now reachable ONLY when nothing changed AND nothing went unanswered.
check('"REI agrees on every lead" requires both conditions',
  /if \(!changedRows\.length && !unanswered\.length\) \{\s*\n\s*console\.log\('REI agrees with the sheet on every lead checked/.test(RUNNER), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
