/**
 * Which sheet row a dashboard click refers to.
 *
 *   node tests/record-identity.test.mjs
 *
 * The bug: the client clicked "Full record" on Sara Davenport and got Jose Anguiano. Property ID is
 * blank on every imported row, the page keyed its cards on it, and `RECS.filter(x => x.id === id)`
 * with id === '' returned the FIRST blank-ID record.
 *
 * The visible half was a wrong modal. The dangerous half was silent: the same identifier goes to
 * runAction for Save and Delete, and the server's findRowById_ matched the first blank Property ID the
 * same way — so Save wrote to another seller's row and Delete trashed another seller's record.
 *
 * Records are now addressed by row number, and a blank identifier matches nothing at either end.
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

const DASH = read('apps-script/Dashboard.html');
const WEB = read('apps-script/WebApp.gs');

console.log('=== The page keys every click on the row number ===');
check('the card header does', /data-detail="'\+esc\(r\.rowNum\)/.test(DASH), true);
check('the Full record button does', /data-detail="'\+esc\(r\.rowNum\)\+'">🔎 Full record/.test(DASH), true);
check('the action buttons do', /data-act="'\+a\[0\]\+'" data-id="'\+esc\(r\.rowNum\)/.test(DASH), true);
check('the Data table rows do', /<tr data-detail="'\+esc\(r\.rowNum\)/.test(DASH), true);
check('the lookup compares row numbers',
  /RECS\.filter\(function\(x\)\{return String\(x\.rowNum\)===String\(id\);\}\)/.test(DASH), true);
// Property ID may still be DISPLAYED — it is only unusable as a key.
check('Property ID is still shown in the Data table', /if\(k==='id'\)return '<td class="num">'\+esc\(r\.id\)/.test(DASH), true);
check('...and is no longer used as a click target',
  (DASH.match(/data-(detail|id)="'\+esc\(r\.id\)/g) || []).length, 0);

console.log('\n=== The server refuses to guess ===');
/* Lift the real findRowById_ and run it against a sheet where most Property IDs are blank. */
const src = WEB.slice(WEB.indexOf('function findRowById_(id) {'), WEB.indexOf('\n}', WEB.indexOf('function findRowById_(id) {')) + 2);
const ROWS = [
  [''],            // row 2  — Jose Anguiano, blank ID (the record that kept opening)
  [''],            // row 3  — Sara Davenport, blank ID
  ['P-0007'],      // row 4  — has an ID
  ['  '],          // row 5  — whitespace only
];
const findRowById_ = new Function('CFG', 'dataSheet_', 'col', `${src}\nreturn findRowById_;`)(
  { FIRST_DATA_ROW: 2 },
  () => ({
    getLastRow: () => 1 + ROWS.length,
    getRange: () => ({ getValues: () => ROWS })
  }),
  () => 1
);

check('a blank id matches NOTHING', findRowById_(''), 0);
check('null matches nothing', findRowById_(null), 0);
check('undefined matches nothing', findRowById_(undefined), 0);
check('whitespace matches nothing', findRowById_('   '), 0);
// This is the exact failure: before the fix, '' returned row 2 and a Delete aimed at row 3 hit row 2.
check('it can no longer return the first blank-ID row', findRowById_('') === 2, false);

console.log('\n--- a row number is used directly ---');
check('row 2', findRowById_(2), 2);
check('row 3 — Sara, the one that was being mistaken', findRowById_(3), 3);
check('a string row number works too', findRowById_('5'), 5);
check('row 1 is the header, not a record', findRowById_(1), 0);
check('past the last row is not a record', findRowById_(99), 0);

console.log('\n--- a real Property ID still resolves, so an older page keeps working ---');
check('P-0007 is row 4', findRowById_('P-0007'), 4);
check('an unknown Property ID is not found', findRowById_('P-9999'), 0);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
