/**
 * The date a colleague typed on the board must reach the calendar.
 *
 *   node tests/typed-visit-date.test.mjs
 *
 * fill-pending-rei.mjs printed this, on a live run, about a visit booked for the next day:
 *
 *   keeping the date typed on the board: 08/30/2026 2:00 PM
 *   FAILED on this row: Calendar event was not created because appointmentStartIso is invalid.
 *
 * It said it was keeping the date and did not keep it. appointmentStartIso came only from REI, and the one
 * line that touched it afterwards was
 *
 *   if (typedDate) visit.appointmentStartIso = visit.appointmentStartIso || '';
 *
 * an assignment to itself. So for the exact case this script exists to serve — a booking typed in BEFORE
 * REI knows about it — the start was always empty, the event was never created, and the row went back on
 * the board to fail identically on the next run, and the next.
 *
 * The client watched two bookings sit in BEING ADDED for six hours, one of them the following day's, while
 * the log told them the date was being kept.
 *
 * WHAT THIS TEST DOES NOT DO: exercise the parser. luxon is not resolvable outside the sandbox's
 * node_modules (tests/whatsapp-note.test.mjs records the same limitation), and porting a lookalike
 * DateTime.fromFormat into the test would prove that the copy works, not that the script does — which is
 * worse than not testing it, because it reads like coverage. What is pinned instead is the wiring, which
 * is where the bug actually was, and the format lists, so nobody trims them back to the single format that
 * silently broke the morning briefing for weeks.
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

const SRC = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs'), 'utf8');
// Comments stripped: this project has four separate cases of a test passing on text that existed only in
// a comment about the code, rather than in the code.
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

console.log('=== The typed date is carried onto the visit ===');
check('typedStart exists', /function typedStart\(/.test(code), true);
check('...it is called when REI has no appointment of its own',
  /if \(!visit\.appointmentStartIso && typedDate\) \{/.test(code), true);
check('...and its result is actually assigned', /visit\.appointmentStartIso = typed;/.test(code), true);

console.log('\n=== The no-op that caused this must never come back ===');
check('no self-assignment of appointmentStartIso',
  /appointmentStartIso = visit\.appointmentStartIso \|\| ''/.test(code), false);
check('no self-assignment in any form',
  /(\w+)\.appointmentStartIso = \1\.appointmentStartIso\b/.test(code), false);

console.log('\n=== REI still wins where REI has a date ===');
// This is a FALLBACK. A reschedule made in REI must not be overwritten by what somebody typed days earlier.
check('the typed date is only used when the REI one is empty',
  /!visit\.appointmentStartIso && typedDate/.test(code), true);
check('...and REI is what seeds the field in the first place',
  code.indexOf('appointmentStartIso: scraped.appointmentStartIso')
    < code.indexOf('!visit.appointmentStartIso && typedDate'), true);

console.log('\n=== Unreadable input is reported, never silently skipped ===');
check('an unreadable date says so on screen', /could not read the typed date/.test(code), true);
check('a missing time is announced, not hidden', /no time was typed/.test(code), true);

console.log('\n=== The accepted formats stay broad ===');
/*
 * Sheets hands back the DISPLAY string, so the shape depends on how that column happens to be formatted:
 * '08/30/2026' and '2026-08-30' are both real in this workbook. The morning briefing accepted exactly one
 * format and therefore posted nothing, silently, for weeks. That is the mistake being guarded here.
 */
const dateFormats = (code.match(/const TYPED_DATE_FORMATS = \[(.*?)\];/s) || [, ''])[1];
const timeFormats = (code.match(/const TYPED_TIME_FORMATS = \[(.*?)\];/s) || [, ''])[1];
for (const fmt of ['M/d/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'M/d/yy']) {
  check(`date format ${fmt} is accepted`, dateFormats.includes(`'${fmt}'`), true);
}
for (const fmt of ['h:mm a', 'H:mm']) {
  check(`time format ${fmt} is accepted`, timeFormats.includes(`'${fmt}'`), true);
}
check('several date formats, not one', (dateFormats.match(/'/g) || []).length / 2 >= 5, true);

console.log('\n=== 9am only when no time was typed, and never for an unreadable one ===');
// Guessing 9am on a time that could not be READ would put a visit on the calendar at an hour nobody chose
// — the exact fault just fixed on the workbook side. A blank time is a different thing from a broken one.
check('the 9am default is on the no-time path', /let hour = 9;/.test(code), true);
check('an unreadable time returns empty rather than defaulting',
  /if \(!clock\) return '';/.test(code), true);
check('the zone is the configured one, not the machine default',
  /zone = config\.calendarTimezone/.test(code), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
