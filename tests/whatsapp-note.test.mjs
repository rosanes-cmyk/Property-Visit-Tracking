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
  CALL.includes('🌡️ Motivation Level: Warm — Not urgent, exploring options'), true);
check('known issues come from Objections/Concerns',
  CALL.includes('⚠️ Known Issues: Cautious — wants Juan to visit first'), true);
check('occupancy comes from PropertyRadar', CALL.includes('👥 Occupancy: Owner Occupied'), true);
// The address is already the first line of the message; repeating it read as a different property.
check('property condition drops the repeated address',
  CALL.includes('🔧 Property Condition: 4bd/4ba, needs repairs'), true);
check('the appointment says what kind of visit it is',
  CALL.includes('(In-Person Property Visit)'), true);

console.log('\n--- and the long dump is gone ---');
check('no raw REI notes block', CALL.includes('📝 REI Notes:'), false);
check('no activity block', CALL.includes('🕑 REI Activity:'), false);
check('no call-summary bullets pasted in', CALL.includes('CALL SUMMARY'), false);
check('the REI link is still there for anyone who wants the rest',
  note.includes('https://my.reiblackbook.com/contacts/20473369'), true);

console.log('\n=== The seller warning is opt-in and explicit ===');
check('absent by default', note.includes('THE SELLER IS IN THIS GROUP'), false);
check('present when asked for',
  buildInspectionNote(VISIT, { includeSellerWarning: true }).includes('THE SELLER IS IN THIS GROUP'), true);

console.log('\n=== containsSellerSensitive: the last check before anything is sent ===');
check('an equity figure is caught',
  containsSellerSensitive('📈 Estimated Equity - $430,493').length > 0, true);
check('a motivation read is caught',
  containsSellerSensitive('🌡️ Motivation Level: Warm').includes('motivation assessment'), true);
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

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
