/**
 * The row action buttons actually do something.
 *
 *   node tests/dashboard-actions-fire.test.mjs
 *
 * WHY THIS EXISTS. Every stage-action button and every overflow-menu item on the dashboard was dead, and
 * had been from the start. `openAction` looked the record up by Property ID:
 *
 *     RECS.filter(function(x){ return x.id === id; })
 *
 * while all three places that render a button emit the ROW NUMBER:
 *
 *     data-id="<r.rowNum>"
 *
 * A row number is never equal to a 'TVL-0001' Property ID, so the filter returned nothing, `if(!r)return`
 * fired, and the click produced no modal, no toast and no error. Nothing on screen said so. The menu itself
 * opened correctly — openRowMenu already matched on rowNum — which is exactly why it looked like it worked.
 *
 * Property ID would not have been a fix either: it is blank on most imported rows, so emitting that instead
 * swaps one dead path for another. Row number is the right key, and it is what the SERVER already prefers:
 * findRowById_ (WebApp.gs:216-227) accepts a numeric row before falling back to a Property ID scan.
 *
 * The second half of this file guards what unblocking those buttons exposed. Two of the actions they open
 * still wrote hand-typed dates straight through `new Date(...)`, while the comment directly beneath them
 * claimed 'dateValue_ throughout'. They had never run in production, because no modal had ever opened.
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
/*
 * Comment-stripped, because this project has now had FOUR assertions satisfied by the prose explaining a
 * fix rather than the fix. The comment above openAction names the old broken expression on purpose.
 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = strip(read('apps-script/Dashboard.html'));
const SERVER = strip(read('apps-script/WebApp.gs'));

console.log('=== a clicked button finds its record ===');
/*
 * All three lookups must agree, because all three are reached from the same data-id attribute:
 * openDetail (the full record), openRowMenu (the overflow menu) and openAction (the thing that saves).
 */
const lookups = PAGE.match(/String\(x\.rowNum\)===String\(id\)/g) || [];
check('every record lookup matches on row number', lookups.length >= 3, true);
check('...and none of them matches on Property ID', /RECS\.filter\(function\(x\)\{return x\.id===id;\}\)/.test(PAGE), false);

const openAction = PAGE.match(/function openAction\([^)]*\)\{[^\n]*/)?.[0] || '';
check('openAction specifically uses the row-number lookup', /String\(x\.rowNum\)===String\(id\)/.test(openAction), true);

console.log('\n=== the buttons emit what the lookup expects ===');
const emitted = PAGE.match(/data-id="'\+esc\((\w+)\.(\w+)\)\+'"/g) || [];
check('at least three places render an action button', emitted.length >= 3, true);
check('...and every one of them emits rowNum', emitted.every((e) => e.includes('.rowNum')), true);

console.log('\n=== the server accepts a row number ===');
/*
 * The client sends what the row rendered. If the server only resolved Property IDs this fix would move the
 * failure one layer down instead of removing it.
 */
check('findRowById_ resolves a numeric row before scanning Property IDs',
  /if \(\/\^\\d\+\$\/\.test\(raw\)\)/.test(SERVER), true);

console.log('\n=== no hand-typed date reaches the sheet unchecked ===');
/*
 * dateValue_ exists because an unreadable date was once turned into a real, valid, wrong one — 12/31/1969
 * on live cards. Every date-writing action must route through it. These two did not, and they are the two
 * most-used buttons.
 */
check('logContact routes its due date through dateValue_', /dateValue_\(params\.due\)/.test(SERVER), true);
check('...and never calls new Date on it', /new Date\(params\.due\)/.test(SERVER), false);
/*
 * `dateValue_(x) || today_()` is right for an EMPTY field and wrong for a typo: it writes today's date
 * over what the user meant and still reports success. The guarded form keeps the empty-field fallback and
 * refuses an unreadable value by name.
 */
check('recordOfferSent routes its date through dateValue_', /var offDv = dateValue_\(params\.date\);/.test(SERVER), true);
check('...and refuses an unreadable one by name rather than writing today',
  /refusedUpd\.push\('Offer Sent Date="' \+ params\.date \+ '"'\)/.test(SERVER), true);
check('...while an empty field still defaults to today', /else R\.set\('Offer Sent Date', today_\(\)\);/.test(SERVER), true);
check('...and never calls new Date on it', /new Date\(params\.date\)/.test(SERVER), false);
/*
 * A refused date must be REPORTED, not silently dropped. refusedUpd is what the response uses to tell the
 * person their date was not understood; writing nothing and saying nothing is the same bug in a quieter coat.
 */
check('a due date that cannot be read is reported, not swallowed',
  /refusedUpd\.push\('Next Action Due Date'\)/.test(SERVER), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
