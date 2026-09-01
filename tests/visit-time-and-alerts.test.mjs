/**
 * Two faults found on one live booking, plus the copy helper that installed an old file over a good one.
 *
 *   node tests/visit-time-and-alerts.test.mjs
 *
 * 1. VISIT TIME WRITTEN AS A DATE. Sheets stores a time-only value on its 1899-12-30 epoch, so a Date
 *    written into a date-formatted column displays "12/30/1899" with the clock nowhere on screen. The
 *    office PC reads DISPLAY values, so what reached it was literally "12/30/1899" — no time in it at all.
 *    It could not build an appointment, the calendar event was refused, and the whole row failed, for a
 *    booking whose address REI had answered perfectly.
 *
 * 2. A CALENDAR FAILURE THREW THE ROW AWAY. That refusal propagated to the per-row catch, so the address,
 *    the notes and the REI link — all successfully read — were discarded, and the row went back on the
 *    board to fail the same way for ever.
 *
 * 3. THE NEW-BOOKING ALERT WENT SILENT ON A REUSED ID. Property IDs are reissued when a row is deleted, so
 *    a genuinely new booking inheriting an old ID was treated as already seen and never announced.
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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const WEB = read('apps-script/WebApp.gs');
const CHAT = read('apps-script/ChatNotify.gs');
const COMBINED = read('apps-script/Code.combined.gs');
const FILL = read('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs');
const COPY = read('twin-visit-logger-sandbox/scripts/CopyUpdates.cmd');

console.log('=== Visit Time is written as something the sheet shows as a time ===');
for (const [label, src] of [['WebApp.gs', strip(WEB)], ['Code.combined.gs', strip(COMBINED)]]) {
  check(`${label}: timeValue_ exists`, /function timeValue_\(v\) \{/.test(src), true);
  // All four write sites, named individually: a blanket count would pass while one path still wrote a Date.
  check(`${label}: the booking form uses it`,
    /if \(h === 'Visit Time'\) R\.set\(h, timeValue_\(params\[h\]\)\);/.test(src), true);
  check(`${label}: the reschedule uses it`,
    /h === 'Visit Time' \? timeValue_\(params\[h\]\)/.test(src), true);
  check(`${label}: the intake upsert uses it`,
    /if \(h === 'Visit Time'\) U\.set\(h, timeValue_\(v\)\);/.test(src), true);
  check(`${label}: the intake create uses it`,
    /if \(h === 'Visit Time'\) R\.set\(h, timeValue_\(v\)\);/.test(src), true);
  // 'Visit Time' contains no 'Date', so it must be checked BEFORE the Date branch or it never matches.
  check(`${label}: the Visit Time branch comes before the Date branch`,
    src.indexOf("h === 'Visit Time'") < src.indexOf("else if (h.indexOf('Date') >= 0)"), true);
}
// An unreadable value is passed through, not blanked: it is still somebody's data.
check('an unparseable time is kept, not discarded', /return v;\n\}/.test(strip(WEB)), true);
check('timeValue_ cannot throw out', /catch \(e\) \{ \/\* fall through to the raw value \*\/ \}/.test(WEB), true);

console.log('\n=== A calendar failure no longer loses the row ===');
const fill = strip(FILL);
check('syncCalendarEvent is wrapped', /try \{\s*\n\s*calendarEventId = await syncCalendarEvent\(/.test(fill), true);
check('...and the run carries on to write the row',
  fill.indexOf('calendarProblem = String(error.message') < fill.indexOf('const written = await upsertVisit('), true);
check('the reason is written ONTO the row, not just logged',
  /noteParkReason\(sheets, headers, row,\s*\n\s*`Filled in from REI, but no calendar event/.test(FILL), true);
check('the row is no longer counted as stuck for a calendar failure',
  /catch \(error\) \{\s*\n\s*calendarProblem = String/.test(fill), true);

console.log('\n=== The new-booking alert survives a reissued Property ID ===');
for (const [label, src] of [['ChatNotify.gs', strip(CHAT)], ['Code.combined.gs', strip(COMBINED)]]) {
  check(`${label}: the key carries the address as well as the ID`,
    /var key = id \+ '\|' \+ String\(rec\['Property Address'\] \|\| ''\)/.test(src), true);
  check(`${label}: the seen-check uses that key`, /if \(seen\[key\]\) return;/.test(src), true);
  check(`${label}: and the stored list does too`, /ids\.push\(key\);/.test(src), true);
  /*
   * THE DANGEROUS PART. Old stored keys are bare IDs; new ones contain '|'. Without a re-seed the first run
   * after this change matches nothing, decides all four hundred rows are new bookings, and posts a card for
   * every one of them into the team's Space — irreversibly.
   */
  check(`${label}: a stored list in the OLD format triggers a re-seed`,
    /var isReseed = !isFirstRun && ids\.length > 0 && String\(stored \|\| ''\)\.indexOf\('\|'\) < 0;/.test(src), true);
  check(`${label}: ...and a re-seed posts nothing`, /if \(isFirstRun \|\| isReseed\) \{/.test(src), true);
  check(`${label}: ...and says so in the log`, /re-seeded \(key format changed\)/.test(src), true);
}

console.log('\n=== CopyUpdates picks the file that ARRIVED last ===');
/*
 * A download keeps the timestamp of the file it came from, so LastWriteTime is when it was written, not
 * when it landed. Sorting by it installed a 6 August copy of rei-login.mjs over the correct one saved
 * minutes earlier — and reported success doing it.
 */
check('sorted by CreationTime', /Sort-Object CreationTime -Descending/.test(COPY), true);
check('LastWriteTime is not used for the choice', /Sort-Object LastWriteTime/.test(COPY), false);
check('and the time it reports is the one it sorted by', /\$src\.CreationTime\.ToString/.test(COPY), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
