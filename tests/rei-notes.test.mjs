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
import { latestReiNote, latestReiNoteDate, noteDateKey, contactResultReplaceable, stripNoteChrome }
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
/*
 * contactResultReplaceable is no longer CONSULTED, and that is the client's decision: "all of the new update on
 * that lead should be included, will automatic update in the dashboard."
 *
 * The guard protected the wrong thing. Its logic was "a person typed this, so leave it" — but REI's latest note
 * is also written by this team, in REI, so both sides were human and the OLDER one was winning. Amelia's row
 * carried "Auto-logged from REI task email" from the day it was created while REI held that morning's call
 * summary and an email update confirming the $930,000 terms.
 *
 * The predicate stays exported and tested above, because it is the record of what the rule was and the
 * distinction it drew is still a real one. Nothing calls it now.
 */
/*
 * Matched on the list ENTRY rather than on the closing bracket: 'Blocker' was appended to REI_WINS afterwards
 * for the Follow-Up Reason, and an assertion anchored to whatever happens to be last in a list breaks every
 * time the list grows.
 */
check('Last Contact Result is a REI-wins field',
  /'Next Action', 'Last Contact Result',/.test(RECHECK), true);
check('...so the guard is no longer consulted',
  /contactResultReplaceable\(row\['Last Contact Result'\]\)/.test(RECHECK), false);
/*
 * Identical text must still produce no change, or every run rewrites the same cell — which spends a Sheets
 * write, logs a change that did not happen, and makes the audit trail unreadable. sameFieldValue does it now.
 */
check('an identical note is not rewritten every run',
  /if \(sameFieldValue\(field, from, to\)\) continue;/.test(RECHECK), true);

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

console.log("\n=== REI's own interface furniture is not a contact result ===");
/*
 * Rob Walker's gift note reached the tracker ending:
 *
 *   ...arrived in good shape ...Show MoreAug 06, 2026Theavil Marie
 *
 * I read that as a truncation and it was not one. The client's screenshot of the same note, expanded, has
 * all seven bullets — every one of them already in the cell. "...Show More" is the expander's own label and
 * "Aug 06, 2026Theavil Marie" is the byline REI prints under it. Nothing was lost; two pieces of page
 * decoration were gained, and in a spreadsheet cell they read as if somebody had said them.
 */
const ROB = 'REI BlackBook Note — Gift Basket Delivered (Order #104240205) Note updated: Aug 6, 2026 — 4:36 PM PT '
  + 'Order # 104240205 — Gourmet Get-Together Gift Basket (SendFlowers) Delivery confirmation email received 4:31 PM PT '
  + 'Received by: Rob Walker Order addressed to Juan on the SendFlowers account '
  + 'Tracking page had not updated — email confirmed ahead of it '
  + 'Next step: confirm with recipient that it arrived in good shape ...Show MoreAug 06, 2026Theavil Marie';
const ROB_CLEAN = latestReiNote(ROB);
check("Rob's note ends on his own words", /good shape$/.test(ROB_CLEAN), true);
check('...with no expander label', /show\s*(more|less)/i.test(ROB_CLEAN), false);
check('...and no byline', /Theavil Marie/.test(ROB_CLEAN), false);
/* Every one of the seven bullets survives. Stripping decoration must not cost a single fact. */
for (const fact of ['Order # 104240205', 'Gourmet Get-Together Gift Basket', 'Delivery confirmation email received 4:31 PM PT',
  'Received by: Rob Walker', 'Order addressed to Juan on the SendFlowers account',
  'Tracking page had not updated', 'Next step: confirm with recipient']) {
  check(`"${fact.slice(0, 34)}" is kept`, ROB_CLEAN.includes(fact), true);
}

/* "Show Less" is the same control after somebody clicked it, and appears on Marlene's note. */
check('Show Less goes too', stripNoteChrome('Basket delivered Show Less'), 'Basket delivered');
check('...and the ellipsis form', stripNoteChrome('Basket delivered ...Show More'), 'Basket delivered');
check('a single-dot ellipsis is not one', stripNoteChrome('Delivered .Show More'), 'Delivered .');
/*
 * The byline is stripped only at the END. A date and a name mid-note is content — "spoke to Aug 6, 2026
 * about..." is contrived, but "Aug 5, 2026 Juan Diaz called" opening a note is not, and losing it would
 * lose who did what.
 */
check('a byline mid-note is left alone',
  stripNoteChrome('Aug 05, 2026Juan Diaz called the seller and left a message'),
  'Aug 05, 2026Juan Diaz called the seller and left a message');
/* Nothing recognised, nothing touched. */
check('an ordinary note is returned unchanged',
  stripNoteChrome('Seller wants 500k, will not budge.'), 'Seller wants 500k, will not budge.');
check('a blank stays blank', stripNoteChrome(''), '');
check('null does not throw', stripNoteChrome(null), '');
/*
 * Stripped AFTER ranking, so a note whose only date is its byline is still placed in time. Removing the
 * byline first would score it undated and hand the cell to an older note.
 */
check('a note dated only by its byline still outranks an older one',
  latestReiNote(['Called seller, no answer. Jul 01, 2026 Cherry Ann',
    'Seller confirmed the walkthrough. Aug 06, 2026 Theavil Marie'].join('\n\n')),
  'Seller confirmed the walkthrough.');
/*
 * A byline REI has glued straight onto the name — "2026Theavil" — scores nothing, because the date pattern
 * needs a word boundary after the year and there is none between "6" and "T". Recorded as the limitation it
 * is rather than left to be discovered: a note whose ONLY date is a glued byline ranks as undated, and falls
 * back to page order. Every note seen so far also carries a date in its body, which is why it has not bitten.
 */
check('a byline glued to the name is not read as a date',
  noteDateKey('Seller confirmed the walkthrough. Aug 06, 2026Theavil Marie'), 0);
check('...and the same byline with a space is', 
  noteDateKey('Seller confirmed the walkthrough. Aug 06, 2026 Theavil Marie'), 20260806);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
