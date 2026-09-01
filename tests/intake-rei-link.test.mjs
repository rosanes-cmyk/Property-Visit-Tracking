/**
 * The Intake Inbox must be able to carry an REI BlackBook link.
 *
 *   node tests/intake-rei-link.test.mjs
 *
 * The 14-column contract had no way to carry one, and the gap was not cosmetic. A booking from the phone
 * path arrives WITH a real address, and that puts it in a dead zone between the two jobs that keep a lead
 * current:
 *
 *   fill-pending-rei.mjs  only takes rows carrying the PENDING REI LOOKUP placeholder, so a row with a
 *                         real address is never looked up
 *   recheck.mjs           `if (!text(row['REI BlackBook Link'])) return 'no REI link'` — skipped
 *
 * So the row looked finished and was permanently invisible to the REI sweep: no stage changes, no gift
 * tracking, no owner corrections, no cancellation detection, and nothing saying so. Found on TVL-1397,
 * whose calendar event read "REI:" with nothing after it.
 *
 * Appended LAST, after the write-back columns, so no existing column moves and ensureIntakeInbox_ can add
 * it to a live tab non-destructively.
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

/* Evaluate the real array literal rather than pattern-matching it. */
function headersFrom(source) {
  const start = source.indexOf('var INTAKE_INBOX_HEADERS = [');
  if (start < 0) throw new Error('INTAKE_INBOX_HEADERS not found');
  const open = source.indexOf('[', start);
  const close = source.indexOf('];', open);
  return new Function(`return ${source.slice(open, close + 1)};`)();
}

const MODULE = read('apps-script/IntakeInbox.gs');
const COMBINED = read('apps-script/Code.combined.gs');

const EXPECTED = ['Timestamp', 'Seller Name', 'Phone', 'Email', 'Property Address',
  'Visit Date', 'Visit Time', 'Assigned Visitor', 'Lead Source', 'Task Body', 'Tags',
  'Status', 'Property ID', 'Processed At', 'REI BlackBook Link'];

console.log('=== The contract, in both shipped files ===');
check('IntakeInbox.gs', headersFrom(MODULE), EXPECTED);
check('Code.combined.gs — byte-for-byte the same list', headersFrom(COMBINED), headersFrom(MODULE));

console.log('\n=== REI BlackBook Link is present, and LAST ===');
const headers = headersFrom(MODULE);
check('the column exists', headers.includes('REI BlackBook Link'), true);
check('...and is the final column', headers[headers.length - 1], 'REI BlackBook Link');
/*
 * Appended, not inserted. Zapier's Create Spreadsheet Row maps by position once configured, and an
 * inserted column silently shifts every field one place right — which is exactly the shape of the bug
 * that put a scrambled row into Data 399.
 */
check('the first fourteen are unchanged', headers.slice(0, 14), EXPECTED.slice(0, 14));
check('nothing was duplicated', new Set(headers).size, headers.length);

console.log('\n=== The write-back columns still sit where they were ===');
// A non-blank Status means "already handled", so its position moving would be a data-loss bug.
for (const [name, index] of [['Status', 11], ['Property ID', 12], ['Processed At', 13]]) {
  check(`${name} is still column ${index + 1}`, headers.indexOf(name), index);
}

console.log('\n=== The processor actually reads it ===');
const code = MODULE.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('read into the lead object',
  /'REI BlackBook Link': inboxGet_\(row, idx, 'REI BlackBook Link'\)/.test(code), true);
/*
 * Via inboxGet_, which returns '' when the header is absent from the live tab. An Inbox tab created
 * before this column existed therefore keeps working untouched until somebody runs the setup item, and
 * webIntake_ skips empty values — so no row is worsened by the change.
 */
check('...through inboxGet_, so an older tab still works',
  /inboxGet_\(row, idx, 'REI BlackBook Link'\)/.test(code), true);

console.log('\n=== It reaches the Data row without any further change ===');
// webIntake_ already mapped this header; the field simply had no way in.
const WEBAPP = read('apps-script/WebApp.gs');
check("webIntake_ maps it into Data", /'REI BlackBook Link': g\('REI BlackBook Link', 'rei'\)/.test(WEBAPP), true);

console.log('\n=== ensureIntakeInbox_ can add it to a live tab without harm ===');
check('missing headers are appended, not rewritten',
  /var missing = INTAKE_INBOX_HEADERS\.filter/.test(MODULE), true);
check('...and only the header cells are written',
  /sh\.getRange\(1, existing\.length \+ 1, 1, missing\.length\)\.setValues\(\[missing\]\)/.test(MODULE), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
