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
import { latestReiNote, latestReiNoteDate, noteDateKey, contactResultReplaceable }
  from '../twin-visit-logger-sandbox/src/rei/notes.mjs';
import { reiFieldsFromScrape, diffFromRei } from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';
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

console.log('\n=== The right conversation and the WRONG silence ===');
/*
 * The 3pm card told the client "Amelia Middel · $930,000 · sent date not recorded · no contact for 4 day(s)"
 * on a day REI held an email update AND a call summary from that same morning. "No contact for 4 days" was
 * simply false, and falsely reassuring in a way that changes behaviour: it reads as a lead going cold when
 * somebody had spoken to her hours earlier.
 *
 * The count comes from the sheet's Days Since Last Activity, computed from Last Contact Date — which
 * nothing was filling from REI. Syncing the note TEXT without its DATE left exactly that gap.
 */
check("the newest note's date is returned", latestReiNoteDate(AMELIA), '08/05/2026');
check('...as MM/DD/YYYY, the format the sheet writes', /^\d{2}\/\d{2}\/\d{4}$/.test(latestReiNoteDate(AMELIA)), true);
// An explicit `now`, because "newest" and "future" are relative and this must not start failing with time.
check('the newest wins over an older block',
  latestReiNoteDate(['Jul 1, 2026 old', 'Aug 4, 2026 newer', 'Aug 2, 2026 middle'],
    { now: new Date('2026-08-05T17:00:00-07:00') }), '08/04/2026');
check('undated notes yield nothing rather than today', latestReiNoteDate(['no date here']), '');
check('empty is safe', latestReiNoteDate([]), '');
check('null is safe', latestReiNoteDate(null), '');
check('a single-digit day is padded', latestReiNoteDate(['Aug 5, 2026']), '08/05/2026');

console.log('\n--- a FUTURE date is never a contact date ---');
/*
 * Caught by this suite before it shipped. Rob Walker's gift note reads "Deliver on 08/06/2026", and taking
 * the newest date in the text put a delivery STILL TO HAPPEN into Last Contact Date. Due dates, follow-up
 * dates and delivery dates are all ahead of today and none of them is a conversation.
 */
const AT = { now: new Date('2026-08-05T17:00:00-07:00') };
const ROB_GIFT = ['Aug 5, 2026 | 4:36PM Place an order for Rob Walker - Order #104240205 '
  + 'Gourmet Get-Together Gift Basket:$69.99 Deliver on 08/06/2026 Order Total: $96.77'];
check("Rob's delivery date is skipped for his note stamp", latestReiNoteDate(ROB_GIFT, AT), '08/05/2026');
check('a note with ONLY a future date yields nothing',
  latestReiNoteDate(['Deliver on 09/30/2026'], AT), '');
check('today itself is allowed', latestReiNoteDate(['Aug 5, 2026 spoke to her'], AT), '08/05/2026');
check('tomorrow is not', latestReiNoteDate(['Aug 6, 2026 will call'], AT), '');
/*
 * The past date must survive being in the SAME block as a future one. noteDateKey returns the newest date in
 * a block, so a block holding both "Aug 5" and "Deliver on 08/06" would return the 6th, be rejected as
 * future, and take the 5th down with it.
 */
check('a past date in the same block as a future one still counts',
  latestReiNoteDate(['Aug 1, 2026 met the agent · follow up 12/25/2026'], AT), '08/01/2026');

console.log('\n--- and it only ever moves FORWARD ---');
/*
 * An older REI note must never undo a more recent contact somebody logged by hand. That would make a live
 * lead look neglected and push it up the work queue for no reason: a later date is new information, an
 * earlier one is just REI being behind.
 */
const AMELIA_ROW = {
  'Seller Name': 'Amelia Middel', 'Property Address': '460 5th Avenue', 'REI BlackBook Link': 'x',
  'Current Stage': 'Offer Sent', 'Visit Status': 'Scheduled', 'Last Contact Date': '2026-07-29',
  'Last Contact Result': ''
};
const FIELDS = reiFieldsFromScrape({ notes: AMELIA });
const dateChange = () => diffFromRei(AMELIA_ROW, FIELDS).find((c) => c.field === 'Last Contact Date');
check('a stale sheet date is advanced', dateChange()?.to, '08/05/2026');
check('...from the old value', dateChange()?.from, '2026-07-29');
check('a NEWER sheet date is kept',
  diffFromRei({ ...AMELIA_ROW, 'Last Contact Date': '2026-08-09' }, FIELDS)
    .some((c) => c.field === 'Last Contact Date'), false);
check('the same date is not rewritten every run',
  diffFromRei({ ...AMELIA_ROW, 'Last Contact Date': '08/05/2026' }, FIELDS)
    .some((c) => c.field === 'Last Contact Date'), false);
// A blank Last Contact Date is filled, since nobody chose blank.
check('a blank date is filled',
  diffFromRei({ ...AMELIA_ROW, 'Last Contact Date': '' }, FIELDS)
    .find((c) => c.field === 'Last Contact Date')?.to, '08/05/2026');
// Both formats compare correctly: the sheet returns ISO, the automation writes US.
check('an ISO sheet value compares against a US one without shifting',
  diffFromRei({ ...AMELIA_ROW, 'Last Contact Date': '2026-08-05' }, FIELDS)
    .some((c) => c.field === 'Last Contact Date'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
