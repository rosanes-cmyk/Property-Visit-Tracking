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
  describeChanges, FILL_IF_BLANK, sameFieldValue
} from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';
import { stageAdvance, stageCloseOut, closeOutRefusal, reiSaysLost, STAGE_LOST }
  from '../twin-visit-logger-sandbox/src/rei/stage-map.mjs';
import { parseTaskTitle } from '../twin-visit-logger-sandbox/src/rei/tasks.mjs';
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
  // A placeholder id on purpose. This fixture previously carried 20473369 — the SAMPLE contact used in
  // this repo's docs and helper scripts — which read like Jose's real link and led to the wrong contact
  // being diagnosed and a cancellation being attributed to the wrong seller. Jose's real link lives in
  // the sheet, not here, and nothing in this suite needs it.
  'REI BlackBook Link': 'https://my.reiblackbook.com/contacts/EXAMPLE-NOT-A-REAL-CONTACT',
  'REI Record ID': 'EXAMPLE-NOT-A-REAL-CONTACT',
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
/*
 * Contract Signed IS active now, and Rob Walker is why. He is Contract Signed and REI holds a gift ordered
 * for him after signing — gifts are follow-up, and follow-up happens once the deal closes, which is exactly
 * when this used to stop looking. See tests/gift.test.mjs.
 */
