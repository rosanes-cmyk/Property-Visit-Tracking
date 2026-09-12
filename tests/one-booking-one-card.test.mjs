/**
 * One booking, one card — whichever part of the system notices it first.
 *
 *   node tests/one-booking-one-card.test.mjs
 *
 * FIVE CARDS FOR ONE BOOKING. The client, with the screenshots to prove it: "the system spaming the of
 * that notif".
 *
 *   Luis Ocon    yesterday 2:06 PM, 2:12 PM, 2:18 PM  (identical, six minutes apart)
 *   Shan Richards           4:55 PM, 5:01 PM
 *   Richard Garcia          4:34 PM, 4:40 PM, 4:46 PM
 *
 * ...and then Luis Ocon again this morning at 9:55 from a DIFFERENT producer, in the newer card format.
 *
 * THE CAUSE, and it is a guard that only covered half the system. Apps Script has marked briefed rows since
 * Tuesday with `briefed` in the note on column A (Automation.gs). It works. The PC never looked at it, and
 * the PC is what posts "Visit booked on the dashboard". Two producers, one booking, one of them blind to
 * the other's bookkeeping — so deploying the Apps Script fix changed nothing the client could see.
 *
 * The six-minute spacing is the giveaway that it was never people editing rows: the board intake fires
 * every two minutes and wins the browser lock roughly every third attempt.
 *
 * So the marker is now read and written from both sides, in the SAME format, and this file holds the two
 * implementations to it — because "they agree" is the entire feature, and an agreement that exists only in
 * my head is what produced five cards.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SHEETS = read('twin-visit-logger-sandbox/src/google/sheets.mjs');
const FILL = read('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs');
const RECHECK = read('twin-visit-logger-sandbox/scripts/recheck-rei.mjs');
const ADDVISIT = read('twin-visit-logger-sandbox/scripts/add-visit-from-rei.mjs');
const AUTOMATION = read('apps-script/Automation.gs');
const COMBINED = read('apps-script/Code.combined.gs');

console.log('=== The two sides read and write the SAME note format ===');
/*
 * Lifted and RUN against the workbook's own strings. Source-matching cannot answer "do these two agree",
 * and that question IS the fix: a Node parser that is merely similar to the Apps Script one would look
 * right in review and re-announce every booking in production.
 */
/*
 * The whole helper block is lifted at once and the functions picked out by NAME, not by slicing between two
 * of them. The first version sliced from noteValue to noteWith, and adding a function between them put an
 * `export` inside the slice and broke every test in this file at once — the lift has to survive the file
 * being edited, which is the only reason it exists.
 */
const HELPERS = SHEETS.slice(SHEETS.indexOf('export function noteValue'),
  SHEETS.indexOf('export async function getRowNote')).replace(/export function/g, 'function');
const lift = (name) => new Function(`${HELPERS}; return ${name};`)();
const noteValue = lift('noteValue');
const noteWith = lift('noteWith');

// The shapes Automation.gs actually leaves behind on column A.
check('reads a lone marker', noteValue('briefed=2026-09-12;', 'briefed'), '2026-09-12');
check('reads one among several', noteValue('cancelAlert=x;briefed=2026-09-12;', 'briefed'), '2026-09-12');
check('reads the first of several', noteValue('briefed=2026-09-12;cancelAlert=x;', 'briefed'), '2026-09-12');
check('an absent marker is empty', noteValue('cancelAlert=x;', 'briefed'), '');
check('an empty note is empty', noteValue('', 'briefed'), '');
check('a null note does not throw', noteValue(null, 'briefed'), '');

check('writes a marker onto an empty note', noteWith('', 'briefed', '2026-09-12'), 'briefed=2026-09-12;');
check('adds without disturbing others',
  noteWith('cancelAlert=x;', 'briefed', '2026-09-12'), 'cancelAlert=x;briefed=2026-09-12;');
check('replaces rather than duplicates',
  noteWith('briefed=2026-09-01;', 'briefed', '2026-09-12'), 'briefed=2026-09-12;');
check('...leaving the neighbours alone',
  noteWith('cancelAlert=x;briefed=2026-09-01;', 'briefed', '2026-09-12'), 'cancelAlert=x;briefed=2026-09-12;');
