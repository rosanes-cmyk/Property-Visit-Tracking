/**
 * Every control on the dashboard does what its label says.
 *
 *   node tests/dashboard-controls-work.test.mjs
 *
 * WHY THIS EXISTS. An audit of every clickable thing on the page found ten controls that did nothing or
 * did the opposite of their label, and twenty-seven that misled. They share one shape with the openAction
 * bug fixed alongside them: a dispatcher that SILENTLY DEFAULTS instead of failing, so the screen looks
 * like it worked. None of them could throw, none logged, none showed an error.
 *
 * The fixes are asserted against comment-stripped source, because this project has now had four
 * assertions satisfied by the prose explaining a fix rather than the fix itself.
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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const PAGE_RAW = read('apps-script/Dashboard.html');
const PAGE = strip(PAGE_RAW);

console.log('=== every alert chip applies its own filter ===');
/*
 * ribbon() emits eight data-jump keys; the handler was an if/else chain naming six. 'needs' and 'offers'
 * fell into `else setFilter('all')` — clearing the user's filter instead of applying one.
 */
check('the ribbon passes its key straight to setFilter', /setFilter\(j\|\|'all'\)/.test(PAGE), true);
check('...and no longer names the keys one by one',
  /j==='overdue'\)setFilter\('overdue'\)/.test(PAGE), false);

/*
 * Passing the key through is only half the fix: keep() had no case for 'needs' or 'offers' either, so the
 * filter would have been set and then matched nothing.
 */
check('keep() handles the Need-decision filter', /FILTER==='needs'/.test(PAGE), true);
check('keep() handles the Offers-to-follow-up filter', /FILTER==='offers'/.test(PAGE), true);

console.log('\n=== every filter the code can apply has a chip to show and clear it ===');
/*
 * setFilter lights a chip by matching data-f. A filter with no chip stripped `.on` from ALL chips: the
 * board was filtered, nothing was lit, and the only way back was "All".
 */
const chips = [...new Set((PAGE.match(/data-f="([a-z]+)"/g) || []).map((m) => m.slice(8, -1)))];
const applied = [...new Set((PAGE.match(/FILTER==='([a-z]+)'/g) || []).map((m) => m.slice(10, -1)))];
check('every filter keep() applies has a chip', applied.filter((f) => !chips.includes(f)), []);
check('...and every chip maps to a filter keep() applies',
  chips.filter((f) => f !== 'all' && !applied.includes(f)), []);

console.log('\n=== the page stops throwing away what the user chose ===');
check('the owner dropdown keeps its selection across a refresh',
  /var cur=os\.value;/.test(PAGE) && /if\(cur&&OWNERS\.indexOf\(cur\)>=0\)os\.value=cur;/.test(PAGE), true);
/*
 * onData runs on the 20-second pending poll, so this reset the board to "All owners" with no interaction.
 */
check('...and the rebuild is still done, so a new owner appears', /os\.innerHTML='<option value="">All owners<\/option>'/.test(PAGE), true);

console.log('\n=== a half-saved write is reported, not toasted as success ===');
check('the page reads the warning the server already sent', /res\.warning/.test(PAGE), true);
check('...and holds it on screen longer than a confirmation', /function toast\(m,ms\)/.test(PAGE), true);

const SERVER_FILES = ['apps-script/WebApp.gs', 'apps-script/Code.combined.gs'];
for (const f of SERVER_FILES) {
  const S = strip(read(f));
  const label = path.basename(f);
  console.log(`\n=== ${label}: no refused date is silently replaced with today ===`);
  /*
   * `dateValue_(x) || today_()` is a safe fallback for an EMPTY field and a data bug for a typo: it wrote
   * today's date over what the user meant and still returned ok.
   */
  check(`${label}: no write substitutes today for an unreadable date`,
    /dateValue_\(params\.date\) \|\| today_\(\)/.test(S), false);
  check(`${label}: every refused date is named back to the user`,
    (S.match(/refusedUpd\.push\(/g) || []).length >= 6, true);

  console.log(`=== ${label}: the automation cascade fires on a CHANGE, not on presence ===`);
  /*
   * The edit form posts every field, so `params['Visit Status'] !== undefined` was always true: the
   * Completed cascade overwrote values typed in the same form, and the Current Stage branch below it was
   * unreachable.
   */
  check(`${label}: the old values are captured before the write loop`,
    /var wasVS = String\(R\.get\('Visit Status'\)/.test(S), true);
  check(`${label}: the handler tests a real change`, /var vsChanged = /.test(S), true);
  check(`${label}: ...and so does the stage branch below it`, /else if \(csChanged\)/.test(S), true);
  check(`${label}: presence alone no longer fires it`,
    /if \(params\['Visit Status'\] !== undefined\) runHandler_/.test(S), false);
  check(`${label}: an edit that cascades nothing still syncs the calendar`,
    /else syncVisitCalendar_\(sh, rowNum\)/.test(S), true);

  console.log(`=== ${label}: a new booking's automation is actually written ===`);
  /*
   * RowAccessor_.set only marks a cell dirty; only flush() writes. A bare handler call on a fresh
   * accessor computed Current Stage, Next Action and the due date for every new booking and discarded
   * all three.
   */
  check(`${label}: the new-booking handler goes through runHandler_`,
    /runHandler_\(onVisitStatus_, sh, row\)/.test(S), true);
  check(`${label}: ...not an unflushed accessor`,
    /onVisitStatus_\(new RowAccessor_\(sh, row\)\)/.test(S), false);

  console.log(`=== ${label}: the booking form's fields reach a rescheduled row ===`);
  check(`${label}: a rescheduled booking writes Seller Name`, /'Seller Name', 'Current Stage'/.test(S), true);
  check(`${label}: ...and does not overwrite a stage the user picked`, /var callerPickedStage = /.test(S), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
