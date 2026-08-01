/**
 * Legacy-import tests.
 *
 *   node tests/legacy-import.test.mjs
 *
 * Proves the three things that decide whether the 379-row import lands correctly:
 *   1. The tracker's HEADERS are identical in Config.gs, Code.combined.gs, and the migration
 *      script — a drift of one column silently shifts every value in the paste.
 *   2. Every column the CSV produces resolves to a real tracker column, and none of them is one of
 *      the nine computed columns the sheet owns.
 *   3. Every value the CSV writes into a validated column is a legal dropdown option, so the
 *      import cannot produce a cell that fails validation and disappears from the dashboard.
 *
 * Everything is read from the shipped files at test time, so these cannot drift from the code.
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

/** Pull a `const NAME = [...]` / `= {...}` literal out of a .gs file and evaluate it. */
function literalFrom(source, declaration, open, close) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found`);
  let depth = 0, i = source.indexOf(open, start);
  const from = i;
  for (; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) break;
  }
  return new Function(`return ${source.slice(from, i + 1)};`)();
}

const CONFIG = read('apps-script/Config.gs');
const COMBINED = read('apps-script/Code.combined.gs');
const PY = read('build/migrate_legacy_data.py');

const headersConfig = literalFrom(CONFIG, 'const HEADERS = [', '[', ']');
const headersCombined = literalFrom(COMBINED, 'const HEADERS = [', '[', ']');
const dropdowns = literalFrom(CONFIG, 'const DROPDOWNS = {', '{', '}');

// The Python list, read as text so the two languages cannot drift apart unnoticed.
const pyBlock = PY.slice(PY.indexOf('HEADERS = ['), PY.indexOf(']', PY.indexOf("'Market Status Update',")) + 1);
const headersPython = [...pyBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));

console.log('=== The column list is the same everywhere ===');
check('Config.gs and Code.combined.gs agree', headersCombined, headersConfig);
check('the migration script agrees', headersPython, headersConfig);
check('no duplicate column names', headersConfig.length, new Set(headersConfig).size);

console.log('\n=== The seven new legacy columns exist ===');
for (const h of ['City', 'Deal Stage', 'Deal Status', 'Contract Status', 'Closer', 'Golden Needle', 'Market Status Update']) {
  check(`"${h}" is a tracker column`, headersConfig.includes(h), true);
}

console.log('\n=== Every CSV column maps to a real, writable tracker column ===');
const COMPUTED = new Set(['Normalized Address', 'Days Since Last Activity', 'Days Overdue', 'Stalled Status',
  'Missing Required Fields', 'Duplicate Address Flag', 'Opportunity Priority', 'Data Quality Status', 'Exception Reason']);

const csvPath = 'build/legacy-import.csv';
if (!fs.existsSync(csvPath)) {
  console.log(`SKIP  ${csvPath} not generated yet — run: python3 build/migrate_legacy_data.py SOURCE.xlsx`);
} else {
  // Minimal RFC-4180 reader: the notes fields contain commas, quotes, and newlines.
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
  const csvHeaders = rows[0];
  const data = rows.slice(1).map((r) => Object.fromEntries(csvHeaders.map((h, i) => [h, r[i] ?? ''])));

  check('every CSV header is a tracker column',
    csvHeaders.filter((h) => !headersConfig.includes(h)), []);
  check('no CSV header is a computed column',
    csvHeaders.filter((h) => COMPUTED.has(h)), []);
  check('every row carries a Property Address',
    data.filter((r) => !r['Property Address']).length, 0);
  check('every row is tagged Source=Import',
    [...new Set(data.map((r) => r['Source']))], ['Import']);
  check('Property IDs are unique',
    data.length, new Set(data.map((r) => r['Property ID'])).size);

  console.log('\n=== Every imported value is a legal dropdown option ===');
  for (const [column, allowed] of Object.entries(dropdowns)) {
    if (!csvHeaders.includes(column)) continue;
    const legal = new Set(allowed);
    const illegal = [...new Set(data.map((r) => r[column]).filter((v) => v !== '' && !legal.has(v)))];
    check(`${column}: ${illegal.length ? illegal.length + ' illegal value(s)' : 'all values legal'}`, illegal, []);
  }

  console.log('\n=== Dates are written in a form Sheets parses as a date ===');
  for (const column of ['Visit Date', 'Created Date', 'Last Updated Date', 'Last Contact Date']) {
    const bad = [...new Set(data.map((r) => r[column]).filter((v) => v && !/^\d{4}-\d{2}-\d{2}$/.test(v)))];
    check(`${column} is ISO yyyy-mm-dd`, bad, []);
  }
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
