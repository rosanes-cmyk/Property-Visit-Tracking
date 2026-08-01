/**
 * Proves the two import paths agree.
 *
 *   node tests/import-from-drive.test.mjs
 *
 * There are two ways the historical workbook can reach the tracker:
 *   A. build/migrate_legacy_data.py  -> legacy-import.csv -> paste -> ImportLegacy.gs
 *   B. ImportFromOldWorkbook.gs      -> reads the old Google Sheet directly, one click
 *
 * Path B is a hand port of path A. A port is exactly the kind of thing that drifts silently, so
 * this runs the REAL Apps Script mapping functions (extracted from the shipped .gs) over the REAL
 * legacy rows and asserts the result is identical to the CSV the Python script produced — every
 * field of every record. If either side changes, this fails.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(want === undefined ? got : got)}`);
  ok ? pass++ : fail++;
}

/* ---------------------------------------------------------------------------
 * Load the real .gs mapping code into this process.
 * Apps Script globals it touches are stubbed with UTC behaviour, matching how the Python script
 * formats the same naive dates.
 * ------------------------------------------------------------------------- */
const GS = read('apps-script/ImportFromOldWorkbook.gs');

// Everything from the column map down to the end of mapLegacyRow_ — the pure mapping layer.
const from = GS.indexOf('var LEGACY_COL = {');
const to = GS.indexOf('/** Accepts a full Drive URL or a bare file ID. */');
if (from < 0 || to <= from) throw new Error('could not locate the mapping block in ImportFromOldWorkbook.gs');

const Utilities = {
  formatDate(date, _tz, format) {
    if (format !== 'yyyy-MM-dd') throw new Error(`unexpected format ${format}`);
    return date.toISOString().slice(0, 10);
  }
};
const Session = { getScriptTimeZone: () => 'UTC' };

const sandbox = new Function('Utilities', 'Session',
  `${GS.slice(from, to)}\nreturn { mapLegacyRow_, legacySplitAgent_, legacyCurrentStage_, legacyDate_, legacyText_ };`
)(Utilities, Session);

const { mapLegacyRow_, legacySplitAgent_, legacyCurrentStage_ } = sandbox;

/* --------------------------------------------------------------------------- */
console.log('=== Agent free-text is split, never dropped ===');
check('plain name', legacySplitAgent_('Matt'), ['Matt', '']);
check('compound name is not truncated to "Matt"', legacySplitAgent_('Matt/Arly'), ['Matt/Arly', '']);
check('name + explanation', legacySplitAgent_('Matt-since it was Juan'), ['Matt', 'since it was Juan']);
check('lowercase name', legacySplitAgent_('danica since member is no longer with team'),
  ['Danica', 'since member is no longer with team']);
check('unrecognised text never becomes an owner', legacySplitAgent_('some other person'),
  ['', 'some other person']);
check('empty', legacySplitAgent_(''), ['', '']);

console.log('\n=== Stage decision table ===');
check('contract outranks a Lost deal stage',
  legacyCurrentStage_('Lost', "We're Passing", 'Inspected', 'Acquired'), 'Contract Signed');
check('cancelled contract is closed out',
  legacyCurrentStage_('Active', 'Offer Made', 'Inspected', 'Cancelled Contract'), 'Lost / Closed Out');
check('Active + Offer Made', legacyCurrentStage_('Active', 'Offer Made', 'Inspected', ''), 'Offer Sent');
check('Active + Under Review', legacyCurrentStage_('Active', 'Under Review', 'Inspected', ''), 'Offer Preparation');
check('Active + any On Hold status', legacyCurrentStage_('Active', 'On Hold - Nurture', 'Inspected', ''), 'Long-Term Nurture');
check('no stage + Inspected', legacyCurrentStage_('', '', 'Inspected', ''), 'Visit Completed — Needs Review');
check('no stage + Pending Inspection', legacyCurrentStage_('', '', 'Pending Inspection', ''), 'Visit Scheduled');
check('no stage + Cancelled stays BLANK for a human', legacyCurrentStage_('', '', 'Cancelled', ''), '');

/* ---------------------------------------------------------------------------
 * The real comparison: same input, both paths, identical output.
 * ------------------------------------------------------------------------- */
const rowsPath = 'build/legacy-source-rows.json';
const csvPath = 'build/legacy-import.csv';

if (!fs.existsSync(rowsPath) || !fs.existsSync(csvPath)) {
  console.log(`\nSKIP  ${rowsPath} / ${csvPath} not generated — run build/migrate_legacy_data.py first.`);
} else {
  const revive = (cell) => (cell && typeof cell === 'object' && cell.__date)
    ? new Date(`${cell.__date}T00:00:00Z`)
    : cell;
  const sourceRows = JSON.parse(read(rowsPath)).map((row) => row.map(revive));

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
  const csvRows = parse(read(csvPath));
  const csvHeaders = csvRows[0];
  const fromPython = csvRows.slice(1).map((r) => Object.fromEntries(csvHeaders.map((h, i) => [h, r[i] ?? ''])));

  // Path B, over the same rows, numbering the same way the Python script does.
  const fromAppsScript = [];
  let seq = 1000;
  for (let r = 1; r < sourceRows.length; r++) {
    const mapped = mapLegacyRow_(sourceRows[r], '');
    if (!mapped) continue;
    seq += 1;
    mapped['Property ID'] = `TVL-${String(seq).padStart(4, '0')}`;
    fromAppsScript.push(mapped);
  }

  console.log('\n=== Both paths produce the same records ===');
  check('same number of records', fromAppsScript.length, fromPython.length);

  const differences = [];
  const compared = Math.min(fromAppsScript.length, fromPython.length);
  for (let i = 0; i < compared; i++) {
    for (const header of csvHeaders) {
      const a = String(fromAppsScript[i][header] ?? '');
      const b = String(fromPython[i][header] ?? '');
      if (a !== b) differences.push(`${fromPython[i]['Property ID']} · ${header}: gs="${a}" py="${b}"`);
    }
  }
  check(`all ${compared} records match field-for-field across ${csvHeaders.length} columns`,
    differences.slice(0, 8), []);
  if (differences.length > 8) console.log(`        ...and ${differences.length - 8} more differences`);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
