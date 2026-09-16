/**
 * The calendar event carries the briefing, and the machine still reads the fields underneath it.
 *
 *   node tests/calendar-description.test.mjs
 *
 * WHY IT EXISTS, and it is one of the plainer lessons in this project.
 *
 * buildDescription is pure — a visit object in, text out — and it lived in a module that imports
 * googleapis, so no test could ever run it. Everything that touched it read the file as a STRING and
 * matched regexes against the source code.
 *
 * That is how Beds / Baths / Square Footage stayed broken. The scraper read them off REI's own text
 * chips. The note builder printed them. Nothing wrote them into the description in between, and the
 * description is what the briefing is assembled from — so the line was empty in every briefing ever
 * sent. No regex over source text can see a missing line. Only rendering the thing and reading it can.
 *
 * So this RENDERS. Every check below is about what a person actually receives.
 */
import { buildDescription } from '../twin-visit-logger-sandbox/src/google/description.mjs';
import { fieldFromDescription, blockFromDescription, DETAILS_HEADING }
  from '../twin-visit-logger-sandbox/src/whatsapp/plan.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const NOTES = 'PropertyRadar Verification Note. Property Type: Single Family. Lot Size: 6,534 sqft. '
  + 'Garage: 2-car attached. Year Built: 1974. County: Alameda. Estimated Value $755,500 '
  + 'Assessed Value $412,000 Estimated Open Loan Balance $180,000 Estimated Equity $575,500 (76.18%) '
  + 'Purchase Date 07/21/2000 Purchase Amount $801,000 Owner Occupied Vested Owner Maria L Gomez. '
  + 'Lead Temperature: WARM — engaged seller++ Summary: Maria inherited the house from her mother++ '
  + 'Reason for Selling: inherited, cannot keep up the taxes++ Timeline: 30 days++ '
  + 'Price Expectation: $780,000++ Objections/Concerns: two large dogs, use the side gate++ '
  + 'Leave Office: 1:05 PM++ Drive Time: ~40 mins';

const VISIT = {
  sellerName: 'Maria Gomez',
  phone: '(510) 214-3017',
  email: 'maria@example.com',
  propertyAddress: '123 Madera Ave, Hayward, CA 94544',
  reiLink: 'https://my.reiblackbook.com/contacts/20284479',
  assignedOwner: 'Juan',
  leadSource: 'PPC',
  contactStage: '3 Appointment Booked',
  beds: '4', baths: '2.0', sqft: '2,448',
  notes: NOTES
};

const DESC = buildDescription(VISIT, { appointmentText: 'Wednesday 17 September 2026, 2:00 PM' });

console.log('=== The event opens with the briefing, not with a wall of labels ===');
/*
 * The client, having been sent the three-section template: "that should be added as well for the
 * calendar". The event is the thing already open on a visitor's phone when the leave-now reminder fires.
 */
check('it starts with the inspection heading', DESC.startsWith('🏡 PROPERTY INSPECTION'), true);
for (const line of ['📍 Property: 123 Madera Ave', '👤 Seller: Maria Gomez', '📞 Phone: (510) 214-3017',
  '📧 Email: maria@example.com', '📅 Appointment: Wednesday 17 September 2026, 2:00 PM',
  '👷 Walkthrough By: Juan', '🏠 PROPERTY DETAILS', '🔥 SELLER MOTIVATION']) {
  check(`"${line}" is on the event`, DESC.includes(line), true);
}

console.log('\n--- the fields REI holds and nobody could see ---');
/*
 * THE BUG THIS FILE EXISTS FOR. Scraped, printed, and never carried between the two.
 */
check('beds and baths reach the event', DESC.includes('Beds/Baths: 4 / 2.0'), true);
check('square footage reaches the event', DESC.includes('Square Footage: 2,448'), true);
check('email reaches the event', DESC.includes('📧 Email: maria@example.com'), true);