check('an empty value clears it', noteWith('briefed=2026-09-01;', 'briefed', ''), '');
check('round trip', noteValue(noteWith('', 'briefed', '2026-09-12'), 'briefed'), '2026-09-12');

console.log('\n=== ...which is the workbook\'s format, character for character ===');
/*
 * The Apps Script pair is a one-liner each. Both are held here so a change to either side without the
 * other fails: "they used to agree" is how this bug is reintroduced.
 */
for (const [name, src] of [['Automation.gs', AUTOMATION], ['Code.combined.gs', COMBINED]]) {
  check(`${name} still reads with key=([^;]*)`,
    /getNote = function\(key\)\{[^}]*new RegExp\(key\+'=\(\[\^;\]\*\)'\)/.test(src), true);
  check(`${name} still writes key+'='+val+';'`,
    /setNote = function\(key,val\)\{[^}]*key\+'='\+val\+';'/.test(src), true);
  check(`${name} still keeps it on column A`,
    /getRange\(this\.row,1\)\.(get|set)Note/.test(src), true);
}
// The Node side must use those identical expressions, not an equivalent of its own devising.
check('Node reads with the same expression',
  /new RegExp\(`\$\{key\}=\(\[\^;\]\*\)`\)/.test(SHEETS), true);
check('Node writes with the same expression',
  /new RegExp\(`\$\{key\}=\[\^;\]\*;\?`\)/.test(SHEETS), true);
check('Node reads the note from column A',
  /startColumnIndex: 0,\s*\n\s*endColumnIndex: 1/.test(SHEETS) && /!A\$\{rowNumber\}/.test(SHEETS), true);

console.log('\n=== Both automatic producers check it, and set it only on success ===');
const F = code(FILL);
const R = code(RECHECK);

