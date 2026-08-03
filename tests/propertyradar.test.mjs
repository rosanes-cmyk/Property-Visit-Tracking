/**
 * Reading the PropertyRadar figures out of REI's notes.
 *
 *   node tests/propertyradar.test.mjs
 *
 * These five numbers printed as permanent blanks in the visit briefing for most of this project, on my
 * conclusion that REI has no fields for them. True, and beside the point: the team's VA pastes a
 * "PropertyRadar Verification" note onto the contact with every one of them written out. The right
 * question was never "does REI have a field" but "can this be read from what REI holds".
 *
 * The note below is copied verbatim from the live contact for 1390 Estudillo Ave.
 */
import { extractPropertyRadar, hasAnyPropertyRadar, tidyReiNotes, labelledValue, extractCallSummary } from '../twin-visit-logger-sandbox/src/whatsapp/propertyradar.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const REAL = [
  'PropertyRadar Verification — 08/03/26',
  'Vested Owner: David B Jackowitz',
  'Seller Matches Vested Owner: Yes',
  'Vesting Type: Individual Owner',
  'Property Address: 1390 Estudillo Ave, San Leandro, CA 94577',
  'Mailing Address: 1390 Estudillo Ave, San Leandro, CA 94577',
  'Occupancy: Owner Occupied',
  'Estimated Value: $1,491,101',
  'Estimated Open Loan Balance: $276,165',
  'Estimated Equity: $1,214,936 (81.48%)',
  'Purchase Date: 07/21/2000',
  'Purchase Amount: $801,000',
  'Purchase Type: Market',
  'Open Loans: Estimated open loan balance of $276,165',
  'Distress Indicators: Distress Score 0',
  'Source: PropertyRadar'
].join('\n');

console.log('=== The real note from the 1390 Estudillo contact ===');
const r = extractPropertyRadar(REAL);
check('estimated value', r.estimatedValue, '$1,491,101');
// PropertyRadar writes "Loan", the briefing line says "Loans". Matching only the plural found nothing.
check('open loans balance (note says "Loan", singular)', r.openLoansBalance, '$276,165');
check('equity keeps its percentage', r.estimatedEquity, '$1,214,936 (81.48%)');
check('purchase date carries what was paid', r.purchaseDate, '07/21/2000 ($801,000)');
check('occupancy', r.occupancy, 'Owner Occupied');
// A single-letter middle initial: this came back as just "David" while every word needed 2+ characters.
check('vested owner keeps the middle initial', r.vestedOwner, 'David B Jackowitz');
// The label is not in this note, and inventing a number would be far worse than a blank.
check('assessed value is absent here, and stays absent', r.assessedValue, '');
check('something was found', hasAnyPropertyRadar(r), true);

console.log('\n=== REI glues labels onto values with no separator ===');
// Documented in config/rei-selectors.json and already the cause of one wrong conclusion here. Anchoring
// on line starts finds nothing on scraped text, so the parser is token-based.
const GLUED = 'Occupancy: Owner OccupiedEstimated Value: $1,491,101Estimated Open Loan Balance: ' +
  '$276,165Estimated Equity: $1,214,936 (81.48%)Purchase Date: 07/21/2000Purchase Amount: $801,000';
const g = extractPropertyRadar(GLUED);
check('value still found', g.estimatedValue, '$1,491,101');
check('loans still found', g.openLoansBalance, '$276,165');
check('equity still found', g.estimatedEquity, '$1,214,936 (81.48%)');
check('purchase date still found', g.purchaseDate, '07/21/2000 ($801,000)');
check('occupancy does not swallow the next label', g.occupancy, 'Owner Occupied');

console.log('\n=== Nothing there means nothing claimed ===');
const none = extractPropertyRadar('David confirmed ownership and is available for the visit.');
check('no figures invented', [none.estimatedValue, none.openLoansBalance, none.estimatedEquity,
  none.purchaseDate, none.assessedValue], ['', '', '', '', '']);
check('hasAnyPropertyRadar says so', hasAnyPropertyRadar(none), false);
check('empty text', hasAnyPropertyRadar(extractPropertyRadar('')), false);
check('undefined does not throw', hasAnyPropertyRadar(extractPropertyRadar(undefined)), false);

console.log('\n=== Other occupancy values PropertyRadar reports ===');
check('tenant occupied', extractPropertyRadar('Occupancy: Tenant Occupied').occupancy, 'Tenant Occupied');
check('vacant', extractPropertyRadar('Occupancy: Vacant').occupancy, 'Vacant');

console.log('\n=== A partial note fills what it has and no more ===');
// Half a PropertyRadar note is common — the VA runs it before every figure is available.
const partial = extractPropertyRadar('Estimated Value: $980,000\nOccupancy: Vacant');
check('the value it has', partial.estimatedValue, '$980,000');
check('and blanks for the rest', [partial.estimatedEquity, partial.purchaseDate], ['', '']);
// Equity with no percentage should still come through — the number alone is worth having.
check('equity without a percentage', extractPropertyRadar('Estimated Equity: $500,000').estimatedEquity, '$500,000');

