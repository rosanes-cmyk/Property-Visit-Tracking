/**
 * Calendar: the booked TIME, and no duplicate events.
 *
 *   node tests/calendar-time-and-dedupe.test.mjs
 *
 * Two faults this locks down, both of which produced a confidently wrong calendar without ever
 * reporting an error:
 *
 *   TIME. maybeCreateVisitEvent_ hard-coded 09:00 and never read Visit Time, so a visit booked for
 *   2pm appeared at 9am. The row, the dashboard and the Chat cards all had the right time. Only the
 *   calendar did not, which is the one place the person driving there actually looks.
 *
 *   DUPLICATES. createEvent was called unconditionally, so writing the same lead twice gave ONE row
 *   and TWO events — the row upsert protected the sheet and nothing protected the calendar.
 *
 * Both assertions are made against the comment-stripped body. A previous test in this project passed
 * for months while matching text that existed only in a comment; the code, not the prose about it, is
 * what ships.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/**
 * Remove /* *​/ blocks and whole-line // comments.
 *
 * Deliberately does NOT touch a trailing comment on a line of code: doing so needs to know whether a
 * '//' sits inside a regex literal, and this function's body contains two (/@google\.com$/i and the
 * tag test). Leaving them is safe here because every string asserted below is punctuation-bearing
 * code that cannot occur in English.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function bodyOf(source, fn) {
  const from = source.indexOf(`function ${fn}`);
  if (from < 0) return '';
  return stripComments(source.slice(from, source.indexOf('\n}', from)));
}

const FILES = ['apps-script/WebApp.gs', 'apps-script/Code.combined.gs'];

console.log('=== The booked time reaches the calendar (both shipped files) ===');
for (const file of FILES) {
  const body = bodyOf(read(file), 'maybeCreateVisitEvent_');
  check(`${file}: reads Visit Time through visitStartsAt_`, body.includes('visitStartsAt_(map, day)'), true);
  check(`${file}: 09:00 is only the fallback, after that call`,
    body.indexOf('visitStartsAt_(map, day)') < body.indexOf('setHours(9, 0, 0, 0)'), true);
  check(`${file}: the fallback is guarded by a missing time`,
    /if \(!start\) \{ start = new Date\(day\.getTime\(\)\); start\.setHours\(9, 0, 0, 0\); \}/.test(body), true);
  check(`${file}: 9am is hard-coded exactly once`, (body.match(/setHours\(9, 0, 0, 0\)/g) || []).length, 1);
  // The past-date guard must compare the TIMED start, not a rebuilt midnight/9am one.
  check(`${file}: past-date guard still present and after the time is resolved`,
    body.indexOf('setHours(9, 0, 0, 0)') < body.indexOf('start < midnight'), true);
}

console.log('\n=== An existing event is reused, never duplicated (both shipped files) ===');
for (const file of FILES) {
  const body = bodyOf(read(file), 'maybeCreateVisitEvent_');
  check(`${file}: findVisitEvents_ is consulted`, body.includes('findVisitEvents_(cal, addr, start)'), true);
  check(`${file}: it runs BEFORE createEvent`,
    body.indexOf('findVisitEvents_(cal, addr, start)') < body.indexOf('createEvent'), true);
  check(`${file}: a tagged (cancelled) event is not a reuse candidate`,
    body.includes("!/^\\[[A-Z ]+\\]/.test(String(e.getTitle() || ''))"), true);
  check(`${file}: a reschedule moves the event it found`, body.includes('ev0.setTime(start, end)'), true);
  check(`${file}: createEvent appears exactly once`, (body.match(/createEvent\(/g) || []).length, 1);
}

console.log('\n=== The event ID is written back, so the two producers can see each other ===');
for (const file of FILES) {
  const body = bodyOf(read(file), 'storeEventId_');
  check(`${file}: storeEventId_ exists`, body.length > 0, true);
  check(`${file}: writes only when the live sheet has the column`,
    body.includes("headerIndex_()['Calendar Event ID']") && body.includes('if (!c) return'), true);
  check(`${file}: the column check precedes the write`,
    body.indexOf("headerIndex_()['Calendar Event ID']") < body.indexOf('setValue('), true);
  check(`${file}: stores the bare API id, not Apps Script's suffixed one`,
    body.includes('String(eventId).replace('), true);
  check(`${file}: col() is never used for this column`, body.includes("col('Calendar Event ID')"), false);

  const cal = bodyOf(read(file), 'maybeCreateVisitEvent_');
  check(`${file}: both the reuse and create paths store it`, (cal.match(/storeEventId_\(rowNum, /g) || []).length, 2);
}

console.log('\n=== Calendar Event ID is declared in every column list ===');
check('Config.gs', read('apps-script/Config.gs').includes("'Calendar Event ID',"), true);
check('Code.combined.gs', read('apps-script/Code.combined.gs').includes("'Calendar Event ID',"), true);
check('migrate_legacy_data.py', read('build/migrate_legacy_data.py').includes("'Calendar Event ID',"), true);
// The Node side has always written it; if that ever stops, this column is dead weight.
check('the Node writer still writes it',
  read('twin-visit-logger-sandbox/src/google/sheets.mjs').includes("'Calendar Event ID'"), true);

console.log('\n=== Every caller passes Visit Time and the row ===');
for (const file of FILES) {
  const source = stripComments(read(file));
  const calls = [...source.matchAll(/maybeCreateVisitEvent_\(([\s\S]*?)\);/g)]
    .map((m) => m[1])
    .filter((args) => !args.startsWith('map, addr, rowNum'));   // skip the declaration itself
  check(`${file}: four call sites`, calls.length, 4);
  // A third argument is what lets the event ID be written back to the row.
  check(`${file}: every call passes a row number`,
    calls.every((a) => /,\s*(R\.row|dup\.rowNum|row|dest)\s*$/.test(a.trim())), true);

  /*
   * Visit Time per site, named individually rather than swept with one includes().
   *
   * Two of the four pass a map built on an earlier line (calMap, map), so the field is not in the
   * argument text at all — a blanket check over the arguments reports those as missing and would have
   * been "fixed" by loosening the assertion until it passed. Each site is asserted where its map is
   * actually built.
   */
  check(`${file}: syncVisitCalendar passes the row's time`,
    source.includes("'Visit Date': visitDate, 'Visit Time': R.get('Visit Time')"), true);
  check(`${file}: the upsert path's calMap carries the time`,
    source.includes("'Visit Date': U.get('Visit Date'), 'Visit Time': U.get('Visit Time') }"), true);
  check(`${file}: the new-row path's map carries the time`,
    source.includes("'Visit Time': g('Visit Time', 'visitTime')"), true);
  check(`${file}: restoreFromTrash_ carries the time`,
    source.includes("'Visit Time': row[col('Visit Time') - 1] }, addr, dest)"), true);
  // A reschedule to a new time on the same day has to reach the row, or the event is moved back to it.
  check(`${file}: the upsert writes Visit Time to the row`,
    source.includes("up('Visit Time', g('Visit Time', 'visitTime'))"), true);
}

