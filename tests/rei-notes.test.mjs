/**
 * Getting REI's notes onto the board.
 *
 *   node tests/rei-notes.test.mjs
 *
 * The client: "whatever happen in the rei notes and all will go to the dashboard right and add it there?"
 *
 * It did not. REI's notes were read only to spot a cancellation or a dead-lead tag, and the text itself was
 * never written anywhere. So Amelia Middel's card read
 *
 *     "Auto-logged from REI task email · source: MLS/ Redfin · REI stage: 2 Follow Up"
 *
 * — the line written the day her row was created — while REI held that morning's call summary and an email
 * update confirming the $930,000 terms had been sent and acknowledged.
 */
import { latestReiNote, noteDateKey, contactResultReplaceable }
  from '../twin-visit-logger-sandbox/src/rei/notes.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* Verbatim from rei-fields.mjs against contacts/20525007. */
const AMELIA = [
  'ACTIVE deal — 460 5th Ave, Redwood City 94063. Juan met the listing agent Aug 1; Draeger\'s gift basket delivered Jul 31. Relationship-building in progress.',
  'The following files are uploaded: 1. Offer Summary 2. Buyer Indemnification Agreement 3. Repairs and Post-Closing Work Addendum 4. Proof of Funds — Kiavi',
  'EMAIL UPDATE – August 5, 2026 ++ Contact Result: Amelia Middel acknowledged receipt of the complete offer terms for 460 5th Avenue, Redwood City.',
  'CALL SUMMARY – August 4, 2026 ++ Contact Result: Voicemail (outbound by CHERRY, ~71s) — no live pickup, message left.'
];

console.log('=== The newest note wins ===');
check('the Aug 5 email update is chosen over the Aug 4 call',
  /EMAIL UPDATE – August 5, 2026/.test(latestReiNote(AMELIA)), true);
check('...not the undated main Notes block', /ACTIVE deal/.test(latestReiNote(AMELIA)), false);
/*
 * The file checklist is filtered out even though it sits above the dated blocks. It is a document list, not
 * a contact result, and putting it in Last Contact Result would push out the call summary that matters.
 */
check('the uploaded-files checklist is never chosen',
  /following files are uploaded/.test(latestReiNote(AMELIA)), false);

console.log('\n--- the date forms this client actually uses ---');
check('"August 5, 2026"', noteDateKey('EMAIL UPDATE – August 5, 2026 ++ Contact Result'), 20260805);
check('"2026-05-12:"', noteDateKey('2026-05-12: High motivation for fast cash sale'), 20260512);
check('"4/2/2026 -"', noteDateKey('4/2/2026 - Appointment canceled due to a double shift'), 20260402);
check('abbreviated months', noteDateKey('Aug 1, 2026 spoke to the agent'), 20260801);
check('the NEWEST date in one block wins',
  noteDateKey('booked Apr 2, 2026 · rescheduled August 5, 2026'), 20260805);
check('a note with no date scores 0', noteDateKey('spoke to her, wants 950k'), 0);
check('null is safe', noteDateKey(null), 0);
// A bare year or a stray number must not read as a date.
check('"2026" alone is not a date', noteDateKey('asking 2026 per sqft'), 0);

console.log('\n=== Choosing when nothing is dated ===');
check('an undated set falls back to page order',
  latestReiNote(['first block', 'second block']), 'first block');
check('a tie keeps the earlier block, so the choice is stable run to run',
  latestReiNote(['Aug 5, 2026 first', 'Aug 5, 2026 second']), 'Aug 5, 2026 first');
check('no notes at all yields nothing', latestReiNote([]), '');
check('empty string yields nothing', latestReiNote(''), '');
check('null yields nothing', latestReiNote(null), '');
check('a string is split on blank lines', latestReiNote('one\n\nAug 9, 2026 two'), 'Aug 9, 2026 two');
check('whitespace-only blocks are dropped', latestReiNote(['   ', 'real note']), 'real note');

console.log('\n=== Clipping, because these are call transcripts ===');
const long = `August 5, 2026 ${'x'.repeat(900)}`;
check('a long note is clipped', latestReiNote(long).length, 500);
check('...and marked as clipped', latestReiNote(long).endsWith('…'), true);
check('a short note is untouched', latestReiNote('August 5, 2026 short'), 'August 5, 2026 short');
check('the limit is adjustable', latestReiNote(long, { maxLength: 50 }).length, 50);
// Newlines inside a block are flattened: a dashboard cell shows one line.
check('newlines within a block are flattened',
  latestReiNote(['Aug 5, 2026 line one\nline two']), 'Aug 5, 2026 line one line two');

console.log('\n=== It goes to Last Contact Result, never Visit Notes ===');
const RECHECK = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/recheck.mjs', import.meta.url), 'utf8');
check("it writes the column whose purpose is the latest contact result",
  /out\['Last Contact Result'\] = note;/.test(RECHECK), true);
/*
 * Visit Notes is what somebody wrote after standing in the property. REI has no version of that, and
 * overwriting it would destroy the one field the automation can never reconstruct.
 */
check('Visit Notes is still never written', /out\['Visit Notes'\]/.test(RECHECK), false);

console.log('\n--- and only over a blank or our own intake line ---');
check('our own intake line may be replaced',
  contactResultReplaceable('Auto-logged from REI task email · source: MLS/ Redfin · REI stage: 2 Follow Up'), true);
check('a blank may be filled', contactResultReplaceable(''), true);
// The refusal: somebody typed this.
check('"Spoke to her myself, wants 950k" is NOT replaceable',
  contactResultReplaceable('Spoke to her myself, wants 950k'), false);
check('a note merely mentioning REI is not our line',
  contactResultReplaceable('Checked REI task email, nothing new'), false);
check('the guard is applied in diffFromRei',
  /contactResultReplaceable\(row\['Last Contact Result'\]\)/.test(RECHECK), true);
check('...and an identical note is not rewritten every run',
  /noteFromRei !== text\(row\['Last Contact Result'\]\)/.test(RECHECK), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