console.log('\n=== tidyReiNotes: what actually reaches the group ===');
const MESSY = "Latest Engagement InsightsText RecievedAug 03, 2026, 11:32 AMCall OutgoingAug 03, 2026, 11:11 AMEmail--RVM--\n\n" +
  "NotesDavid confirmed ownership.\n\nNext StepJuan to visit on August 4.\n\n" +
  "CALL SUMMARY – August 3, 2026++ Contact Result: Answered++ Seller Motivation: Not urgent++ Lead Temperature: WARM....Show MoreAug 03, 2026Genesis Joy Mangohig\n\n" +
  REAL;
const tidy = tidyReiNotes(MESSY);

check('the engagement counter strip is gone', tidy.includes('Latest Engagement Insights'), false);
check('"Show More" is gone', /Show (More|Less)/.test(tidy), false);
check('the trailing byline is gone', tidy.includes('Genesis Joy Mangohig'), false);
// The figures are shown as their own clean lines above, so the raw block is pure duplication.
check('the PropertyRadar block is not repeated', tidy.includes('Source: PropertyRadar'), false);
check('"NotesDavid" becomes "Notes: David"', tidy.includes('Notes: David confirmed ownership.'), true);
check('"Next StepJuan" becomes "Next Step: Juan"', tidy.includes('Next Step: Juan to visit'), true);
check('"++" becomes bullets', tidy.includes('\n• Contact Result: Answered'), true);
check('every summary field gets its own line',
  ['• Contact Result:', '• Seller Motivation:', '• Lead Temperature:'].every((b) => tidy.includes(b)), true);
check('no run of blank lines', /\n{3,}/.test(tidy), false);
check('and it does not end on a stray bullet', /•\s*$/.test(tidy), false);

console.log('\n--- and it leaves anything it does not recognise alone ---');
// A briefing that quietly eats somebody's notes is worse than an ugly one.
const PLAIN = 'Spoke to the tenant. Gate code is 4471. Dog in the yard — call ahead.';
check('ordinary prose is untouched', tidyReiNotes(PLAIN), PLAIN);
check('empty stays empty', tidyReiNotes(''), '');
check('undefined does not throw', tidyReiNotes(undefined), '');

console.log('\n=== extractCallSummary: the judgement lines the VA already wrote ===');
/*
 * Motivation Level, Reason for Selling, Property Condition and Known Issues printed as blanks while the
 * answers sat a few lines down the same notes, as labelled facts in the VA's call summary.
 */
const SUMMARY = 'CALL SUMMARY – August 3, 2026++ Contact Result: Answered++ ' +
  'Seller Motivation: Not urgent, exploring options due to repair needs++ ' +
  'Timeline: No pressure; visit tomorrow++ Price Expectation: Not specified.++ ' +
  'Property Details: 4bd/4ba, needs repairs++ ' +
  'Objections/Concerns: Cautious — wants Juan to visit first++ ' +
  'Next Step: Juan to visit; Cherry to run comps++ ' +
  'Lead Temperature: WARM — engaged seller, cautious but moving forward';
const cs = extractCallSummary(SUMMARY);

// Grade then reason. Joining both sentences in full gave four clauses and three dashes for one idea.
check('motivation is the grade then the reason',
  cs.motivationLevel, 'Warm — Not urgent, exploring options due to repair needs');
check('known issues come from Objections/Concerns',
  cs.knownIssues, 'Cautious — wants Juan to visit first');
check('property condition falls back to Property Details', cs.propertyCondition, '4bd/4ba, needs repairs');
check('timeline', cs.timeline, 'No pressure; visit tomorrow');
// "Not specified" is the VA saying there is no answer. A blank says that without dressing it up.
check('"Not specified" reads as blank', cs.priceExpectation, '');
check('no Reason for Selling label means blank', cs.reasonForSelling, '');
check('next step is what happens after the visit', cs.nextStep, 'Juan to visit; Cherry to run comps');

console.log('\n--- labelledValue stops at the next field ---');
check('stops at "++"', labelledValue('Timeline: tomorrow++ Price: 400k', 'Timeline'), 'tomorrow');
check('stops at a newline', labelledValue('Timeline: tomorrow\nPrice: 400k', 'Timeline'), 'tomorrow');
check('stops at a bullet', labelledValue('Timeline: tomorrow• Price: 400k', 'Timeline'), 'tomorrow');
check('a missing label is blank', labelledValue('Nothing here', 'Timeline'), '');
check('an empty value is blank', labelledValue('Timeline:', 'Timeline'), '');
check('"N/A" is blank', labelledValue('Timeline: N/A', 'Timeline'), '');
check('nothing at all', extractCallSummary('').motivationLevel, '');
check('undefined does not throw', extractCallSummary(undefined).knownIssues, '');

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
