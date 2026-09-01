/**
 * Rescheduling on the dashboard must move the calendar event and run the handler properly.
 *
 *   node tests/reschedule-syncs.test.mjs
 *
 * The client: rescheduling a lead from the dashboard "is not working". It was not, in two ways at once,
 * both inside the same three lines of webRescheduleRow_:
 *
 *   THE CALENDAR NEVER MOVED. Nothing in that function called syncVisitCalendar_, and no onEdit fires for
 *   a dashboard write — so a colleague changed the date, the board showed the new date, and Juan's
 *   calendar still held the old slot. There was no path by which the event could follow the row.
 *
 *   THE HANDLER'S WRITES WERE DISCARDED. It called `onVisitStatus_(new RowAccessor_(sh, row))` on an
 *   accessor created inline and never flushed. onVisitStatus_ sets Current Stage, Next Action and Next
 *   Action Due Date on the accessor it is given, so every one of those writes was thrown away — the stage
 *   cascade and the visitor's reminder silently skipped.
 *
 * webAction had it right all along (`runHandler_(onVisitStatus_, ...)` / `syncVisitCalendar_`), and the
 * comment there already warned about exactly this: "One field, three doors, three outcomes."
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

function fnBody(source, name) {
  const from = source.indexOf(`function ${name}`);
  if (from < 0) return '';
  return source.slice(from, source.indexOf('\n}', from));
}

for (const file of ['apps-script/WebApp.gs', 'apps-script/Code.combined.gs']) {
  const src = strip(read(file));
  const body = fnBody(src, 'webRescheduleRow_');

  console.log(`\n=== ${file} ===`);
  check('webRescheduleRow_ exists', body.length > 0, true);

  // The bug, named exactly. An accessor made here and never flushed loses every write the handler makes.
  check('no un-flushed inline accessor is handed to the handler',
    /onVisitStatus_\(new RowAccessor_\(sh, row\)\)/.test(body), false);
  check('the handler goes through runHandler_, which flushes it',
    /runHandler_\(onVisitStatus_, sh, row\)/.test(body), true);

  // A plain date change sends no Visit Status at all — the commonest reschedule there is.
  check('a reschedule with no status change still syncs the calendar',
    /else syncVisitCalendar_\(sh, row\);/.test(body), true);
  check('...and the two are exclusive, so the calendar is not synced twice',
    /if \(params\['Visit Status'\]\) runHandler_\(onVisitStatus_, sh, row\);\s*\n\s*else syncVisitCalendar_\(sh, row\);/.test(body), true);

  // The row itself must be written before either runs, or the handler reads stale values.
  check('the row is flushed before the handler runs',
    body.indexOf('R.flush();') < body.indexOf('runHandler_'), true);

  // Visit Date and Visit Time are the fields a reschedule actually changes.
  check('Visit Date and Visit Time are both reschedulable fields',
    /'Visit Date', 'Visit Time', 'Visit Status'/.test(body), true);
}

console.log('\n=== runHandler_ still does the three things this depends on ===');
const WEB = strip(read('apps-script/WebApp.gs'));
const handler = fnBody(WEB, 'runHandler_');
check('it calls the handler', /handler\(R\);/.test(handler), true);
check('it flushes the accessor', /R\.flush\(\);/.test(handler), true);
check('it syncs the calendar', /syncVisitCalendar_\(sh, rowNum\);/.test(handler), true);
check('...in that order',
  handler.indexOf('handler(R)') < handler.indexOf('R.flush()')
    && handler.indexOf('R.flush()') < handler.indexOf('syncVisitCalendar_'), true);

console.log('\n=== The form path and the edit path now behave the same ===');
/*
 * The whole class of bug: one field, three doors, three outcomes. webAction already routed correctly;
 * the booking form did not. Both must reach the calendar.
 */
const action = fnBody(WEB, 'webAction');
check('webAction routes through runHandler_ too',
  /runHandler_\(onVisitStatus_, sh, rowNum\)/.test(action), true);
check('...and falls back to syncVisitCalendar_ when no status changed',
  /else syncVisitCalendar_\(sh, rowNum\);/.test(action), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