check('the board intake reads the row note before posting', /const rowNote = briefRow \? await getRowNote\(auth, briefRow\)/.test(F), true);
check('...and says so instead of going silent', /already sent for this booking/.test(FILL), true);
check('...and marks it after posting', /setRowNoteKey\(auth, briefRow, 'briefedFor'/.test(F), true);
check('...only when the post actually succeeded', /if \(posted && booked && briefRow\)/.test(F), true);

check('the re-check reads the row note too', /const rowNote = briefRow \? await getRowNote\(auth, briefRow\)/.test(R), true);
check('...and marks it after posting', /if \(posted && briefRow\) await setRowNoteKey\(auth, briefRow, 'briefedFor'/.test(R), true);
check('...and the re-check still does not import DateTime', /import \{ DateTime \}/.test(R), false);

console.log('\n=== A RE-BOOKING IS A NEW BOOKING, and the first version of this got it wrong ===');
/*
 * The guard shipped storing the date the card was SENT, and refusing while any marker existed. A lead booked
 * for the 12th and then moved to the 19th was therefore silenced for ever, and the only way out was to open
 * the sheet and delete a note from a cell by hand. The client, told to do exactly that: "wht would i do
 * that?" — and then "its sutomate right?". Both fair. A guard that needs hand-clearing is a chore with a bug
 * attached.
 *
 * So the marker records WHICH booking was announced — the visit day — and a different day announces itself.
 * Run, not matched: the whole question is what a given pair of values DOES.
 */
const decide = lift('alreadyAnnounced');

check('same visit day: stays quiet', decide('briefedFor=2026-09-12;', '2026-09-12'), '2026-09-12');
check('MOVED to a new day: announces', decide('briefedFor=2026-09-12;', '2026-09-19'), '');
check('never announced: announces', decide('', '2026-09-12'), '');
check("a marker of 'yes' counts as announced", decide('briefedFor=yes;', '2026-09-12'), 'yes');

/*
 * THE PERMANENT MUTE, and the reason this is a function rather than three lines at the call site.
 *
 * The first PC version wrote `briefed=<the date it SENT on>`. The version after it read a bare `briefed` as
 * "Apps Script announced this booking", stayed quiet, and then never wrote `briefedFor` - so every row the
 * first version had touched was silenced for ever. The client, about real bookings: "that notifications
 * didin fire in those has booked already in the gc".
 *
 * A marker that cannot be read as a day now ANNOUNCES. At most one extra card, after which briefedFor
 * governs the row properly. Silence is never the answer to not understanding something.
 */
check('a send-date marker for a LATER visit announces', decide('briefed=2026-09-12;', '2026-09-19'), '');
check('an unreadable marker announces rather than muting for ever', decide('briefed=yes;', '2026-09-19'), '');
check('...and briefedFor then takes over', decide('briefed=yes;briefedFor=2026-09-19;', '2026-09-19'), '2026-09-19');

/*
 * Apps Script writes a display date. Compared as a DAY, not as a string, or three writers' formats would
 * all read as disagreement.
 */
check("Apps Script's display date, same day: quiet", decide('briefed=Sat, Sep 12, 2026;', '2026-09-12'), 'Sat, Sep 12, 2026');
check('...different day: announces', decide('briefed=Sat, Sep 12, 2026;', '2026-09-19'), '');
check('...and ours still wins when both are present', decide('briefed=Sat, Sep 12, 2026;briefedFor=2026-09-12;', '2026-09-19'), '');
check('no visit day to judge by: treats it as announced', decide('briefed=2026-09-12;', ''), '2026-09-12');

check('the board intake records the VISIT day, not today',
  /setRowNoteKey\(auth, briefRow, 'briefedFor', visitDay \|\| 'yes'\)/.test(F), true);
check('the re-check does the same', /setRowNoteKey\(auth, briefRow, 'briefedFor', visitDay \|\| 'yes'\)/.test(R), true);
check('neither stores the date it happened to send on', /'briefed',\s*\n?\s*DateTime\.now\(\)/.test(F), false);
check('both ask the shared decision, not their own copy of it',
  /alreadyAnnounced\(rowNote, visitDay\)/.test(F) && /alreadyAnnounced\(rowNote, visitDay\)/.test(R), true);

/*
 * add-visit-from-rei is TYPED BY A PERSON, and is deliberately exempt — the same rule send-briefing already
 * follows: somebody asking for a briefing by hand has a reason, and refusing them because a timer sent one
 * hours ago would be maddening. Automatic producers dedupe; people do not get deduped.
 */
check('the hand-run one is NOT gagged by the marker', /getRowNote/.test(code(ADDVISIT)), false);
check('...and still posts its briefing', /notifyChat\(/.test(code(ADDVISIT)), true);

console.log('\n=== A row with no calendar event is not called "booked" ===');
/*
 * Shan Richards went out twice headed "Visit booked on the dashboard" with no date in the card and
 * "❌ Calendar — NOT created, this visit is on nobody's day" eleven lines below it. The team reads the
 * headline. A lead with no usable start is not a booking, and saying so is the difference between somebody
 * chasing the date today and everybody assuming it is handled.
 */
check('the headline depends on the calendar event', /const booked = Boolean\(calendarEventId\)/.test(F), true);
check('a real booking still says booked', /\*Visit booked on the dashboard —/.test(FILL), true);
check('...and one without an event does not', /Added to the dashboard, NOT booked —/.test(FILL), true);
check('...saying plainly that nobody is going yet', /nobody is going yet/.test(FILL), true);
check('...and what to do about it', /Add the date on the board and it will book itself/.test(FILL), true);
/*
 * An incomplete row must NOT be marked briefed: once the date is filled in it becomes a real booking, and
 * that one deserves its announcement. Marking it here would swallow the only card that matters.
 */
check('an unbooked row is never marked as briefed', /posted && booked && briefRow/.test(F), true);

console.log('\n=== ...and the card still CARRIES the briefing ===');
/*
 * "[object Object]" reached the client's Space, on a card headed "Visit booked on the dashboard — Angela
 * Ip" with nothing under it.
 *
 * Changing the headline above deleted the line holding the body, so the call became
 * `notifyChat(headline + { kind: 'ok', ... })` — the OPTIONS object was string-concatenated onto the
 * message and notifyChat received no options at all. Hence the empty card and the ℹ️ where a ✅ belongs.
 *
 * EVERY TEST PASSED. The section above checks the headline five ways and never once checked that the
 * briefing was still in the message — so the only thing the card exists to carry was the only thing
 * nothing asserted. A test suite that watches the wrapper and not the contents is how a one-line edit
 * ships an empty notification.
 */
const call = FILL.slice(FILL.indexOf('const posted = await notifyChat('), FILL.indexOf('Chat briefing ${posted'));
check('the message includes the fenced briefing', /\$\{fenced\}/.test(call), true);
check('...and the DONE FOR YOU block', /\$\{done\}/.test(call), true);
check('...and the headline', /\$\{headline\}/.test(call), true);
/*
 * The options object must be the SECOND argument, never part of the first. That is the exact shape of the
 * fault, so it is asserted as a shape: a comma has to separate the message from the options.
 */
check('the options are a separate argument, not concatenated',
  /`,\s*\n(\s*\/\/[^\n]*\n)*\s*\{ kind: 'ok', keepContactDetails: true, requested: true \}/.test(call), true);
check('nothing is concatenated onto an object literal', /\+\s*\n(\s*\/\/[^\n]*\n)*\s*\{ kind:/.test(FILL), false);

console.log('\n=== One producer covers every door: --unbriefed ===');
/*
 * A booking typed on the DASHBOARD is handled by Apps Script, which creates the event and posts a compact
 * card with three buttons and nothing to paste into the visit group. The client, pointing at one: "THISSSSS".
 *
 * The pasteable block is built on the PC, from the calendar event. Porting that builder into Apps Script
 * would make a second copy of it, and this project already has the scar from two builders drifting. So one
 * producer asks a question no door can dodge: is this visit booked, still to come, and has nobody sent its
 * briefing? That covers the dashboard, the Intake Inbox, a booking email, a parked row and REI alike.
 */
const SEND = read('twin-visit-logger-sandbox/scripts/send-briefing.mjs');
const S = code(SEND);
check('the mode exists', /const UNBRIEFED = args\.includes\('--unbriefed'\)/.test(S), true);
check('...and counts as asking for something', /!NEEDLE && !TODAY && !TOMORROW && !UNBRIEFED/.test(S), true);
// All three conditions matter: see the comment in the script for what each one is guarding against.
check('it requires a calendar event', /text\(r\['Calendar Event ID'\]\)/.test(S), true);
check('...and refuses visits already in the past', /day >= todayKey/.test(S), true);
check('...and asks the shared marker, so producers cannot double-post',
  /alreadyAnnounced\(note, dayKeyFromCell\(r\['Visit Date'\]\)\)/.test(S), true);
check('it marks the row after sending, or it would resend for ever',
  /setRowNoteKey\(auth, row\.__rowNumber, 'briefedFor', day\)/.test(S), true);
check('...with the VISIT day', /const day = dayKeyFromCell\(row\['Visit Date'\]\)/.test(S), true);
check('nothing to send says so and exits cleanly',
  /has already been briefed\. Nothing to send/.test(SEND) && /process\.exit\(0\)/.test(S), true);
/*
 * The local briefed.json stays as a SECOND net. It is keyed by day, so even if the row marker were wrong
 * the worst case is one card per lead per day rather than one every two minutes. Two independent guards,
 * because this producer runs on the two-minute timer.
 */
check('the per-day file is still consulted', /if \(!FORCE && already\[sentKey\]\)/.test(S), true);
check('the two-minute job runs it', /send-briefing\.mjs --unbriefed/.test(read('twin-visit-logger-sandbox/scripts/fill-pending.cmd')), true);

console.log('\n=== Reading the marker can never cost a booking ===');
/*
 * Fail OPEN. The cost of an unreadable note is one duplicate card; the cost of treating a failed read as
 * "already told them" is a booking the team never hears about. This project has quite enough silent
 * successes already.
 */
check('a failed note read returns empty rather than throwing',
  /export async function getRowNote[\s\S]{0,700}catch \{\s*\n\s*return '';/.test(SHEETS), true);
check('a failed note write returns false rather than throwing',
  /export async function setRowNoteKey[\s\S]{0,1200}catch \{\s*\n\s*return false;/.test(SHEETS), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
