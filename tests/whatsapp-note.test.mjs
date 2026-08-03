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
check("REI's own notes are carried across", note.includes('Equity Percentage: 22%'), true);

console.log('\n=== The full REI notes and activity, not a one-line stand-in ===');
/*
 * The team asked for "all of the REI notes" and were getting one line. REI's Notes and Activity are
 * multi-line blocks; both belong in the briefing, with their line breaks, because the appointment
 * history in there is a list and flattening it makes it unreadable.
 */
const FULL = buildInspectionNote({
  propertyAddress: '1390 Estudillo Ave, San Leandro, CA 94577',
  notes: 'Equity Percentage: 22%\nOwner wants to close before September.\nPrice: 450k discussed.',
  latestActivity: 'Aug 1 - call, 4 min\nJul 28 - postcard responded',
  nextAction: 'Juan to visit on August 4, 2026, at 11:00 AM'
}, { appointmentText: 'Tue, Aug 4, 2026, 11:00 AM' });

check('the notes heading is there', FULL.includes('📝 REI Notes:'), true);
check('every notes line survives',
  ['Equity Percentage: 22%', 'Owner wants to close before September.', 'Price: 450k discussed.']
    .every((l) => FULL.includes(l)), true);
check('the activity heading is there', FULL.includes('🕑 REI Activity:'), true);
check('every activity line survives',
  ['Aug 1 - call, 4 min', 'Jul 28 - postcard responded'].every((l) => FULL.includes(l)), true);
check('next action is its own line',
  FULL.includes('➡️ Next Action: Juan to visit on August 4, 2026, at 11:00 AM'), true);
check('line breaks are preserved, not flattened', FULL.includes('22%\nOwner wants'), true);

console.log('\n--- and a long note says it was cut, rather than stopping mid-sentence ---');
// A note that just stops reads as the whole story. Whoever is at the property needs to know there
// is more of it in REI.
const LONG = buildInspectionNote({ notes: 'x'.repeat(4000) }, {});
check('it is truncated', LONG.includes('x'.repeat(4000)), false);
check('...and says so', LONG.includes('truncated — the rest is on the REI contact'), true);

console.log('\n--- absent blocks add no empty headings ---');
check('no notes heading when REI had none', bare_.includes('📝 REI Notes:'), false);
check('no activity heading when REI had none', bare_.includes('🕑 REI Activity:'), false);
check('no next-action line when REI had none', bare_.includes('➡️ Next Action:'), false);

console.log('\n=== Lines REI cannot fill appear as BLANKS, not omissions ===');
// Dropping these would read as "there are no known issues", which is a different claim entirely.
for (const label of ['Motivation Level', 'Reason for Selling', 'Occupancy', 'Property Condition', 'Known Issues']) {
  check(`${label} is present and blank`, note.includes(`${label}: ${TO_FILL_IN}`), true);
}
for (const label of ['Estimated Value', 'Assessed Value', 'Estimated Open Loans Balance', 'Estimated Equity', 'Purchase Date']) {
  check(`${label} is present and blank`, note.includes(`${label} - ${TO_FILL_IN}`), true);
}
check('and it says where those come from', note.includes('from PropertyRadar'), true);

console.log('\n=== Missing facts become blanks too, never silent gaps ===');
const bare = buildInspectionNote({}, {});
check('a blank record still lists every line', bare.split('\n').filter((l) => l.includes(TO_FILL_IN)).length >= 10, true);
check('...and does not invent an address', bare.includes(`Property: ${TO_FILL_IN}`), true);
check('no beds line when REI had none', bare.includes('bd ·'), false);
check('no REI-notes line when there were none', bare.includes('📝 From REI'), false);

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
  containsSellerSensitive('Seller Floor 300k / Our Max 340k').includes('offer limits'), true);
check('an assessed value is caught', containsSellerSensitive('Assessed Value - $568,697').length > 0, true);

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