check('a signed contract IS still worth checking — gifts come after it',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Contract Signed' }), '');
// The two that stay out: plausible, but a guess, and 206 more rows of browser traffic.
check('Long-Term Nurture is still skipped',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Long-Term Nurture' }), 'stage "Long-Term Nurture" is not active');
/*
 * A BLANK stage is now CHECKED, not skipped — twenty-four rows were being dropped for it.
 *
 * The client: "now i need all of them should be re-checked, disposition, notes and all in the REI, all of them,
 * so the tracker is updated." And the rule contradicted the rest of the module: stageAdvance says outright that
 * "a blank stage is not position zero — it is unknown, and a lead with no stage at all should be given the one
 * REI knows." The code was built to fill an empty stage from REI and eligibility never let those rows reach it.
 *
 * Same asymmetry as a blank owner: nobody chose blank. A stage somebody DID choose is still respected.
 */
check('a blank stage is checked, not skipped', recheckSkipReason({ ...JOSE, 'Current Stage': '' }), '');
check('...and REI can then fill it', stageAdvance('', '4 Offer Sent'), 'Offer Sent');
check('a stage a person chose is still respected',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Long-Term Nurture' }), 'stage "Long-Term Nurture" is not active');
check('...including a closed-out one',
  recheckSkipReason({ ...JOSE, 'Current Stage': 'Lost / Closed Out' }), 'stage "Lost / Closed Out" is not active');
check('a linkless row is still skipped, blank stage or not',
  recheckSkipReason({ ...JOSE, 'Current Stage': '', 'REI BlackBook Link': '' }), 'no REI link');
check('every active stage is a real dropdown value', ACTIVE_STAGES.length, 8);

console.log('\n=== A passed visit still marked Scheduled jumps the queue ===');
/*
 * This is Jose's case, and it is the whole reason the feature exists. The appointment is in the past,
 * the row still claims it is coming, and while that stays true the board is wrong about today. It gets
 * a 2-hour clock instead of 24, and a huge urgency bump so it is checked before anything else.
 */
const joseUrgency = recheckUrgency(JOSE, '2026-08-05T14:00:00-07:00', { now: NOW });
const normal = { ...JOSE, 'Visit Date': '08/20/2026' };
check('Jose is due after 3 hours', joseUrgency > 0, true);
/*
 * The window is 20 MINUTES for every active lead, at the client's request: "why this is two hour? should
 * be every 20 mins check it." It used to be 24 hours, with 2 for anything imminent or overdue. A split
 * window would make "checked every 20 minutes" true of a few leads and false of the rest.
 */
check('a lead checked 5 minutes ago is NOT due yet',
  recheckUrgency(normal, new Date(NOW.getTime() - 5 * 60000).toISOString(), { now: NOW }), 0);
check('...and IS due after 21 minutes',
  recheckUrgency(normal, new Date(NOW.getTime() - 21 * 60000).toISOString(), { now: NOW }) > 0, true);
check('the window is configurable, and read in minutes',
  recheckUrgency(normal, new Date(NOW.getTime() - 30 * 60000).toISOString(), { now: NOW, minutes: 60 }), 0);
check('Jose outranks an ordinary stale lead by a mile',
  joseUrgency > recheckUrgency(normal, '2026-08-01T15:00:00-07:00', { now: NOW }), true);
check('never checked at all is due immediately',
  recheckUrgency(JOSE, '', { now: NOW }) > 0, true);
check('a skipped row has no urgency however stale',
  recheckUrgency({ ...JOSE, 'REI BlackBook Link': '' }, '', { now: NOW }), 0);
/*
 * A completed visit is re-checked like any other active lead, but gets NO overdue bump — that is what
 * completed means. With one window for everyone, the tiers are the only thing separating them, so this
 * asserts the tier rather than the window.
 */
const completedUrgency = recheckUrgency({ ...JOSE, 'Visit Status': 'Completed' },
  '2026-08-05T14:00:00-07:00', { now: NOW });
check('a passed visit marked Completed is still due', completedUrgency > 0, true);
check('...but carries no overdue bump', completedUrgency < 1e6, true);
check('...and is outranked by one still claiming to be Scheduled', joseUrgency > completedUrgency, true);

console.log('\n=== The run is capped, because each one opens a browser ===');
const many = Array.from({ length: 40 }, (_, i) => ({
  ...JOSE, 'REI Record ID': String(1000 + i), 'Visit Date': '08/20/2026', 'Seller Name': `Seller ${i}`
}));
/*
 * 20 per run, not 5. Five was chosen when only four rows had a REI link; with 102 linked it spread one pass
 * over about seven hours, so a deal that moved in REI could sit wrong on the board most of a working day.
 */
check('40 due rows produce 20 candidates', pickRecheckCandidates(many, {}, { now: NOW }).length, 20);
check('the cap is adjustable', pickRecheckCandidates(many, {}, { now: NOW, limit: 2 }).length, 2);
check('an accurate sheet produces none',
  pickRecheckCandidates(many, Object.fromEntries(many.map((r) => [recheckKey(r), { lastCheckedAt: NOW.toISOString() }])),
    { now: NOW }).length, 0);
// Jose must come first even when he is buried among 40 others.
const mixed = [...many, JOSE];
check('the passed-but-scheduled lead is checked first',
  pickRecheckCandidates(mixed, {}, { now: NOW })[0]['Seller Name'], 'Jose Anguiano');
check('the state key prefers the REI record id', recheckKey(JOSE), 'EXAMPLE-NOT-A-REAL-CONTACT');
check('...and falls back to the link',
  recheckKey({ ...JOSE, 'REI Record ID': '' }),
  'https://my.reiblackbook.com/contacts/EXAMPLE-NOT-A-REAL-CONTACT');

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
/*
 * Rule 1 used to be "anything outside RECHECKABLE is ignored, full stop". The client overruled that after
 * seeing REI hold Amelia Middel at "4 Offer Sent" with $930,000 out while the board said Visit Scheduled:
 * "its automation right so what it gets in the rei should be update in the dashboard and data its
 * important." So the stage and the offer amount DO come through now, each under its own guard — tested in
 * full in tests/stage-map.test.mjs: the stage advances only forward and never off a closed lead, the money
 * only ever fills an empty cell.
 */
check("REI's stage now advances the lead",
  diffFromRei(JOSE, { 'Current Stage': 'Offer Sent' }).map((c) => `${c.field}=${c.to}`),
  ['Current Stage=Offer Sent']);
check('...but never backwards',
  diffFromRei({ ...JOSE, 'Current Stage': 'Contract Sent' }, { 'Current Stage': 'Offer Sent' }), []);
check('...and never off a lead somebody closed out',
  diffFromRei({ ...JOSE, 'Current Stage': 'Lost / Closed Out' }, { 'Current Stage': 'Offer Sent' }), []);
check('offer money fills an empty cell',
  diffFromRei(JOSE, { 'Approved Offer Amount': 999999 }).map((c) => c.field), ['Approved Offer Amount']);
check('...and never overwrites a figure somebody entered',
  diffFromRei({ ...JOSE, 'Approved Offer Amount': 905000 }, { 'Approved Offer Amount': 999999 }), []);
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
/*
 * Agreement NAMES the fields REI answered on, and the ones it did not.
 *
 * "no changes" and "REI had nothing to say" were indistinguishable, and the difference turned out to be
 * the whole story on the lead this feature was built for: Jose's contact carries no appointment at all,
 * so the dates were never compared — yet the run reported that the dates agreed.
 */
check('agreement names what was actually confirmed',
  describeChanges(JOSE, [], { 'Visit Date': '08/01/2026' }),
  'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · REI confirms Visit Date · ' +
  'REI gave no Visit Time, Seller Name, Phone, Email, so those were NOT checked');
check('a complete answer from REI has nothing unchecked to report',
  describeChanges(JOSE, [], { 'Visit Date': '08/01/2026', 'Visit Time': '10:30 AM',
    'Seller Name': 'Jose Anguiano', Phone: '(650) 771-7814', Email: 'j@example.com' }),
  'Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303 · ' +
  'REI confirms Visit Date, Visit Time, Seller Name, Phone, Email');
// Visit Status is deliberately not reported: REI only yields one on a cancellation or a completion, so on
// a healthy lead it is legitimately blank and listing it every run would be noise.
check('Visit Status is never listed as unchecked',
  /Visit Status/.test(describeChanges(JOSE, [], { 'Visit Date': '08/01/2026' })), false);
// taskPanelOpened is required: without it the run cannot know whether an empty task list means the
// appointment is gone or that the panel never rendered. Asserted properly further down.
check('no appointment on the page is called out as unsettleable — once we have actually looked',
  /no OPEN booked-appointment task/.test(describeChanges(JOSE, [],
    { 'Seller Name': 'Jose Anguiano', Phone: '(650) 771-7814' },
    { visitTaskState: 'unknown', visitTaskReason: 'the Tasks panel was opened and holds no booked-appointment task',
      taskPanelOpened: true })), true);
check('...but a lead REI still holds an appointment for is not',
  /no OPEN booked-appointment task/.test(describeChanges(JOSE, [],
    { 'Visit Date': '08/12/2026', 'Visit Time': '2:00 PM' },
    { visitTaskState: 'unknown', visitTaskReason: 'x', taskPanelOpened: true })), false);
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
// Matching is tiered, most-specific first, and stops at the first tier that hits. The ordering itself is
// asserted below; here it is enough that the tiers exist and that the address is not tried first.
check('seller names are tried first', /\['seller name',/.test(RUNNER), true);
check('the address is only a fallback', /\['property address',/.test(RUNNER), true);
check('it says which tier matched', /matched \$\{matched\.length\} row\(s\): \$\{hitOn\.join/.test(RUNNER), true);
check('and it stops at the first tier that hits',
  /if \(found\.length\) \{ on = label; break; \}/.test(RUNNER), true);

/*
 * SEVERAL leads at once. The client, pointing at a card of eight: "the picture only i gave it, that should be
 * for now, not all." Eight separate commands means eight separate waits for the REI lock, and the eight are
 * one job.
 */
check('--only splits on commas', /ONLY\.split\(','\)/.test(RUNNER), true);
check('...trimming each part, so "a, b" works', /\.map\(\(part\) => part\.trim\(\)\)/.test(RUNNER), true);
check('...and a pasted URL still reduces to its contact id',
  /part\.match\(\/contacts\\\/\(\\d\+\)\\\/\)/.test(RUNNER)
  || /contacts\\\/\(\\d\+\)/.test(RUNNER), true);
/*
 * Merged by row number. A needle matching two rows, or two needles matching one row, must not check a lead
 * twice — that would double the REI page loads and could report the same change twice in the audit log.
 */
check('results are deduped by row', /const byRow = new Map\(\)/.test(RUNNER), true);
check('...and kept in sheet order', /sort\(\(a, b\) => a\.__rowNumber - b\.__rowNumber\)/.test(RUNNER), true);
/*
 * A needle that matched nothing is named on its own. With one needle that was the whole story; with eight it
 * is the difference between "seven are queued and Chan is not in the tracker" and a bare count that reads as
 * though everything was found.
 */
check('a needle that found nothing is named individually',
  /NOT FOUND: \$\{missed\.map/.test(RUNNER), true);
check('...and the advice for a lead that was never logged survives',
  /add-visit-from-rei\.mjs/.test(RUNNER), true);
check('eligibility is still enforced', /const why = recheckSkipReason\(row\);/.test(RUNNER), true);
check('...and it says what it dropped and why', /skipping \$\{row\['Seller Name'\]\} — \$\{why\}/.test(RUNNER), true);
check('the coverage limit is stated, not buried in a tally',
  /can ever be re-checked/.test(RUNNER), true);
/*
 * The closing footer must list what the run can actually change. It printed only RECHECKABLE, directly
 * underneath a run that had just changed Current Stage, Approved Offer Amount and Next Action — a summary
 * contradicting the evidence above it, for the fourth time in this feature.
 */
check('the footer separates overwrite from fill-only',
  /Fields a re-check may overwrite:[\s\S]*Fields it may fill only when empty:/.test(RUNNER), true);
check('...and names the stage rule', /advanced FORWARD only/.test(RUNNER), true);
check('...and the Next Action rule', /still holding the automation's own wording/.test(RUNNER), true);
check('...and what is never touched', /Never touched: Visit Notes, Seller Motivation/.test(RUNNER), true);
// The whole point: a row with no REI link must never reach the browser.
check('a linkless row is ineligible, so --only cannot reach it',
  recheckSkipReason({ ...JOSE, 'REI BlackBook Link': '' }), 'no REI link');

console.log('\n--- and a REI contact id can be named directly ---');
/*
 * Comparing the tracker against one specific REI contact is the natural way to check whether the
 * automation is right, and a contact id is the only identifier that cannot match the wrong lead — unlike
 * a name, where "Jose" also finds "San Jose". Pasting a contact URL used to match nothing at all: the
 * value was compared against the seller name and the address, never against the link.
 */
check('the REI id/link tier exists, between seller and address',
  /\['REI contact id \/ link', \(r\) => `\$\{r\['REI BlackBook Link'\] \|\| ''\} \$\{r\['REI Record ID'\] \|\| ''\}`\]/.test(RUNNER), true);
check('a pasted URL is reduced to its contact id',
  /\.map\(\(part\) => \(part\.match\(\/contacts\\\/\(\\d\+\)\/\) \|\| \[null, part\]\)\[1\]\)/.test(RUNNER), true);
check('the tier that matched is named in the output',
  /matched \$\{matched\.length\} row\(s\): \$\{hitOn\.join/.test(RUNNER), true);
// "not in the tracker" is a different problem from "ineligible", and needs a different action.
check('a contact that is not tracked at all says so', /--only → NOT FOUND: /.test(RUNNER), true);
check('...and names the likely cause rather than leaving it a mystery',
  /the booking email never arrived or never/.test(RUNNER), true);
check('...and hands over the command that adds it',
  /add-visit-from-rei\.mjs/.test(RUNNER), true);
// Seller name still wins, so the "San Jose" fix cannot regress: the address tier is reached last.
check('seller name is still the first tier tried',
  RUNNER.indexOf("['seller name'") < RUNNER.indexOf("['REI contact id / link'"), true);
check('the address is still the last tier tried',
  RUNNER.indexOf("['property address'") > RUNNER.indexOf("['REI contact id / link'"), true);

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
const fiveMinAgo = new Date(NOW.getTime() - 5 * 60000).toISOString();
check("today's visit is due after 21 minutes",
  recheckUrgency(TODAY, new Date(NOW.getTime() - 21 * 60000).toISOString(), { now: NOW }) > 0, true);
check('...but not after only 5', recheckUrgency(TODAY, fiveMinAgo, { now: NOW }), 0);
check("tomorrow's visit is on the same window", recheckUrgency(TOMORROW, oneHourAgo, { now: NOW }) > 0, true);
check('so is next week — one window for every active lead',
  recheckUrgency(NEXT_WEEK, oneHourAgo, { now: NOW }) > 0, true);
// ...but they are not equally URGENT. The tiers decide who goes first when more are due than a run takes.
check("today's visit outranks next week's",
  recheckUrgency(TODAY, oneHourAgo, { now: NOW }) > recheckUrgency(NEXT_WEEK, oneHourAgo, { now: NOW }), true);
check('a visit already cancelled gets no imminent bump',
  recheckUrgency({ ...TODAY, 'Visit Status': 'Canceled' }, oneHourAgo, { now: NOW }) < 1e6, true);
check('...and is outranked by one still marked Scheduled today',
  recheckUrgency(TODAY, oneHourAgo, { now: NOW })
    > recheckUrgency({ ...TODAY, 'Visit Status': 'Canceled' }, oneHourAgo, { now: NOW }), true);

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
/*
 * The tier magnitudes changed when importance ordering was added: 20,000,000 for a board that is wrong
 * about today, 10,000,000 for a visit today or tomorrow. Compared against the boundary between them rather
 * than a hard-coded number, so this keeps testing the BEHAVIOUR and not the arithmetic.
 */
check("a visit today is imminent, NOT overdue — it was overdue before this fix",
  recheckUrgency(TODAY, fiveHoursAgo, { now: NOW }) < 20000000, true);
check('...but is still ranked as imminent',
  recheckUrgency(TODAY, fiveHoursAgo, { now: NOW }) >= 10000000, true);
check('...and a visit yesterday still is overdue',
  recheckUrgency({ ...JOSE, 'Visit Date': '08/04/2026' }, fiveHoursAgo, { now: NOW }) >= 20000000, true);

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

console.log('\n--- a MOVED visit updates everything and says NOTHING in Chat ---');
/*
 * It used to post. The client stopped it after seeing one: "i dont want the update for this in the chat, it
 * will confuse my teammate; as long as its updating in the dashboard its fine."
 *
 * He is right, and the alert he saw is why: "the visit MOVED in REI. Visit Date 2026-07-29 -> 07/29/2026" —
 * the same day written two ways, because the comparison was a raw string test. The team was being told visits
 * had moved when nothing had. sameFieldValue fixes the false positive; this removes the interruption.
 *
 * A real move still reaches everybody through the row, the dashboard, Juan's calendar invitation and the
 * Automation Log. Cancellations and gifts still post, because those need a decision from a person.
 */
check('a date or time change is still detected',
  /const movedChange = changes\.find\(\(c\) => c\.field === 'Visit Date' \|\| c\.field === 'Visit Time'\)/.test(RUNNER), true);
check('...and still names the old and new value', /\$\{c\.from \|\| '\(blank\)'\} -> \$\{c\.to\}/.test(RUNNER), true);
check('both fields are spelled out when both moved', /\.join\(' · '\)/.test(RUNNER), true);
/*
 * Read the branch itself rather than the whole file. The comment explaining the removal quotes the old
 * message verbatim, so searching the file for that wording would find the explanation and call it a
 * regression — the assertion has to look at the code that runs.
 */
const movedBranch = RUNNER.slice(RUNNER.indexOf('} else if (movedChange) {'),
  RUNNER.indexOf('const moved = changes.filter'));
check('the moved branch posts nothing to Chat', /notifyChat/.test(movedBranch), false);
check('...and the branch was really found', movedBranch.length > 40, true);
check('...it is printed to the run log instead', /visit moved: \$\{moved\}/.test(RUNNER), true);
check('...and says plainly that nothing was posted', /no Chat message sent/.test(RUNNER), true);
/* The two that DO still post, so removing one did not remove them all. */
check('a cancellation still posts', /is now \$\{statusChange\.to\} in REI/.test(RUNNER), true);
check('a gift still posts', /a GIFT is recorded in REI/.test(RUNNER), true);
// A status change still wins — "cancelled" matters more than "moved", and one message is enough.
check('a status change takes precedence over a move', /\} else if \(movedChange\) \{/.test(RUNNER), true);
// And a cosmetic diff still says nothing at all.
check('a phone-number fix still notifies nobody',
  /if \(statusChange\) \{[\s\S]*?\} else if \(movedChange\) \{[\s\S]*?\n    \}/.test(RUNNER), true);
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
check('it imports the read-only task lister and the panel opener',
  /^import \{ readTasks, openPanel \} from '\.\/tasks\.mjs';$/m.test(SCRAPER), true);
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
check('a plain agreement names the one field REI answered on', said('not-checked', ''),
  'Jose Anguiano · 2145 Capitol Ave · REI confirms Visit Date · ' +
  'REI gave no Visit Time, Seller Name, Phone, Email, so those were NOT checked');
// Back-compatible: the runner's summary loop calls it with two arguments.
check('it still works with no scrape passed',
  describeChanges(AGREES, [], { 'Visit Date': '08/01/2026' }),
  'Jose Anguiano · 2145 Capitol Ave · REI confirms Visit Date · ' +
  'REI gave no Visit Time, Seller Name, Phone, Email, so those were NOT checked');
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
/*
 * The blanket all-clear needs THREE conditions now, not two. A live run printed it after all twenty leads
 * failed with a login redirect — nothing had been checked at all — so an unreadable lead vetoes it as well.
 */
check('"REI agrees on every lead" requires all three conditions',
  /if \(!changedRows\.length && !unanswered\.length && !failures\.length\) \{\s*\n\s*console\.log\('REI agrees with the sheet on every lead checked/.test(RUNNER), true);

console.log('\n=== A status read out of free text is never written silently ===');
/*
 * Visit Status = Canceled can now come from a regex over page prose, which means it CAN be wrong. The
 * sentence that caused it has to appear in the log, or a false positive is indistinguishable from a real
 * cancellation after the fact.
 */
check('the scraper carries the matched sentence out', /cancelPhrase: cancelEvidence\.phrase/.test(SCRAPER), true);
check('the phrase rules live in their own tested module',
  /from '\.\/cancel-signal\.mjs'/.test(SCRAPER), true);
check('the runner prints the evidence', /REI says: "\.\.\.\$\{scraped\.cancelPhrase\}\.\.\."/.test(RUNNER), true);

console.log('\n--- dead-lead tags are reported, never acted on ---');
/*
 * Jose's contact was tagged Dead Lead / Lost Deal / We're Passing on July 20 while the tracker had him at
 * Visit Scheduled. Closing a lead out is a decision about somebody's property, and the same rule already
 * holds on the workbook side — cancelling records the fact and leaves the stage for a person.
 */
check('the tags reach the runner', /deadLeadTags: deadTags/.test(SCRAPER), true);
check('the run warns when REI has written a lead off',
  /REI has this lead tagged/.test(RUNNER), true);
/*
 * The wording had to change when REI's STAGE field started closing leads out. "Nothing was changed: closing a
 * lead out is a human decision" was no longer true in general, and somebody reading the log would conclude
 * the automation had refused when in fact it had not looked at the stage. Tags still never close a lead —
 * David Jackowitz carries Dead Lead, Lost Deal, We're Passing AND Follow up at once.
 */
check('...and says tags alone are not enough, naming what would be',
  /Tags alone do not close a lead out; REI's Lead Stage field would/.test(RUNNER), true);
check('...and the audit line says the stage does NOT say dead',
  /REI's Lead Stage does NOT say lost or dead/.test(RUNNER), true);
/*
 * And it does not fire on a lead that was just closed out, where it would contradict the line above it.
 */
check('a lead just closed out is not also reported as unactioned',
  /deadLeadTags\?\.length && !changes\.some\(\(c\) => c\.closedOut\)/.test(RUNNER), true);
check('...and the summary repeats it with the row numbers',
  /Set these to "Lost \/ Closed Out" on the dashboard if that is right\. Not done automatically\./.test(RUNNER), true);
// A tag must never become a Current Stage write. RECHECKABLE plus the one guarded transition is the lot.
check('no tag-driven stage write exists', /Lost \/ Closed Out'\s*\}\)/.test(RUNNER), false);

console.log('\n=== An empty task list only means "no appointment" if we LOOKED ===');
/*
 * The worst call of this whole feature, and it went to the client twice.
 *
 * Two real leads reported "0 booked-appointment tasks" and were described as "REI holds no appointment for
 * this contact any more, so no future re-check will settle it either". Nothing in the code opened REI's
 * Tasks panel — the `tabs` block has sat in rei-selectors.json unused since it was written — so the rows
 * had never rendered. An empty result from a page where the tasks do not appear is evidence about the
 * scraper, not about the appointment, and the two demand opposite actions: fix a selector, or go and mark
 * a visit.
 */
const noAppt = { 'Seller Name': 'Amelia Middel', 'Property Address': '460 5th Avenue, Redwood City' };
const contactOnly = { 'Seller Name': 'Amelia Middel', Phone: '(650) 555-0000', Email: 'a@example.com' };

const neverLooked = describeChanges(noAppt, [], contactOnly,
  { visitTaskState: 'unknown', visitTaskReason: "REI's tasks were never read — no Tasks / Appointments tab could be found", taskPanelOpened: false });
check('an unopened panel is called a SCRAPER problem', /SCRAPER problem, not a data problem/.test(neverLooked), true);
check('...and refuses to conclude anything about the visit',
  /Nothing can be concluded about the visit from this run/.test(neverLooked), true);
check('...and does NOT claim REI has no appointment',
  /REI holds no appointment/.test(neverLooked), false);
check('...and does NOT send somebody off to mark a visit',
  /Somebody has to mark/.test(neverLooked), false);

const lookedAndEmpty = describeChanges(noAppt, [], contactOnly,
  { visitTaskState: 'unknown', visitTaskReason: 'the Tasks panel was opened (clicked tab "Tasks") and holds no booked-appointment task', taskPanelOpened: true });
check('an OPENED but empty panel reports what was actually seen',
  /REI has no OPEN booked-appointment task for this contact/.test(lookedAndEmpty), true);
check('...and still sends somebody to settle it',
  /Somebody has to mark the visit Completed or Canceled/.test(lookedAndEmpty), true);
/*
 * And it must NOT pick a reading it cannot see. Many CRMs list only open tasks and hide completed ones behind
 * a filter; on that reading an empty panel means the visit HAPPENED, which is the opposite conclusion. This
 * project has already published one confident, wrong "REI holds no appointment for this contact any more", so
 * the sentence names both readings rather than choosing.
 */
check('...and admits the task may simply have been ticked off',
  /REI lists only open tasks and this one was already ticked off/.test(lookedAndEmpty), true);
check('...and no longer asserts the appointment is gone',
  /holds no appointment for this contact any more/.test(lookedAndEmpty), false);
check('...and is not blamed on the scraper', /SCRAPER problem/.test(lookedAndEmpty), false);

console.log('\n--- the panel is opened before the tasks are read ---');
const TASKS = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/tasks.mjs', import.meta.url), 'utf8');
const DOCTOR = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/rei-task-doctor.mjs', import.meta.url), 'utf8');
/*
 * The role list, which is the whole reason this never worked.
 *
 * "no Tasks / Appointments tab or accordion could be found on the page" was reported for every lead, for
 * weeks, and I read it as REI calling the tab something else — and asked the client for the wording four
 * times. The client's screenshot settles it: the strip is About · Chat · Activities · Notes · Tasks · Files ·
 * Workflows · Properties. The label was right the whole time.
 *
 * The ROLE was wrong. getByRole('tab') needs role="tab" and getByRole('button') needs a <button> or
 * role="button". A tab strip built from anchors is role "link"; one built from <div>s has no role at all. REI's
 * class names are scrambled (css-0), so there is no class to fall back on either.
 */
check('a link is tried, not only a tab and a button', /'tab', 'button', 'link', 'menuitem'/.test(TASKS), true);
check('...and there is a text fallback for an element with no role at all',
  /filter\(\{ hasText: exact \}\)/.test(TASKS), true);
check('the fallback takes the innermost match, not the wrapper',
  /filter\(\{ hasText: exact \}\)\.last\(\)/.test(TASKS), true);
/*
 * The fallback is the one place this clicks something with no role, so the allowlist must still gate it. `name`
 * is checked against OPENABLE before either loop, so Delete and Send are unreachable however the page is built.
 */
check('the allowlist still gates every path',
  TASKS.indexOf('if (!OPENABLE.test(name)) continue;') < TASKS.indexOf('filter({ hasText: exact })'), true);
check('the label is anchored at both ends, so "Tasks (3)" cannot match',
  /\^\\\\s\*\$\{escapeRegex\(name\)\}\\\\s\*\$/.test(TASKS), true);
/* A single-page app needs time to render a panel; 1.5s with no network wait was optimistic. */
check('it waits for the network after clicking',
  /waitForLoadState\('networkidle'/.test(TASKS), true);
check('the failure message admits a link was looked for too',
  /tab, link or accordion could be found/.test(TASKS), true);

check('openPanel exists', /export async function openPanel/.test(TASKS), true);
check('the scraper opens it BEFORE reading',
  SCRAPER.indexOf('openPanel(page') < SCRAPER.indexOf('readTasks(page'), true);
check('it uses the tabs config that had never been read', /selectorConfig\.tabs\?\.tasks/.test(SCRAPER), true);
check('the doctor opens it too', /await openPanel\(page/.test(DOCTOR), true);
check('...and says up front when it could not', /Everything below is therefore inconclusive/.test(DOCTOR), true);
check('...and lists the real panel names so the guess can be replaced',
  /Panels this contact page offers/.test(DOCTOR), true);
/*
 * The inventory must print even when there are NO tasks -- which is the only time it is needed. It was
 * placed inside an `if (tasks.length)` block, so on the one contact that required it, it printed nothing.
 */
// The real statement, not the comment that mentions it — the comment sits above the inventory and made
// this assertion pass-by-accident in reverse.
const guardAt = DOCTOR.indexOf('if (tasks.length) {');
check('the inventory prints before anything that depends on tasks existing',
  DOCTOR.indexOf('Panels this contact page offers') < guardAt, true);
check('the appointment word-search does too',
  DOCTOR.indexOf('Does the page mention an appointment') < guardAt, true);
// The distinction the whole evening turned on: words present means my selectors are wrong; words absent
// means REI has no appointment and no selector will ever find one.
check('words present is called a selector problem',
  /the words ARE on the page and the selectors are wrong/.test(DOCTOR), true);
check('words absent is called a real answer',
  /REI holds no appointment for this contact, and no selector change/.test(DOCTOR), true);
check('...and points at the person, not the code',
  /has to be set by a person on the dashboard/.test(DOCTOR), true);

console.log('\n--- and clicking is restricted to an allowlist ---');
/*
 * Opening a panel means clicking on a page this project treats as read-only. The set of clickable names is
 * fixed in code, so a stray or hostile value in the config cannot turn this into a general click function.
 */
const openable = /const OPENABLE = (\/.+\/i);/.exec(TASKS)?.[1];
check('an allowlist regex exists', Boolean(openable), true);
const OPENABLE = new RegExp(openable.slice(1, -2), 'i');
for (const ok of ['Tasks', 'Task', 'Appointments', 'Notes', 'Activity', 'Timeline', 'Property']) {
  check(`"${ok}" may be opened`, OPENABLE.test(ok), true);
}
for (const no of ['Delete', 'Remove', 'Archive', 'Cancel', 'Send Text', 'Mark Complete', 'Trash', '']) {
  check(`"${no}" may NOT be clicked`, OPENABLE.test(no), false);
}
check('a label off the allowlist is skipped, not clicked',
  /if \(!OPENABLE\.test\(name\)\) continue;/.test(TASKS), true);
// It must remain a read path: the doctor and the scraper may open panels, never complete a task.
check('openPanel does not touch the completion control', /completeControl/.test(
  TASKS.slice(TASKS.indexOf('export async function openPanel'), TASKS.indexOf('export async function readTasks'))), false);

console.log('\n=== An EMPTY owner is missing data, not a decision ===');
/*
 * The client, looking at Amelia Middel's card: "im not only saying the note, look at amelia still
 * unassigned but in the rei already assigned."
 *
 * REI's About tab read "Appointment Assigned To: Juan". The row was blank, so the dashboard showed
 * "Unassigned" and its own exception rule flagged "Missing: Assigned Owner" — on a visit that had an owner
 * the whole time. Two separate faults produced that:
 *
 *   1. REI's label is "Appointment Assigned To". Labels are matched as a PREFIX of the leaf text
 *      ("Appointment Assigned ToJuan"), and the config only listed "Assigned To", so it never matched and
 *      every owner came back blank — on the email path too, not just the re-check.
 *   2. Assigned Owner was excluded from RECHECKABLE because "a later reassignment is a human's call".
 *      True of a reassignment. Not true of a blank: nobody chose blank.
 */
const AMELIA = {
  'Seller Name': 'Amelia Middel', 'Property Address': '460 5th Avenue, Redwood City, CA, 94063',
  'Assigned Owner': '', 'Assigned Visitor': '', 'Visit Status': 'Scheduled',
  'Current Stage': 'Visit Scheduled', 'Visit Date': '08/01/2026', 'Visit Time': '9:00 AM'
};
const FROM_REI = reiFieldsFromScrape({
  assignedOwner: 'Juan', appointmentStartIso: '2026-08-01T09:00:00-07:00'
}, { zone: 'America/Los_Angeles' });

check('REI\'s owner reaches the sheet fields', FROM_REI['Assigned Owner'], 'Juan');
check('...and the visitor column too, as the email path already does', FROM_REI['Assigned Visitor'], 'Juan');
const filled = diffFromRei(AMELIA, FROM_REI);
check('a blank owner is filled', filled.find((c) => c.field === 'Assigned Owner')?.to, 'Juan');
check('...and is marked as a fill, not an overwrite',
  filled.find((c) => c.field === 'Assigned Owner')?.filledBlank, true);
check('...from an empty value', filled.find((c) => c.field === 'Assigned Owner')?.from, '');

console.log('\n--- but a named owner is NEVER replaced ---');
// If the team moved the lead from Juan to Kyle, REI's older value must not win.
const REASSIGNED = { ...AMELIA, 'Assigned Owner': 'Kyle', 'Assigned Visitor': 'Kyle' };
check('Kyle is kept', diffFromRei(REASSIGNED, FROM_REI).some((c) => c.field === 'Assigned Owner'), false);
check('...and so is the visitor', diffFromRei(REASSIGNED, FROM_REI).some((c) => c.field === 'Assigned Visitor'), false);
check('one filled and one named is handled per field',
  diffFromRei({ ...AMELIA, 'Assigned Owner': 'Kyle' }, FROM_REI).filter((c) => c.filledBlank).map((c) => c.field),
  ['Assigned Visitor']);
check('a blank from REI fills nothing', diffFromRei(AMELIA, reiFieldsFromScrape({})).length, 0);
check('the fillable fields', FILL_IF_BLANK,
  ['Assigned Owner', 'Assigned Visitor', 'Approved Offer Amount',
    'Gift Status', 'Gift Sent Date', 'Gift Recommendation Reason',
    'Gift Approval Owner', 'Gift Approved By', 'Gift Approval Date']);
/*
 * The approval columns are filled, at the client's instruction: "gift approve by cheeryy since that is
 * already automatic once it noted there is approved". A gift order in REI IS the sign-off, so recording it
 * describes what happened. What is never invented is a NAME — only Cherry or Juan can reach those columns,
 * because both are dropdowns. See tests/gift.test.mjs.
 */
check('who approved the gift IS fillable now', FILL_IF_BLANK.includes('Gift Approved By'), true);
// They must stay OUT of RECHECKABLE, or the fill-only guarantee is gone.
for (const f of FILL_IF_BLANK) check(`${f} is not overwritable`, RECHECKABLE.includes(f), false);
check('a re-run after filling changes nothing',
  diffFromRei({ ...AMELIA, 'Assigned Owner': 'Juan', 'Assigned Visitor': 'Juan' }, FROM_REI).length, 0);

console.log('\n--- the label was NOT the bug, and the block I edited is dead ---');
/*
 * I diagnosed this wrong and should not be able to again.
 *
 * rei-selectors.json has TWO label blocks. The scraper reads listItemLabels (`const L =
 * selectorConfig.listItemLabels`). I "fixed" `labels.assignedOwner` to add 'Appointment Assigned To',
 * announced it as the root cause of "Missing: Assigned Owner" across the board, and it changed nothing —
 * listItemLabels.assignedOwner already said exactly that, and nothing reads `labels` at all.
 *
 * So these assert which block is live, and that the live one is correct. Why REI still returned no owner
 * for Amelia is a separate, open question that rei-fields.mjs answers by printing the real page pairs.
 */
const SELECTORS = JSON.parse(fs.readFileSync(
  new URL('../twin-visit-logger-sandbox/config/rei-selectors.json', import.meta.url), 'utf8'));
check('the scraper reads listItemLabels, not labels',
  /const L = selectorConfig\.listItemLabels/.test(SCRAPER), true);
check("the LIVE block already names REI's real label",
  SELECTORS.listItemLabels.assignedOwner.includes('Appointment Assigned To'), true);
check('the dead block is marked as dead', /DEAD BLOCK/.test(SELECTORS.labels._comment), true);
check('...and says which one is live', /listItemLabels/.test(SELECTORS.labels._comment), true);
/* The shipped matcher against the real leaf text — the LIVE label list resolves it. */
const matcherSrc = SCRAPER.slice(SCRAPER.indexOf('function valueForLabel'), SCRAPER.indexOf('// Long-form leaf items'));
const valueForLabel = new Function('normalize', `${matcherSrc}\nreturn valueForLabel;`)(
  (v) => String(v || '').replace(/\s+/g, ' ').trim());
check('"Appointment Assigned ToJuan" resolves to Juan with the live list',
  valueForLabel(['Appointment Assigned ToJuan'], SELECTORS.listItemLabels.assignedOwner), 'Juan');
// So a blank owner means the PAIR was absent from the page dump, not that the label was wrong.
check('an absent pair yields nothing, which is the real failure mode',
  valueForLabel(['Phone (Home)(650) 566-5268'], SELECTORS.listItemLabels.assignedOwner), '');
/*
 * Money from that same page IS pulled now, at the client's instruction — but fill-only. It reaches an empty
 * Approved Offer Amount and can never change a figure somebody entered, which is the part that matters: an
 * offer amount is a decision, and a wrong one is the most expensive cell on the row.
 */
check('Amount Offer fills an empty cell', FILL_IF_BLANK.includes('Approved Offer Amount'), true);
check('...and fill-only means it cannot overwrite',
  diffFromRei({ ...JOSE, 'Approved Offer Amount': 905000 }, { 'Approved Offer Amount': 930000 }), []);

console.log('\n--- and the run says "filled", not "changed" ---');
check('a fill is reported distinctly', /filled \$\{filled\.length\} empty field\(s\) from REI/.test(RUNNER), true);
check('...naming each field and value', /\$\{c\.field\} = "\$\{c\.to\}"/.test(RUNNER), true);

console.log('\n=== The important leads are read first ===');
/*
 * The client: "i think it should be prio first the important."
 *
 * A flat queue ordered by staleness gave a Contract Sent deal the same place as a visit booked for next
 * month. Ordering now runs: board wrong about today > visit today/tomorrow > the sheet's own Opportunity
 * Priority > stage > how long it has waited.
 */
const lead = (stage, priority, visitDate, visitStatus = 'Scheduled') => ({
  'REI BlackBook Link': 'x', 'Current Stage': stage, 'Opportunity Priority': priority,
  'Visit Date': visitDate, 'Visit Status': visitStatus, 'Seller Name': `${stage}/${priority}`
});
const QUEUE = [
  lead('Visit Scheduled', 20, '09/30/2026'),
  lead('Contract Sent', 80, '07/01/2026', 'Completed'),
  lead('Offer Sent', 74, '08/01/2026', 'Completed'),
  lead('Visit Scheduled', 30, '08/01/2026'),
  lead('Active Negotiation', 40, '07/01/2026', 'Completed'),
  lead('Visit Scheduled', 10, '08/05/2026'),
  lead('Offer Preparation', 90, '07/01/2026', 'Completed')
];
check('the whole queue, in order',
  pickRecheckCandidates(QUEUE, {}, { now: NOW, limit: 9 }).map((r) => r['Seller Name']),
  ['Visit Scheduled/30', 'Visit Scheduled/10', 'Offer Preparation/90', 'Contract Sent/80',
    'Offer Sent/74', 'Active Negotiation/40', 'Visit Scheduled/20']);

console.log('\n--- and the sheet\'s own score outranks the stage ---');
/*
 * Not arbitrary. Amelia Middel's Opportunity Priority went 34 -> 74 the moment her stage advanced to Offer
 * Sent, so the workbook's formula already accounts for the stage. Weighting stage above it would
 * double-count the same fact and overrule the team's own scoring.
 */
check('Offer Preparation scored 90 beats Offer Sent scored 74',
  recheckUrgency(lead('Offer Preparation', 90, '07/01/2026', 'Completed'), null, { now: NOW })
    > recheckUrgency(lead('Offer Sent', 74, '08/01/2026', 'Completed'), null, { now: NOW }), true);
check('...and at EQUAL scores the later stage wins',
  recheckUrgency(lead('Contract Sent', 50, '07/01/2026', 'Completed'), null, { now: NOW })
    > recheckUrgency(lead('Offer Preparation', 50, '07/01/2026', 'Completed'), null, { now: NOW }), true);
// A time-critical visit still jumps the entire queue, whatever the score says.
check('a visit today outranks the highest-scoring deal',
  recheckUrgency(lead('Visit Scheduled', 1, '08/05/2026'), null, { now: NOW })
    > recheckUrgency(lead('Contract Sent', 100, '07/01/2026', 'Completed'), null, { now: NOW }), true);
check('an overdue visit outranks even that',
  recheckUrgency(lead('Visit Scheduled', 1, '08/01/2026'), null, { now: NOW })
    > recheckUrgency(lead('Visit Scheduled', 100, '08/05/2026'), null, { now: NOW }), true);
// A missing or junk priority must not throw or win.
check('a blank priority scores as zero, not as a crash',
  recheckUrgency({ ...lead('Offer Sent', '', '07/01/2026', 'Completed') }, null, { now: NOW }) > 0, true);
check('a formatted priority is read', recheckUrgency(lead('Offer Sent', '74', '07/01/2026', 'Completed'), null, { now: NOW })
  === recheckUrgency(lead('Offer Sent', 74, '07/01/2026', 'Completed'), null, { now: NOW }), true);
check('an absurd priority is capped rather than swamping the tiers',
  recheckUrgency(lead('Offer Sent', 99999, '07/01/2026', 'Completed'), null, { now: NOW }) < 10000000, true);
// Staleness is the LAST word, so two identical leads still take turns.
check('among identical leads, the one waiting longest goes first',
  recheckUrgency(lead('Offer Sent', 50, '07/01/2026', 'Completed'), null, { now: NOW })
    > recheckUrgency(lead('Offer Sent', 50, '07/01/2026', 'Completed'),
      new Date(NOW.getTime() - 30 * 60000).toISOString(), { now: NOW }), true);

console.log('\n=== "the visit MOVED in REI. Visit Date 2026-07-29 -> 07/29/2026" ===');
/*
 * That alert really went to the client's team, and it is the same day written two ways. REI's fields come
 * back as 'MM/dd/yyyy'; the sheet hands back what the cell renders as, which for a date cell is 'yyyy-MM-dd'.
 * A raw string comparison therefore reported every scheduled visit as moved, on every run, for ever — each
 * one rewriting the row and pushing Juan's calendar event again. It could not even settle, because writing
 * 07/29/2026 into a date cell makes it render as 2026-07-29 again.
 */
check('the same day in two formats is not a change',
  sameFieldValue('Visit Date', '2026-07-29', '07/29/2026'), true);
check('...in either direction', sameFieldValue('Visit Date', '07/29/2026', '2026-07-29'), true);
check('a REAL move is still a change',
  sameFieldValue('Visit Date', '2026-07-29', '07/30/2026'), false);
/*
 * A bare Sheets serial. 46233 is 29 July 2026 — new Date('46233') reads it as a YEAR, so sheetDayKey used to
 * answer '46231-12-31' and every comparison built on it was quietly wrong: such a visit sorted as if it were
 * forty thousand years away and could never be overdue.
 */
check('a sheet serial is the same day too', sameFieldValue('Visit Date', 46233, '07/29/2026'), true);
check('...and a different serial is a different day', sameFieldValue('Visit Date', 46232, '07/29/2026'), false);
check('a small number is not a date at all', sheetDayKey(5), '');
check('an unparseable date is not silently equal',
  sameFieldValue('Visit Date', 'sometime next week', '07/29/2026'), false);

console.log('\n--- times, phones and emails, compared by meaning ---');
check('9:30 AM and 09:30 AM are one time', sameFieldValue('Visit Time', '9:30 AM', '09:30 AM'), true);
check('lower-case am matches', sameFieldValue('Visit Time', '9:30 am', '9:30 AM'), true);
check('no space matches', sameFieldValue('Visit Time', '9:30AM', '9:30 AM'), true);
check('9:30 AM is NOT 9:30 PM', sameFieldValue('Visit Time', '9:30 AM', '9:30 PM'), false);
check('12:15 AM is not 12:15 PM', sameFieldValue('Visit Time', '12:15 AM', '12:15 PM'), false);
check('a reformatted phone is not a change',
  sameFieldValue('Phone', '5102208546', '(510) 220-8546'), true);
check('a country code is not a change', sameFieldValue('Phone', '+1 510 220 8546', '(510) 220-8546'), true);
/*
 * David Jackowitz's home number was in the mobile column: (510) 346-8546 where REI had (510) 220-8546. That
 * correction is the reason Phone is re-checkable at all, and normalising formatting must not hide it.
 */
check("David's wrong number is STILL caught",
  sameFieldValue('Phone', '(510) 346-8546', '(510) 220-8546'), false);
check('a differently-cased email is not a change',
  sameFieldValue('Email', 'DJackowitz@live.com', 'djackowitz@live.com'), true);
check('a different email is', sameFieldValue('Email', 'dj@live.com', 'djackowitz@live.com'), false);
/* A name is left alone: case and punctuation there may be somebody's deliberate correction. */
check('a name is compared exactly', sameFieldValue('Seller Name', 'jose anguiano', 'Jose Anguiano'), false);
check('an identical name is equal', sameFieldValue('Seller Name', 'Jose Anguiano', 'Jose Anguiano'), true);

console.log('\n--- and no change means no write, no calendar push, no alert ---');
const MARICHU = { 'Property Address': '27833 Gainesville Ave, Hayward, CA 94545', 'Seller Name': 'Marichu Mangclimot',
  'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled', 'Visit Date': '2026-07-29',
  'Visit Time': '2:00 PM', Phone: '(510) 555-0101', Email: 'm@example.com', 'Assigned Owner': 'Juan',
  'Assigned Visitor': 'Juan', 'Next Action': 'Conduct scheduled visit & log outcome',
  'Last Contact Result': 'x', 'Last Contact Date': '07/29/2026' };
const sameAgain = diffFromRei(MARICHU, { 'Visit Date': '07/29/2026', 'Visit Time': '2:00 PM',
  'Visit Status': 'Scheduled', 'Seller Name': 'Marichu Mangclimot', Phone: '(510) 555-0101',
  Email: 'm@example.com' });
check('a row REI agrees with produces no changes at all', sameAgain, []);
check('...so the calendar is not touched', calendarAffected(sameAgain), false);

console.log('\n=== David Jackowitz: REI says the lead is dead ===');
/*
 * The client: "add this in david, its already tagged as a dead lead, lost deal, and then you can see the lead
 * stage is dead, so it already updated." REI has him at Lead Stage "9 Lost / Dead Lead", Category "Lost/Dead",
 * Call Disposition "We Passed", and the tracker had him live.
 *
 * This is the only move the automation makes BACKWARDS along the pipeline, so the guards matter more than
 * the feature: closing a lead out takes it off the work queue, and the failure mode is a live deal nobody
 * follows up.
 */
check("REI's own stage field is read", reiSaysLost('9 Lost / Dead Lead'), true);
check('...and "Dead Lead" too', reiSaysLost('Dead Lead'), true);
check('an active stage is not lost', reiSaysLost('4 Offer Sent'), false);
check('nor is a blank one', reiSaysLost(''), false);
/*
 * "Lost" must not be found inside an ordinary word. \b on both sides is what stops "Lost Keys Follow Up"
 * from mattering and, more importantly, keeps a stage like "Closest Match" from reading as dead.
 */
check('"lost" inside another word is not a stage', reiSaysLost('Closest Contact'), false);

console.log('\n--- from a live stage it closes out ---');
for (const from of ['Visit Scheduled', 'Visit Completed — Needs Review', 'Offer Preparation',
  'Offer Sent', 'Active Negotiation']) {
  check(`${from} -> Lost / Closed Out`, stageCloseOut(from, '9 Lost / Dead Lead'), STAGE_LOST);
  check(`...and nothing is refused from ${from}`, closeOutRefusal(from, '9 Lost / Dead Lead'), '');
}

console.log('\n--- from a nearly-done deal it REFUSES, and says so ---');
/*
 * REI calling a deal dead while the sheet has a contract out is a conflict, not an instruction. Acting on it
 * automatically could bury a deal that is nearly closed, so it is reported for a person to settle.
 */
for (const from of ['Verbal Agreement', 'Contract Sent', 'Contract Signed']) {
  check(`${from} is not closed out`, stageCloseOut(from, '9 Lost / Dead Lead'), '');
  check(`...and the conflict is reported`, /too far along to close out/.test(closeOutRefusal(from, '9 Lost / Dead Lead')), true);
  check(`...naming both sides`, /9 Lost \/ Dead Lead/.test(closeOutRefusal(from, '9 Lost / Dead Lead'))
    && closeOutRefusal(from, '9 Lost / Dead Lead').includes(from), true);
}
check('a lead already closed out is left alone', stageCloseOut(STAGE_LOST, '9 Lost / Dead Lead'), '');
check('...and reports nothing, because there is no conflict', closeOutRefusal(STAGE_LOST, '9 Lost / Dead Lead'), '');
check('nurture is left where a person parked it', stageCloseOut('Long-Term Nurture', 'Dead Lead'), '');
check('a blank stage is not given a conclusion', stageCloseOut('', '9 Lost / Dead Lead'), '');
check('an active REI stage closes nothing', stageCloseOut('Offer Sent', '4 Offer Sent'), '');

console.log('\n--- the close-out carries a disposition and a reason ---');
/*
 * A stage of 'Lost / Closed Out' with no disposition and no reason is the half-filled state the client
 * objected to over the gift block: the board says the lead is dead and cannot say why. REI's own words are
 * used, so it is auditable rather than invented.
 */
const DAVID = { 'Property Address': '1390 Estudillo Ave, San Leandro, CA 94577', 'Seller Name': 'David Jackowitz',
  'Current Stage': 'Offer Sent', 'Visit Status': 'Completed', 'Assigned Owner': 'Cherry' };
const deadFields = { 'Current Stage': '9 Lost / Dead Lead',
  'Last Contact Result': 'We are passing on this lead | Market is slow in that area' };
const deadChanges = diffFromRei(DAVID, deadFields);
const at = (f) => deadChanges.find((c) => c.field === f);
check('Current Stage is closed out', at('Current Stage')?.to, STAGE_LOST);
check('...marked as a close-out, not an advance', at('Current Stage')?.closedOut, true);
check('Final Disposition is set to a legal dropdown value', at('Final Disposition')?.to, 'Lost');
check('...one the workbook offers', ['Contracted', 'Lost', 'Long-Term Nurture', 'Closed Out']
  .includes(at('Final Disposition')?.to), true);
check('the reason quotes REI', /We are passing on this lead/.test(at('Closeout Reason')?.to || ''), true);
check('...and says where it came from', /^Closed out from REI —/.test(at('Closeout Reason')?.to || ''), true);
/* Anything a person already wrote in those two columns survives. */
const settled = { ...DAVID, 'Final Disposition': 'Closed Out', 'Closeout Reason': 'Seller relisted with an agent' };
const settledChanges = diffFromRei(settled, deadFields);
check("a person's own disposition is untouched",
  settledChanges.some((c) => c.field === 'Final Disposition'), false);
check("...and their own reason", settledChanges.some((c) => c.field === 'Closeout Reason'), false);
/* Idempotent: once closed out, the same scrape must produce nothing. */
check('a second pass changes nothing',
  diffFromRei({ ...settled, 'Current Stage': STAGE_LOST }, deadFields)
    .some((c) => c.field === 'Current Stage'), false);

console.log('\n--- a dead lead is closed out, NOT promoted to Needs Review ---');
/*
 * Ordering matters. A dead lead whose last visit happened would otherwise be advanced to "Visit Completed —
 * Needs Review", which puts it back on the work queue asking somebody to decide about a deal the team has
 * already passed on.
 */
const deadAndVisited = diffFromRei({ ...DAVID, 'Current Stage': 'Visit Scheduled' },
  { ...deadFields, 'Visit Status': 'Completed' });
check('the stage goes to Lost / Closed Out',
  deadAndVisited.find((c) => c.field === 'Current Stage')?.to, STAGE_LOST);
check('...and not to Needs Review',
  deadAndVisited.some((c) => c.to === 'Visit Completed — Needs Review'), false);

console.log('\n=== a scrape that returns NOTHING is a failure, not a quiet agreement ===');
/*
 * The client, on a log full of them: "but we need to fix those asap."
 *
 * "REI returned NOTHING to compare — no appointment date and no contact fields" was honest about not knowing,
 * and then the run moved on and counted the lead as checked. So it went to the back of a 20-minute queue
 * having been looked at not at all, and the closing summary could still report the run as clean.
 *
 * Zero fields is not something REI can legitimately produce for a contact that exists — even a lead with no
 * appointment has a name and a phone number — so it means the page had not finished rendering.
 */
check('the message still distinguishes nothing-to-compare from agreement',
  describeChanges({ 'Seller Name': 'Fandy', 'Property Address': '212 Orland St, Las Vegas, NV 89107' }, [], {}),
  'Fandy · 212 Orland St, Las Vegas, NV 89107 · REI returned NOTHING to compare — no appointment date and no '
  + 'contact fields. The page may not have rendered, or the contact has no appointment in REI.');
check('an empty scrape is retried once', /Retrying once/.test(RUNNER), true);
check('...after a pause, because the cause is a page still rendering',
  /setTimeout\(resolve, 4000\)/.test(RUNNER), true);
check('a second empty result is recorded as unreadable',
  /failures\.push\(\{ row, reason: 'REI returned no fields at all, twice/.test(RUNNER), true);
check('...and logged as an EXCEPTION in the workbook',
  /returned no `\s*\+ 'fields at all on two attempts/.test(RUNNER), true);
/*
 * The lead must NOT be stamped as checked. state[key].lastCheckedAt is what puts it to the back of the queue,
 * so the `continue` has to happen before that write — otherwise a lead nothing read waits 20 minutes to be
 * ignored again.
 */
check('the failure path skips the lead before it is marked checked',
  RUNNER.indexOf("still nothing. Recorded as UNREADABLE") < RUNNER.indexOf('lastCheckedAt: new Date()'), true);
/* And failures already veto the all-clear, which is what makes recording it worth anything. */
check('failures still veto the closing all-clear',
  /!changedRows\.length && !unanswered\.length && !failures\.length/.test(RUNNER), true);

console.log("\n=== what REI's Tasks panel actually is ===");
/*
 * The doctor on Jahan Woodfork, once the panel finally opened:
 *
 *   MY TASKS  ALL TASKS
 *   These are your current assigned tasks.
 *   Booked appointment | (650) 704-3064 | August 01, 2026 1:30 PM Amelia Middel JR
 *   Booked appointment | (415) 756-3261 | July 31, 2026 5:00 PM Maria Ramos JR
 *   ...
 *
 * Two things follow. It is the LOGGED-IN USER'S task list, not the contact's — every appointment listed
 * belongs to a different lead. And it opens filtered to that user, so a visit assigned to somebody else is
 * invisible until All Tasks is selected.
 */
check('the All Tasks filter is selected before reading',
  /getByText\(\/\^\\s\*all\\s\+tasks\\s\*\$\/i\)/.test(TASKS), true);
check('...anchored, so "All Tasks Settings" cannot match',
  /\^\\s\*all\\s\+tasks\\s\*\$/.test(TASKS), true);
/*
 * All five configured selectors reported "no match" while five appointments sat in plain sight. Guessing a
 * sixth CSS selector is how the previous three attempts went; the TEXT is the stable thing, and it carries
 * everything parseTaskTitle needs.
 */
check('rows are found in the page text when no selector matches',
  /page\.locator\('body'\)\.innerText\(\)/.test(TASKS), true);
check('...line by line, which is how the doctor found them', /body\.split\('\\n'\)/.test(TASKS), true);
check('...only as a fallback, after the configured selectors',
  TASKS.indexOf('for (const selector of rowSelectors)') < TASKS.indexOf("body.split('\\n')"), true);
check('...and duplicates from nested elements are dropped', /seen\.has\(text\)/.test(TASKS), true);
/*
 * A text match gives no element to scope a click to, and the entire safety argument for completeTask is that
 * the tick it clicks is provably inside the matched row. So such a task is readable and never completable.
 */
check('a text-found task is marked not completable', /completable: false/.test(TASKS), true);
check('...and completeTask refuses it outright',
  /task\.completable === false/.test(TASKS), true);
check('...before it locates any row', TASKS.indexOf('task.completable === false')
  < TASKS.indexOf('const row = page.locator(task.selector)'), true);
check('...saying why, rather than failing silently',
  /found by its text, so no row can be scoped for a click/.test(TASKS), true);

console.log('\n--- and the report stops calling them the contact\'s tasks ---');
/*
 * "5 booked-appointment task(s) on the contact, none matching this visit" invites somebody to open the lead
 * expecting five appointments and find none of them there.
 */
check('the count says whose list it is',
  /lists the whole `\s*\+ "team's tasks, not just this contact's/.test(SCRAPER), true);
/*
 * Matched on the full old sentence, not the fragment: the comment above the fix quotes "on the contact" to
 * explain what was wrong with it, and an assertion that trips over its own explanation is worse than none.
 */
check('...and no longer says "on the contact"',
  /task\(s\) on the contact, none matching/.test(SCRAPER), false);

console.log('\n=== a task date must not move with the machine\'s timezone ===');
/*
 * "Booked appointment | (650) 704-3064 | August 01, 2026 1:30 PM" was parsed as 2026-07-31 — a day early.
 * new Date("August 01 2026") builds midnight in the MACHINE's timezone and Intl then re-rendered it in
 * Pacific, so on any machine east of Pacific it landed on the day before. It looked right where it was
 * written and was silently wrong anywhere else, including a scheduled task on a box set to UTC.
 *
 * The date is not cosmetic: pickTaskForVisit matches on phone AND date, so a one-day shift means no task ever
 * matches, and the run reports "REI has no open task for this visit" — a confident wrong answer about whether
 * somebody's visit happened.
 */
const REAL = 'Booked appointment | (650) 704-3064 | August 01, 2026 1:30 PM Amelia Middel JR';
check('a month-name date keeps its own day', parseTaskTitle(REAL).date, '2026-08-01');
check('...and its phone', parseTaskTitle(REAL).phone, '(650) 704-3064');
check('a slashed date works too',
  parseTaskTitle('Booked appointment | (650) 771-7814 | 08/01/2026 2:00 PM').date, '2026-08-01');
check('a single-digit day is padded',
  parseTaskTitle('Booked appointment | (1) 1 | August 5, 2026 7:00 AM').date, '2026-08-05');
/*
 * The real proof: the same line, parsed under two timezones, must give the same day. This is the assertion
 * that would have caught the original bug — the old code passed in Pacific and failed everywhere else.
 */
const tzWas = process.env.TZ;
const dates = [];
for (const zone of ['UTC', 'Asia/Manila', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  process.env.TZ = zone;
  dates.push(parseTaskTitle(REAL).date);
}
if (tzWas === undefined) delete process.env.TZ; else process.env.TZ = tzWas;
check('every timezone agrees on the day', [...new Set(dates)], ['2026-08-01']);
/* A line that is not a task must still be rejected, or the panel headings become tasks. */
for (const line of ['MY TASKS ALL TASKS', 'These are your current assigned tasks.', 'Contact Tasks', '']) {
  check(`"${line || '(empty)'}" is not a task`, parseTaskTitle(line), null);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
