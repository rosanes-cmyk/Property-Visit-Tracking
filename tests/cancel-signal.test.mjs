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
import { cancellationEvidence, deadLeadTags, visitOutcomeFromNotes } from '../twin-visit-logger-sandbox/src/rei/cancel-signal.mjs';
import fs from 'node:fs';

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

console.log('\n=== The outcome a colleague already wrote in the notes ===');
/*
 * From one screenshot of the client's live dashboard, both cards reading "Visit Scheduled":
 *
 *   Lili          note: "Cancelled the property visit - spoke to her first about the price range |
 *                        Cherry to call her back this afternoon to present preliminary offer"
 *   Henry Watson  note: "Lead is no show, continue to engage with him"
 *
 * "as you see in the dashboard its not the same in the rei that already updated at all by my colleagues."
 * The answer was not in REI at all. It was in his own sheet, and nothing read it.
 */
const LILI = 'Cancelled the property visit - spoke to her first about the price range | Cherry to call ' +
  'her back this afternoon to present preliminary offer and negotiate';
const HENRY = 'Lead is no show, continue to engage with him';

check("Lili's note is a cancellation", visitOutcomeFromNotes(LILI).status, 'Canceled');
check('...read as a cancellation, not a no-show', visitOutcomeFromNotes(LILI).kind, 'canceled');
check('...and the sentence is quoted back', /Cancelled the property visit/.test(visitOutcomeFromNotes(LILI).phrase), true);
// "visit" rather than "appointment" is exactly what the old rule could not see.
check('the OLD appointment-only rule missed it', /appointment/i.test(LILI), false);

check("Henry's no-show is an outcome", visitOutcomeFromNotes(HENRY).status, 'Canceled');
check('...and is labelled a no-show, not a cancellation', visitOutcomeFromNotes(HENRY).kind, 'no-show');

console.log('\n--- other wordings the team really uses ---');
for (const [note, status, kind] of [
  ['Visit completed, seller wants 495k', 'Completed', 'completed'],
  ['visit went well, preparing offer', 'Completed', 'completed'],
  ['Completed the walkthrough this morning', 'Completed', 'completed'],
  ['Nobody was home when Juan arrived', 'Canceled', 'no-show'],
  ['seller no-showed', 'Canceled', 'no-show'],
  ["didn't show up", 'Canceled', 'no-show'],
  ['cancelled the showing', 'Canceled', 'canceled'],
  ['walkthrough cancelled by seller', 'Canceled', 'canceled']
]) {
  check(`"${note}" -> ${status}/${kind}`,
    [visitOutcomeFromNotes(note).status, visitOutcomeFromNotes(note).kind], [status, kind]);
}

console.log('\n--- and the notes that must NOT move a status ---');
/*
 * These are the false positives that would tell the team a visit is over when it is still coming. The last
 * two matter most: "Conduct scheduled visit & log outcome" is the Next Action text on EVERY scheduled lead,
 * and it is read by this audit, so a loose rule would have cancelled the entire pipeline.
 */
for (const note of [
  'Conduct scheduled visit & log outcome',
  'Scheduled-visit reminder — conduct visit & log outcome',
  'visited the area last week to check comps',
  'she may cancel the visit if we cannot do 495',
  'wants to cancel the visit unless we raise the offer',
  'will cancel the walkthrough if the tenant objects',
  'no show risk — she has cancelled on two other buyers',
  'met her at the office to sign paperwork',
  'Auto-logged from REI task email - source: PropertyLeads (PPL) - REI stage: 3 Appointment Booked',
  ''
]) {
  check(`"${note.slice(0, 52)}" moves nothing`, visitOutcomeFromNotes(note).status, '');
}
check('null is safe', visitOutcomeFromNotes(null).status, '');

console.log('\n--- a hedge AFTER the phrase counts too ---');
/*
 * Caught by this suite, not in production: "no show risk — she has cancelled on two other buyers" read as
 * a no-show and would have marked a live visit Canceled. The qualifier trails the phrase, and the hedge
 * check only looked at the words in front of it.
 */
for (const note of [
  'no show risk — she has cancelled on two other buyers',
  'cancelled visit is a possibility if the tenant refuses access',
  'possible no show, Juan will call ahead',
  'worried about a cancelled walkthrough'
]) {
  check(`"${note.slice(0, 50)}" moves nothing`, visitOutcomeFromNotes(note).status, '');
}
// It must not suppress the real thing: neither live note contains a trailing hedge.
check("Lili's real note still fires", visitOutcomeFromNotes(LILI).status, 'Canceled');
check("Henry's real note still fires", visitOutcomeFromNotes(HENRY).status, 'Canceled');
check('a plain completion still fires', visitOutcomeFromNotes('Visit completed, offer at 450k').status, 'Completed');

console.log('\n=== What the audit will and will not write ===');
const AUDIT = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/audit-notes.mjs', import.meta.url), 'utf8');
check('it is a dry run unless told otherwise', /const APPLY = args\.includes\('--yes'\)/.test(AUDIT), true);
check('it reads every column a colleague might type into', /const NOTE_COLUMNS = \[/.test(AUDIT), true);
check('...including the one REI notes land in', /'Automation Note'/.test(AUDIT), true);
check('it writes Visit Status', /cell\('Visit Status', found\.status\)/.test(AUDIT), true);
// The refusal that makes it safe to run over 378 rows of other people's work.
check('a status a PERSON set is never overwritten',
  /if \(current && current !== 'Scheduled'\) \{/.test(AUDIT), true);
check('...it is reported as a conflict instead', /notes and a HUMAN-SET status disagree/.test(AUDIT), true);
check('...and handed to a person', /The automation does not overrule a status somebody set/.test(AUDIT), true);
check('the stage move is the same guarded one, reused not reinvented',
  /STAGE_ADVANCE_FROM, STAGE_ON_COMPLETION/.test(AUDIT), true);
check('every change quotes its evidence', /because: "\.\.\.\$\{found\.phrase\}\.\.\."/.test(AUDIT), true);
check('it writes single cells, never whole rows', /values\.batchUpdate/.test(AUDIT), true);
check('it never touches Visit Notes', /cell\('Visit Notes'/.test(AUDIT), false);
check('it never sets money', /Approved Offer Amount/.test(AUDIT), false);
// One Chat message for the whole run: a first pass over a backlog could touch dozens of rows.
check('it posts ONE summary, not one per lead',
  (AUDIT.match(/await notifyChat\(/g) || []).length, 1);
check('...and caps how many it lists', /slice\(0, 8\)/.test(AUDIT), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
