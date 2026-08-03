/**
 * The note posted into a visit group.
 *
 *   node tests/whatsapp-note.test.mjs
 *
 * This is the only text this project ever sends to a real group of real people, so the exact wording
 * is pinned. Two things matter most:
 *
 *   1. A line REI cannot fill must appear as a visible BLANK, never be dropped. An absent
 *      "Known Issues" line reads as "there are no known issues" — a completely different claim from
 *      "nobody has written them down yet".
 *   2. containsSellerSensitive must catch anything that must not reach the person being negotiated
 *      with, because that is the last check before a message goes out.
 */
import {
  buildInspectionNote, containsSellerSensitive, TO_FILL_IN
} from '../twin-visit-logger-sandbox/src/whatsapp/note.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const VISIT = {
  propertyAddress: '15340 Canyon 2 Rd, Guerneville, CA 95446',
  sellerName: 'Jon Box',
  phone: '(707) 481-7040',
  reiLink: 'https://my.reiblackbook.com/contacts/20473369',
  leadSource: 'PropertyLeads (PPL)',
  beds: '4', baths: '2.0', sqft: '2,448',
  contactStage: '9 Lost / Dead Lead',
  assignedOwner: 'Juan, Thea',
  notes: 'Equity Percentage: 22% | cancelled booked appointment'
};
const note = buildInspectionNote(VISIT, { appointmentText: 'Mon Jul 20, 2026, 2:00–3:00 PM' });
const bare_ = buildInspectionNote({}, {});

console.log('=== The facts REI holds are filled in ===');
for (const [what, value] of [
  ['address', '15340 Canyon 2 Rd, Guerneville, CA 95446'],
  ['seller', 'Jon Box'],
  ['phone', '(707) 481-7040'],
  ['REI link', 'https://my.reiblackbook.com/contacts/20473369'],
  ['lead source', 'PropertyLeads (PPL)'],
  ['appointment', 'Mon Jul 20, 2026, 2:00–3:00 PM'],
  ['lead stage', '9 Lost / Dead Lead'],
  ['assigned', 'Juan, Thea']
]) check(`${what} is present`, note.includes(value), true);
check('beds/baths/sqft are combined on one line', note.includes('4 bd · 2.0 ba · 2,448 sqft'), true);
check("the REI link is present so the full notes are one tap away",
  note.includes('reiblackbook.com/contacts/20473369'), true);

console.log('\n=== The judgement lines are read from the call summary ===');
/*
 * These printed as blanks while the answers sat a few lines further down the same notes. And the raw
 * notes are no longer pasted in at all: dumping them produced a message thousands of characters long, and
 * the client's answer on seeing it was "this was only needed in there... no other long notes".
 */
const CALL = buildInspectionNote({
  propertyAddress: '1390 Estudillo Ave, San Leandro, CA 94577',
  notes: 'Estimated Value: $1,491,101\nOccupancy: Owner Occupied\n' +
    'CALL SUMMARY++ Seller Motivation: Not urgent, exploring options++ Timeline: No pressure' +
    '++ Property Details: 1390 Estudillo Ave, San Leandro, CA — 4bd/4ba, needs repairs' +
    '++ Objections/Concerns: Cautious — wants Juan to visit first++ Lead Temperature: WARM — engaged'
}, { appointmentText: 'Tue, Aug 4, 2026, 11:00 AM' });

check('motivation is the grade then the reason',
  CALL.includes('🌡️ Motivation: Warm — Not urgent, exploring options'), true);
check('known issues come from Objections/Concerns',
  CALL.includes('⚠️ Known issues: Cautious — wants Juan to visit first'), true);
check('occupancy comes from PropertyRadar', CALL.includes('👥 Occupancy: Owner Occupied'), true);
// The address is already the first line of the message; repeating it read as a different property.
check('property condition drops the repeated address',
  CALL.includes('🔧 Condition: 4bd/4ba, needs repairs'), true);
check('the appointment says what kind of visit it is',
  CALL.includes('in-person property visit'), true);

