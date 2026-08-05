/**
 * Reading a cancellation off a REI contact page.
 *
 *   node tests/cancel-signal.test.mjs
 *
 * This suite exists because of one lead and one word. Jose Anguiano's visit was booked for Aug 1, 2026.
 * On Aug 5 the tracker still said "Scheduled", the 3pm card said "OVERDUE — visit was 2026-08-01 and is
 * still marked Scheduled", and every re-check reported "REI agrees with the sheet".
 *
 * REI knew. rei-task-doctor pulled this note straight off his contact page:
 *
 *     "Notes Equity Percentage: 22% |cancelled booked appointment"
 *
 * The detector required "cancelled appointment" to be ADJACENT. The word "booked" sat between them. A
 * cancellation written in plain English on the page was invisible to the automation for five days, and
 * the client was right that the board was not accurate.
 *
 * The risk in widening a regex over free page text is firing on the wrong sentence, so most of what
 * follows tests what must NOT match.
 */
import { cancellationEvidence, deadLeadTags } from '../twin-visit-logger-sandbox/src/rei/cancel-signal.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* Verbatim from rei-task-doctor against https://my.reiblackbook.com/contacts/20473369 on Aug 5, 2026. */
const JOSE_NOTE = 'Notes Equity Percentage: 22% |cancelled booked appointment';
const JOSE_TAGS = 'REI ACCOUNT UPDATE – July 20, 2026 Changes Made: Tags: Added "Dead Lead," ' +
  '"Lost Deal," "We\'re Passing," "Do Not Contact"';

console.log('=== The lead this was built for ===');
check('Jose\'s note IS a cancellation', cancellationEvidence(JOSE_NOTE).cancelled, true);
check('...and the evidence is carried out so a run can print it',
  /cancelled booked appointment/.test(cancellationEvidence(JOSE_NOTE).phrase), true);
check('...and it is not treated as a hypothetical', cancellationEvidence(JOSE_NOTE).hypothetical, false);
// The exact regression: the old rule required the two words to be adjacent.
check('the OLD adjacent-words rule missed it — this is the bug',
  /cancel(?:l)?ed appointment/.test(JOSE_NOTE.toLowerCase()), false);

console.log('\n=== Wordings that must be caught ===');
for (const text of [
  'cancelled appointment',
  'canceled appointment',
  'cancelled booked appointment',
  'canceled booked appointment',
  'cancelled the appointment',
  'cancelled her booked appointment',
  'Appointment cancelled',
  'appointment was cancelled',
  'appointment has been canceled',
  'cancellation of the appointment',
  'Seller called back — cancelled booked appointment, not selling after all'
]) {
  check(`"${text}"`, cancellationEvidence(text).cancelled, true);
}

console.log('\n=== Wordings that must NOT be caught ===');
/*
 * These are the false positives that would call off a visit which is still going ahead. A seller's
 * negotiating position in a note is not an outcome.
 */
for (const text of [
  'she may cancel the appointment if we cannot do 495',
  'seller might cancel her appointment',
  'asked to cancel the appointment but we talked her round',
  'wants to cancel the appointment unless we raise the offer',
  'there is a risk of a cancelled appointment here',
  'will cancel the appointment if the inspection is not done first',
  'threatened to cancel the appointment',
  'could cancel the appointment'
]) {
  check(`"${text}"`, cancellationEvidence(text).cancelled, false);
}
/*
 * Two different mechanisms reject the list above, and it matters which is doing the work:
 *
 *   - most are rejected on TENSE. "may cancel the appointment" is not "cancelled", so no pattern fires
 *     at all. Only a completed act reads as a cancellation.
 *   - "risk of a cancelled appointment" DOES contain the past tense adjacent, so only the hedge rule
 *     stops it. That is the case the HYPOTHETICAL list is actually for.
 */
check('a hedged PAST-tense phrase is rejected by the hedge rule, and says so',
  cancellationEvidence('there is a risk of a cancelled appointment here').hypothetical, true);
check('...and still reports the phrase, so the judgement is visible',
  /cancelled appointment/.test(cancellationEvidence('there is a risk of a cancelled appointment here').phrase), true);
check('a present-tense intention is rejected on tense, before the hedge rule is needed',
  cancellationEvidence('she may cancel the appointment'), { cancelled: false, phrase: '', hypothetical: false });
check('"if she cancelled the appointment we would refund" is hedged',
  cancellationEvidence('if she cancelled the appointment we would refund the deposit').cancelled, false);

console.log('\n--- and the two-word bound is what keeps it honest ---');
/*
 * Unbounded, any page containing both words anywhere would cancel a visit. Two words is enough for
 * "cancelled her booked appointment" and short enough that unrelated prose cannot bridge the gap.
 */
check('two words between still matches', cancellationEvidence('cancelled his booked appointment').cancelled, true);
check('three words between does NOT',
  cancellationEvidence('cancelled the mailer run before the appointment').cancelled, false);
check('a whole sentence between does NOT',
  cancellationEvidence('we cancelled the postcard drop last month. Juan is driving to the appointment Friday').cancelled, false);
check('the words in the wrong order with prose between does NOT',
  cancellationEvidence('appointment went well; we cancelled the follow-up mailer').cancelled, false);

console.log('\n=== Nothing to say ===');
check('an empty page is not a cancellation', cancellationEvidence('').cancelled, false);
check('null is safe', cancellationEvidence(null).cancelled, false);
check('undefined is safe', cancellationEvidence(undefined).cancelled, false);
check('no phrase means no evidence string', cancellationEvidence('nothing relevant here').phrase, '');
check('an ordinary contact page is untouched',
  cancellationEvidence('Booked appointment | (650) 771-7814 | August 12, 2026 2:00 PM').cancelled, false);
// Line breaks and runs of whitespace are normalised, because page innerText is full of them.
check('a newline between the words still matches',
  cancellationEvidence('cancelled\n   booked\n appointment').cancelled, true);

console.log('\n=== Dead-lead tags are REPORTED, never acted on ===');
/*
 * Jose's contact carried these on July 20 while the tracker had him at Visit Scheduled with a visit
 * coming up. Closing a deal out is a decision about somebody's property; the team has made that call by
 * hand throughout, and the text available is an account-update NOTE rather than the live tag list — it
 * says what was true the day it was written, which is no basis for closing a deal automatically.
 */
check('all four of Jose\'s tags are found', deadLeadTags(JOSE_TAGS),
  ['dead lead', 'lost deal', "we're passing", 'do not contact']);
check('a clean contact has none', deadLeadTags('Lead Source: PPC · Stage: Visit Scheduled'), []);
check('null is safe', deadLeadTags(null), []);
check('matching is case-insensitive', deadLeadTags('DEAD LEAD'), ['dead lead']);
check('"we are passing" is caught as well as the apostrophe form',
  deadLeadTags('we are passing on this one'), ['we are passing']);
// The whole point of the split: tags never become a status.
check('a dead tag is NOT a cancellation', cancellationEvidence(JOSE_TAGS).cancelled, false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
