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
const noteValue = new Function(
  SHEETS.slice(SHEETS.indexOf('export function noteValue'), SHEETS.indexOf('export function noteWith'))
    .replace('export function', 'function') + '; return noteValue;'
)();
const noteWith = new Function(
  SHEETS.slice(SHEETS.indexOf('export function noteWith'), SHEETS.indexOf('/**\n * The note on column A'))
    .replace('export function', 'function') + '; return noteWith;'
)();

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

check('the board intake reads the marker before posting', /noteValue\(await getRowNote\(auth, briefRow\), 'briefed'\)/.test(F), true);
check('...and says so instead of going silent', /already sent for this booking on/.test(FILL), true);
check('...and sets it after posting', /setRowNoteKey\(auth, briefRow, 'briefed'/.test(F), true);
check('...only when the post actually succeeded', /if \(posted && booked && briefRow\)/.test(F), true);

check('the re-check reads the marker too', /noteValue\(await getRowNote\(auth, briefRow\), 'briefed'\)/.test(R), true);
check('...and sets it after posting', /if \(posted && briefRow\) await setRowNoteKey\(auth, briefRow, 'briefed'/.test(R), true);
check('...using its own date helper, not luxon it does not import',
  /setRowNoteKey\(auth, briefRow, 'briefed', dayKeyOf\(new Date\(\)\)\)/.test(R), true);
check('...and the re-check still does not import DateTime', /import \{ DateTime \}/.test(R), false);

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