console.log('\n--- and the long dump is gone ---');
check('no raw REI notes block', CALL.includes('━━ ' + 'REI Notes'), false);
check('no activity block', CALL.includes('🕑 REI Activity:'), false);
check('no call-summary bullets pasted in', CALL.includes('CALL SUMMARY'), false);

console.log('\n=== The drive plan and directions sit under the appointment ===');
const TRIP_NOTE = buildInspectionNote({
  propertyAddress: '1390 Estudillo Ave, San Leandro, CA 94577',
  notes: 'Leave Office: 8:15 AM\nDrive Time: ~1 hr 45 mins (via US-101 N)'
}, { appointmentText: 'Mon, Jul 13, 2026, 10:00 AM' });
check('leave time', TRIP_NOTE.includes('🚪 Leave office: 8:15 AM'), true);
check('drive time', TRIP_NOTE.includes('🚗 Drive: ~1 hr 45 mins (via US-101 N)'), true);
check('a directions link is always there when an address is',
  TRIP_NOTE.includes('🗺️ Directions: https://www.google.com/maps/dir/?api=1&destination='), true);
check('no drive lines when nobody wrote them',
  ['🚪 Leave office', '🚗 Drive: '].some((l) => bare_.includes(l)), false);
check('no directions line without an address', bare_.includes('🗺️ Directions'), false);

console.log('\n=== Values already extracted upstream are used as-is ===');
/*
 * The calendar description is now a summary written once by the calendar module, so the note reads its
 * labelled lines instead of re-parsing REI's notes. Doing it twice from the same text was the old shape.
 */
const PRE = buildInspectionNote({
  propertyAddress: '1 A St, B, CA',
  estimatedValue: '$900,000',
  estimatedEquity: '$400,000 (44%)',
  occupancy: 'Vacant',
  motivationLevel: 'Hot — needs to close fast',
  callSummary: 'Seller inherited the house and wants it gone',
  leaveOffice: '7:30 AM'
}, { appointmentText: 'Tue, Aug 4, 2026, 11:00 AM' });
check('the figure is used', PRE.includes('💵 Estimated value: $900,000'), true);
check('equity is used', PRE.includes('📈 Equity: $400,000 (44%)'), true);
check('occupancy is used', PRE.includes('👥 Occupancy: Vacant'), true);
check('motivation is used', PRE.includes('🌡️ Motivation: Hot — needs to close fast'), true);
check('the call story is used', PRE.includes('Seller inherited the house'), true);
check('leave time is used', PRE.includes('🚪 Leave office: 7:30 AM'), true);
check('and it still says Lead Summary, not "no PropertyRadar note"',
  PRE.includes('📊 Lead Summary:  (no'), false);

console.log('\n--- the three summary lines appear only when the VA wrote them ---');
// Dropping the dump lost these, and they matter: how much time there is, whether a price has been named,
// and what is expected after the visit. Nobody fills these in at the door, so an absent one is omitted
// rather than shown as a blank to complete.
check('timeline is shown', CALL.includes('⏳ Timeline: No pressure'), true);
// The story, not a grade. It is what tells the person walking up to the door why they are there.
check('the call narrative is shown',
  buildInspectionNote({ notes: 'Summary: David is exploring options and wants a visit first' }, {})
    .includes('David is exploring options and wants a visit first'), true);
// Juan reads this on a phone on the way to a property. The full version is one tap away.
const LONG_CALL = buildInspectionNote({ notes: `Summary: ${'word '.repeat(200)}` }, {});
check('a long narrative is cut', LONG_CALL.length < 1600, true);
check('...and says where the rest is', LONG_CALL.includes('full notes on the REI link above'), true);
check('price expectation is omitted when "Not specified"',
  CALL.includes('💰 Price expectation'), false);
check('a named price IS shown',
  buildInspectionNote({ notes: 'Price Expectation: wants 1.6M' }, {}).includes('💰 Price expectation: wants 1.6M'), true);
// Timeline and price expectation are omitted when nobody wrote them; the after-the-visit line stays,
// because "what happens next" is always a question worth leaving open.
check('optional summary lines are omitted when empty',
  ['⏳ Timeline', '💰 Price expectation'].some((l) => bare_.includes(l)), false);
