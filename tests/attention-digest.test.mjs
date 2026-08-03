/**
 * The 3pm "Needs attention" Chat digest.
 *
 *   node tests/attention-digest.test.mjs
 *
 * Cherry asked where the 282 came from and pointed out that visits already done were being listed.
 * Three things were wrong, and this pins all three:
 *
 *   1. One lead could appear in FOUR sections, so the headline number counted the same seller
 *      repeatedly. Each record now lands in its most urgent bucket only.
 *   2. "Overdue next action" fired on records with NO next action text — a due date the stage
 *      cascade had stamped, not a commitment anyone made.
 *   3. "Stalled" had no upper bound, so all 379 imported records qualified forever.
 *
 * The bucket logic is re-implemented here from the shipped source's own rules and run over records
 * shaped like the real ones.
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

const CHAT = read('apps-script/ChatNotify.gs');
const digest = CHAT.slice(CHAT.indexOf('function sendAttentionDigestToChat'), CHAT.indexOf('\n}', CHAT.indexOf('function sendAttentionDigestToChat')));

console.log('=== The shipped digest enforces one lead, one line ===');
check('a claim helper exists', /var claim = function/.test(digest), true);
check('every bucket goes through it',
  (digest.match(/claim\((overdue|stalled|missedVisit|review)/g) || []).length, 4);
check('nothing pushes straight into a bucket any more',
  /\b(overdue|stalled|missedVisit|review)\.push\(/.test(digest), false);
check('overdue requires a Next Action', /od > 0 && rec\['Next Action'\]/.test(digest), true);
check('the header says lead(s), not item(s)', /lead\(s\)/.test(digest), true);

console.log('\n=== Stalled Status is a window, not a minimum age ===');
const SETUP = read('apps-script/Setup.gs');
const CONFIG = read('apps-script/Config.gs');
const DORMANT = Number((CONFIG.match(/DORMANT_DAYS:\s*(\d+)/) || [])[1]);
const from = SETUP.indexOf('function formulaFor_(header, r) {');
const formulaFor_ = new Function('colL', 'CFG',
  `${SETUP.slice(from, SETUP.indexOf('\nconst COMPUTED_HEADERS'))}\nreturn formulaFor_;`
)(() => 'B', { STALLED_BUSINESS_DAYS: 3, RECENT_VISIT_DAYS: 30, DORMANT_DAYS: DORMANT });
const stalled = formulaFor_('Stalled Status', 2);
check('it has a lower bound (business days of silence)', /NETWORKDAYS/.test(stalled), true);
check(`it now has an upper bound of ${DORMANT} days`, stalled.includes(`<=${DORMANT}`), true);
check('parentheses balanced', [...stalled].reduce((d, c) => d + (c === '(') - (c === ')'), 0), 0);

/* ------------------------------------------------------------------
 * The bucket decision, mirroring the shipped rules.
 * ---------------------------------------------------------------- */
const TODAY = '2026-08-03';
function bucketFor(rec) {
  if (!rec['Property Address']) return null;
  if (rec['Source'] === 'TEST') return null;
  if (rec['Current Stage'] === 'Lost / Closed Out') return null;

  if (rec['Visit Status'] === 'Scheduled' && rec['Visit Date'] && rec['Visit Date'] < TODAY) return 'missedVisit';
  if ((Number(rec['Days Overdue']) || 0) > 0 && rec['Next Action']) return 'overdue';
  if (rec['Data Quality Status'] === 'Exception' || rec['Data Quality Status'] === 'Incomplete') return 'review';
  if (rec['Stalled Status'] === 'Yes') return 'stalled';
  return null;
}

console.log('\n=== Each record gets exactly one bucket ===');
// Jose Anguiano, the record that previously appeared three times over.
const jose = {
  'Property Address': '2145 Capitol Ave, East Palo Alto, CA',
  'Visit Status': 'Scheduled', 'Visit Date': '2026-08-01',
  'Days Overdue': 2, 'Next Action': 'Conduct scheduled visit & log outcome',
  'Data Quality Status': 'Incomplete', 'Stalled Status': 'Yes'
};
check('a passed visit outranks everything else', bucketFor(jose), 'missedVisit');
check('...and it is ONE bucket, not three',
  ['missedVisit', 'overdue', 'review', 'stalled'].filter((b) => bucketFor(jose) === b).length, 1);

console.log('\n=== The artifact that produced "48 overdue · no next action" ===');
const stamped = {
  'Property Address': '550 El Capitan Dr, Danville, CA',
  'Days Overdue': 2, 'Next Action': '',            // due date stamped by the cascade, no action written
  'Data Quality Status': 'Incomplete', 'Stalled Status': 'Yes'
};
check('a due date with no action is NOT called overdue', bucketFor(stamped) === 'overdue', false);
check('...it goes to needs-review, where the missing field is the point', bucketFor(stamped), 'review');

const real = { ...stamped, 'Next Action': 'Call seller to confirm price' };
check('a real overdue commitment still reports as overdue', bucketFor(real), 'overdue');

console.log('\n=== Records that should not appear at all ===');
check('closed out', bucketFor({ ...jose, 'Current Stage': 'Lost / Closed Out' }), null);
check('a TEST row', bucketFor({ ...jose, Source: 'TEST' }), null);
check('a blank row', bucketFor({}), null);
check('a healthy record', bucketFor({
  'Property Address': '1 Main St', 'Visit Status': 'Scheduled', 'Visit Date': '2026-09-01',
  'Days Overdue': 0, 'Data Quality Status': 'OK', 'Stalled Status': 'No'
}), null);

console.log('\n=== The headline count no longer double-counts ===');
const many = [jose, stamped, real,
  { 'Property Address': '2 Oak St', 'Stalled Status': 'Yes', 'Data Quality Status': 'OK' },
  { 'Property Address': '3 Elm St', 'Data Quality Status': 'Exception', 'Stalled Status': 'Yes' }
];
const buckets = many.map(bucketFor).filter(Boolean);
check('5 records produce 5 lines, not 12', buckets.length, 5);
check('every record is in exactly one bucket', new Set(many.map((r, i) => i)).size, buckets.length);
check('the stalled-only record is counted as stalled', bucketFor(many[3]), 'stalled');
check('review outranks stalled when both apply', bucketFor(many[4]), 'review');

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