console.log('\n=== The machine block is still underneath, and still readable ===');
check('the marker is there', DESC.includes(DETAILS_HEADING), true);
for (const [label, value] of [
  ['Seller', 'Maria Gomez'],
  ['Phone', '(510) 214-3017'],
  ['Email', 'maria@example.com'],
  ['Property', '123 Madera Ave, Hayward, CA 94544'],
  ['REI BlackBook', 'https://my.reiblackbook.com/contacts/20284479'],
  ['Assigned Owner', 'Juan'],
  ['Lead Source', 'PPC'],
  ['Beds', '4'],
  ['Baths', '2.0'],
  ['Square Footage', '2,448'],
  ['Property Type', 'Single Family'],
  ['Lot Size', '6,534 sqft'],
  ['Estimated Equity', '$575,500 (76.18%)'],
  ['Timeline', '30 days']
]) check(`${label} reads back`, fieldFromDescription(DESC, label), value);

console.log('\n=== The two halves must NOT share one namespace ===');
/*
 * This is the reason for the marker, and both failures below would have been silent.
 *
 * The briefing DECORATES: "Motivation Level: 🟡 Medium (WARM — engaged seller)" where the field holds
 * "WARM — engaged seller". A parser reading the briefing line would re-decorate an already-decorated
 * value on every sync, and the event is rewritten on every re-check.
 */
check('the briefing shows the colour', DESC.includes('Motivation Level: 🟡 Medium (WARM — engaged seller)'), true);
check('...but the FIELD is read undecorated', fieldFromDescription(DESC, 'Motivation Level'),
  'WARM — engaged seller');
check('...so a second pass does not stack colours',
  buildDescription({ ...VISIT, notes: NOTES }, { appointmentText: 'x' })
    .includes('🟡 Medium (🟡 Medium'), false);

/*
 * The briefing prints "_______" for anything nobody has filled in. Read back as a value, that row of
 * underscores gets written onward into a sheet cell as though somebody had answered.
 */
const THIN = buildDescription({ propertyAddress: '1 A St, B, CA' }, { appointmentText: 'Tue 11:00 AM' });
check('a thin lead still gets the whole form', THIN.includes('Property Condition: _______'), true);
check('...and the blank is NOT read back as an answer',
  fieldFromDescription(THIN, 'Property Condition'), '');
check('...nor is the unfilled motivation scale',
  fieldFromDescription(THIN, 'Motivation Level'), '');

console.log('\n=== Events written before today still parse ===');
// The marker did not exist yesterday. Every event already on Juan's calendar is missing it.
const OLD = 'Seller: David Jackowitz\nPhone: (510) 346-8546\nNotes:\n  he called back twice\n'
  + 'Next Action: confirm Thursday';
check('an old description still reads its fields', fieldFromDescription(OLD, 'Seller'), 'David Jackowitz');
check('...and its blocks', blockFromDescription(OLD, 'Notes').trim(), 'he called back twice');

console.log('\n=== It fits in a calendar description ===');
/*
 * Google truncates past about 8,000 characters, and it truncates the END — where the labelled fields
 * are. The REI link every later step navigates by is in that block, so DETAILS gets its room first and
 * the briefing takes what is left.
 */
const HUGE = buildDescription({ ...VISIT, notes: `${NOTES} ${'padding word '.repeat(900)}` },
  { appointmentText: 'Wed 2:00 PM' });
check('the whole description stays under the limit', HUGE.length <= 8000, true);
check('...and the REI link survives, because DETAILS is not what gets cut',
  fieldFromDescription(HUGE, 'REI BlackBook'), 'https://my.reiblackbook.com/contacts/20284479');

console.log('\n=== One builder, so the calendar and Chat cannot drift ===');
/*
 * The Chat copy was once assembled separately and silently dropped the drive plan, every PropertyRadar
 * figure, motivation, condition, timeline and price — about half the briefing. The event now carries the
 * output of the same function Chat sends, so there is no second copy to fall behind.
 */
const SRC = (await import('node:fs')).readFileSync(
  new URL('../twin-visit-logger-sandbox/src/google/description.mjs', import.meta.url), 'utf8');
check('the description imports the briefing builder rather than rebuilding it',
  /import \{ briefingFromDescription \} from '\.\.\/whatsapp\/note\.mjs'/.test(SRC), true);
check('...and calendar.mjs re-exports it, so no caller had to change',
  /export \{ buildDescription \}/.test((await import('node:fs')).readFileSync(
    new URL('../twin-visit-logger-sandbox/src/google/calendar.mjs', import.meta.url), 'utf8')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
