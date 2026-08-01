/**
 * Exception-rule scope.
 *
 *   node tests/exception-scope.test.mjs
 *
 * After importing three years of history, 306 of 378 records came back flagged — 241 of them for
 * "Completed visit missing Seller Motivation", a field the old workbook never had. A queue that
 * flags four rows in five is not a queue, it is wallpaper: the handful of records that genuinely
 * need work become invisible.
 *
 * The rules are now scoped to records still in play. This pins that scope both ways — the noise
 * stays out AND the real work still gets flagged — by building the real formulas through
 * formulaFor_ and by re-scoring the actual imported records against the same logic.
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

const SETUP = read('apps-script/Setup.gs');
const CONFIG = read('apps-script/Config.gs');
const RECENT = Number((CONFIG.match(/RECENT_VISIT_DAYS:\s*(\d+)/) || [])[1]);

const from = SETUP.indexOf('function formulaFor_(header, r) {');
const to = SETUP.indexOf('\nconst COMPUTED_HEADERS');
const formulaFor_ = new Function('colL', 'CFG',
  `${SETUP.slice(from, to)}\nreturn formulaFor_;`
)(() => 'B', { STALLED_BUSINESS_DAYS: 3, RECENT_VISIT_DAYS: RECENT });

console.log('=== The knob exists and is sane ===');
check('RECENT_VISIT_DAYS is configured', Number.isFinite(RECENT) && RECENT > 0, true);

console.log('\n=== Finished records are never chased ===');
for (const header of ['Exception Reason', 'Missing Required Fields']) {
  const formula = formulaFor_(header, 2);
  check(`${header}: exempts "Lost / Closed Out"`, formula.includes('="Lost / Closed Out"'), true);
  check(`${header}: exempts "Contract Signed"`, formula.includes('="Contract Signed"'), true);
  check(`${header}: parentheses balanced`,
    [...formula].reduce((d, c) => d + (c === '(') - (c === ')'), 0), 0);
}

console.log('\n=== The data-capture nags only apply to a recent visit ===');
const exception = formulaFor_('Exception Reason', 2);
check(`Visit Notes check is time-boxed to ${RECENT} days`,
  exception.includes(`>=TODAY()-${RECENT},$B2=""),"Completed visit missing Visit Notes"`), true);
check(`Seller Motivation check is time-boxed to ${RECENT} days`,
  (exception.match(new RegExp(`>=TODAY\\(\\)-${RECENT}`, 'g')) || []).length, 2);

console.log('\n=== Imported history is not asked for an REI link it can never have ===');
const missing = formulaFor_('Missing Required Fields', 2);
check('the REI link is only required when Source is not Import',
  missing.includes('<>"Import"'), true);
check('the other required fields are still required',
  ['Next Action', 'Next Action Due Date', 'Assigned Owner', 'Current Stage']
    .every((f) => missing.includes(`"${f}"`)), true);

/* --------------------------------------------------------------------------
 * Score the real imported records against the same rules.
 * ----------------------------------------------------------------------- */
const csvPath = 'build/legacy-import.csv';
if (!fs.existsSync(csvPath)) {
  console.log(`\nSKIP  ${csvPath} not generated — run build/migrate_legacy_data.py first.`);
} else {
  const parse = (text) => {
    const rows = [[]];
    let field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { rows[rows.length - 1].push(field); field = ''; }
      else if (c === '\n') { rows[rows.length - 1].push(field); field = ''; rows.push([]); }
      else if (c !== '\r') field += c;
    }
    if (field || rows[rows.length - 1].length) rows[rows.length - 1].push(field);
    return rows.filter((r) => r.length > 1);
  };
  const rows = parse(read(csvPath));
  const head = rows[0];
  const records = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));

  // Fixed "today" so the counts below are stable regardless of when the suite runs.
  const TODAY = new Date('2026-08-01T00:00:00Z');
  const cutoff = new Date(TODAY.getTime() - RECENT * 86400000).toISOString().slice(0, 10);

  const score = (rec, { scoped }) => {
    const stage = rec['Current Stage'];
    if (scoped && (stage === 'Lost / Closed Out' || stage === 'Contract Signed')) return [];
    const recent = !scoped || (rec['Visit Date'] && rec['Visit Date'] >= cutoff);
    const out = [];
    if (rec['Visit Status'] === 'Completed' && recent && !rec['Visit Notes']) out.push('notes');
    if (rec['Visit Status'] === 'Completed' && recent) out.push('motivation');
    if (stage === 'Offer Sent') out.push('offer');
    if (!scoped && stage === 'Contract Signed') out.push('signed date');
    if (stage === 'Long-Term Nurture') out.push('follow-up');
    return out;
  };

  const before = records.filter((r) => score(r, { scoped: false }).length).length;
  const after = records.filter((r) => score(r, { scoped: true }).length).length;

  console.log('\n=== Against the real 379 imported records ===');
  console.log(`      unscoped: ${before} flagged · scoped: ${after} flagged`);
  check('the old rules flagged most of the sheet', before > records.length * 0.6, true);
  check('the scoped rules flag under a quarter of it', after < records.length * 0.25, true);

  const stillFlagged = records.filter((r) => score(r, { scoped: true }).length);
  check('nothing already lost or signed is flagged',
    stillFlagged.filter((r) => ['Lost / Closed Out', 'Contract Signed'].includes(r['Current Stage'])).length, 0);

  console.log('\n=== ...but the real work is still surfaced ===');
  const reasons = (name) => stillFlagged.filter((r) => score(r, { scoped: true }).includes(name)).length;
  check('nurture leads with no follow-up date are still flagged', reasons('follow-up') > 0, true);
  check('offers sent with no amount/date are still flagged', reasons('offer') > 0, true);
  check('a visit completed in the last 30 days is still chased', reasons('motivation') > 0, true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