// The section is gone: it printed the whole REI ACCOUNT UPDATE log, and what happens after a visit is
// decided at the visit by whoever is reading this.
check('there is no after-the-visit section', bare_.includes('AFTER THE VISIT'), false);
check('the REI link is still there for anyone who wants the rest',
  note.includes('https://my.reiblackbook.com/contacts/20473369'), true);

console.log('\n=== The seller warning is opt-in and explicit ===');
check('absent by default', note.includes('THE SELLER IS IN THIS GROUP'), false);
check('present when asked for',
  buildInspectionNote(VISIT, { includeSellerWarning: true }).includes('THE SELLER IS IN THIS GROUP'), true);

console.log('\n=== containsSellerSensitive: the last check before anything is sent ===');
check('an equity figure is caught',
  containsSellerSensitive('Estimated Equity - $430,493').length > 0, true);
check('a motivation read is caught',
  containsSellerSensitive('Motivation Level: Warm').includes('motivation assessment'), true);
check('an internal disposition is caught',
  containsSellerSensitive("Reason: we're passing on this one").includes('internal disposition'), true);
check('"Dead Lead" is caught', containsSellerSensitive('Tags: Dead Lead, Lost Deal').length > 0, true);
check('offer limits are caught',
  containsSellerSensitive('Seller Floor 300k / Our Max 340k').includes('offer limits / comps'), true);
check('an assessed value is caught', containsSellerSensitive('Assessed Value - $568,697').length > 0, true);

console.log('\n--- and against the REAL REI notes now carried, not just the blank template ---');
/*
 * These lines are verbatim from a live REI contact. The note grew from a skeleton to 3,500 characters
 * of call summaries and comps, and the old patterns — aimed only at the skeleton's headings — matched
 * none of them. A detector that only recognises the template is a detector that passes anything.
 */
check('"Seller Motivation:" is caught',
  containsSellerSensitive('Seller Motivation: Not urgent — exploring options').includes('motivation assessment'), true);
check('"Lead Temperature: WARM" is caught',
  containsSellerSensitive('Lead Temperature: WARM — engaged seller').includes('motivation assessment'), true);
check('"Objections/Concerns" is caught',
  containsSellerSensitive('Objections/Concerns: cautious, exploring only').includes('motivation assessment'), true);
check('an ARV figure is caught',
  containsSellerSensitive('ARV strongly supported at approx $1.65M').includes('valuation / equity figures'), true);
check('a comp run is caught',
  containsSellerSensitive('comp run Aug 3, 2026, by Cherry').includes('offer limits / comps'), true);
check('an offer range is caught',
  containsSellerSensitive('offer within the range once he gives a number').includes('offer limits / comps'), true);
check('a preliminary offer is caught',
  containsSellerSensitive('Cherry to run comps and follow up with a preliminary offer').length > 0, true);
check('a price expectation is caught',
  containsSellerSensitive('Price Expectation: Not specified').includes('price strategy'), true);
check('"walk away" is caught',
  containsSellerSensitive('if he holds at that number we walk away').includes('internal disposition'), true);

console.log('\n--- and it does not cry wolf ---');
check('a plain address and time is fine',
  containsSellerSensitive('📍 Property: 15340 Canyon 2 Rd\n📅 Appointment: Mon Jul 20, 2:00 PM'), []);
check('access notes are fine',
  containsSellerSensitive('Occupancy: tenant-occupied, needs advance notice'), []);
check('empty is fine', containsSellerSensitive(''), []);

console.log('\n=== The generated note IS flagged, because it names those fields ===');
// The blank template still contains the words "Estimated Equity", so it must not be posted into a
// group with a seller in it even though the numbers are absent.
check('the blank template is treated as sensitive', containsSellerSensitive(note).length > 0, true);

console.log('\n=== Sections, so it can be read one thing at a time ===');
/*
 * The verdict on the flat version was "it is so short, it should be understandable" — and both halves were
 * fair. Nearly all the information was there; what was missing was shape. Somebody reading this on a phone
 * outside a house needs to find one thing at a time.
 */