console.log('\n=== The two files have not drifted ===');
const marker = '/**\n * Remember the event this script just created';
const blockOf = (p) => {
  const s = read(p);
  const a = s.indexOf(marker);
  const tail = "  } catch (e) { return 'error: ' + e; }\n}\n";
  return s.slice(a, s.indexOf(tail, a) + tail.length);
};
check('WebApp.gs and Code.combined.gs are byte-identical here',
  blockOf('apps-script/WebApp.gs') === blockOf('apps-script/Code.combined.gs'), true);

/* ---------------------------------------------------------------------------
 * The arithmetic itself, ported so it is exercised rather than merely grepped.
 * Mirrors timeCell_ / visitStartsAt_ (ChatNotify.gs) and the fallback above.
 * ------------------------------------------------------------------------- */
function timeCell(raw) {
  if (raw instanceof Date) return { h: raw.getHours(), m: raw.getMinutes() };
  if (typeof raw === 'number' && isFinite(raw)) {
    const mins = Math.round((raw - Math.floor(raw)) * 1440);
    if (!mins) return null;
    return { h: Math.floor(mins / 60) % 24, m: mins % 60 };
  }
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return { h: h % 24, m: Number(m[2]) };
}

function startFor(visitDate, visitTime) {
  const day = new Date(visitDate);
  const t = timeCell(visitTime);
  const start = new Date(day.getTime());
  if (t) start.setHours(t.h, t.m, 0, 0);
  else start.setHours(9, 0, 0, 0);
  return { start, timed: !!t };
}

const DAY = '2026-09-02T00:00:00';
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

console.log('\n=== The start time is the one that was booked ===');
check('"2:00 PM" typed by a person', hhmm(startFor(DAY, '2:00 PM').start), '14:00');
check('"9:30 AM"', hhmm(startFor(DAY, '9:30 AM').start), '09:30');
check('"14:00" as 24-hour text', hhmm(startFor(DAY, '14:00').start), '14:00');
check('"12:00 PM" is noon, not midnight', hhmm(startFor(DAY, '12:00 PM').start), '12:00');
check('"12:30 AM" is after midnight', hhmm(startFor(DAY, '12:30 AM').start), '00:30');
// Sheets hands a time-only cell back as a Date on the 1899-12-30 epoch; only the clock matters.
check('a time-only cell from Sheets', hhmm(startFor(DAY, new Date(1899, 11, 30, 15, 45)).start), '15:45');
check('a Sheets day-fraction (0.5 = noon)', hhmm(startFor(DAY, 0.5).start), '12:00');

console.log('\n=== 09:00 only when there is genuinely no time ===');
check('blank', hhmm(startFor(DAY, '').start), '09:00');
check('blank is reported as untimed', startFor(DAY, '').timed, false);
check('null', hhmm(startFor(DAY, null).start), '09:00');
check('unparseable text', hhmm(startFor(DAY, 'afternoon').start), '09:00');
check('a real time IS reported as timed', startFor(DAY, '2:00 PM').timed, true);

console.log('\n=== A 2pm visit no longer lands at 9am ===');
check('the whole point', hhmm(startFor(DAY, '2:00 PM').start) !== '09:00', true);

/* The reuse decision: move only when the found event is actually at a different time. */
const wouldMove = (existingStart, wantedStart) =>
  Math.abs(new Date(existingStart).getTime() - new Date(wantedStart).getTime()) > 60000;

console.log('\n=== Reuse moves the event only when the time really changed ===');
check('same time — left alone', wouldMove('2026-09-02T14:00:00', '2026-09-02T14:00:00'), false);
check('30 seconds of drift — left alone', wouldMove('2026-09-02T14:00:30', '2026-09-02T14:00:00'), false);
check('9am event, 2pm booking — moved', wouldMove('2026-09-02T09:00:00', '2026-09-02T14:00:00'), true);
check('rescheduled to the next day — moved', wouldMove('2026-09-02T14:00:00', '2026-09-03T14:00:00'), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