const FULLNOTE = buildInspectionNote({
  propertyAddress: '1390 Estudillo Ave, San Leandro, CA 94577',
  sellerName: 'David Jackowitz',
  phone: '(510) 346-8546',
  reiLink: 'https://my.reiblackbook.com/contacts/20533149',
  leadSource: 'Direct Mail (Postcard)',
  assignedOwner: 'Juan',
  notes: 'Vested Owner: David B Jackowitz\nOccupancy: Owner Occupied\nEstimated Value: $1,491,101\n' +
    'Leave Office: 10:00 AM\nDrive Time: ~56 mins (https://maps.app.goo.gl/tfL4u5Uam65aB28j9)\n' +
    'Contact Result: Answered — 9 min 45 sec++ Summary: David is exploring options++ ' +
    'Objections/Concerns: Cautious, wants a visit first++ Lead Temperature: WARM'
}, { appointmentText: 'Tue, Aug 4, 2026, 11:00 AM' });

for (const heading of ['━━ WHEN ━━', '━━ WHO ━━', '━━ WHAT THE SELLER SAID ━━',
  '━━ THE NUMBERS ━━', '━━ FILL IN AT THE VISIT ━━']) {
  check(`${heading} is there`, FULLNOTE.includes(heading), true);
}
check('the heading still carries the marker, so a duplicate is recognised',
  FULLNOTE.startsWith('🏠 PROPERTY INSPECTION'), true);
// Who must actually sign. A trust or a second owner changes the whole conversation.
check('owner of record is called out', FULLNOTE.includes('🧾 Owner of record: David B Jackowitz'), true);
check('the call result is shown', FULLNOTE.includes('☎️ Call: Answered — 9 min 45 sec'), true);
check("the VA's own maps link wins", FULLNOTE.includes('🗺️ Directions: https://maps.app.goo.gl/tfL4u5Uam65aB28j9'), true);
check('and it is not printed twice', FULLNOTE.includes('🚗 Drive: ~56 mins'), true);

console.log('\n--- an empty section is omitted, not left as a bare heading ---');
// A heading with nothing under it says the section exists and is empty, which is never what happened.
const NO_CALL = buildInspectionNote({ propertyAddress: '1 A St, B, CA' }, { appointmentText: 'Tue 11:00 AM' });
check('no "what the seller said" heading with nothing said',
  NO_CALL.includes('━━ WHAT THE SELLER SAID ━━'), false);
check('but the numbers section stays, as blanks to look up',
  NO_CALL.includes('━━ THE NUMBERS ━━'), true);
check('and the fill-in section stays, as the job at the door',
  NO_CALL.includes('━━ FILL IN AT THE VISIT ━━'), true);

console.log('\n=== A swallowed REI log never reaches the group ===');
/*
 * The account-update note carries its OWN "Next Step:" label and arrives as one unbroken line, so the match
 * had no newline to stop at and ran to the end. The group got "Task: Created or confirmed... Workflow: None
 * ... Reason for Update... Updated by: Genesis Joy Mangohig...Show More" presented as the next step.
 */
const LOG = 'REI ACCOUNT UPDATE – August 3, 2026Changes Made:Tags: Added Appointment Booked' +
  'Next Step: Added Juan\u2019s property visit for August 4, 2026, at 11:00 AM, followed by comps review ' +
  'and preliminary-offer preparation.Task: Created or confirmed the property-visit task assigned to Jonathan.' +
  'Workflow: NoneReason for Update: David completed a live qualification call.Updated by: Genesis Joy Mangohig';
const FROMLOG = buildInspectionNote({ propertyAddress: '1 A St, B, CA', notes: LOG }, {});
check('no audit trail in the note', FROMLOG.includes('Updated by'), false);
check('no "Show More" leakage', /Show More/.test(FROMLOG), false);
check('no "Workflow: None"', FROMLOG.includes('Workflow'), false);
check('and no section built from it', FROMLOG.includes('AFTER THE VISIT'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
