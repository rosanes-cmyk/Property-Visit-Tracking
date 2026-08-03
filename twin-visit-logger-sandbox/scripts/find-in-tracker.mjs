/**
 * Find a lead in the tracker tab. Read-only, exact, and it names the row.
 *
 *   node scripts/find-in-tracker.mjs "Estudillo"
 *   node scripts/find-in-tracker.mjs "20533149"      (a REI record id)
 *   node scripts/find-in-tracker.mjs                 (just the totals)
 *
 * Why this exists: "it is not showing in the sheet" and "the row was written" were both being argued
 * from things that cannot settle it — a Drive export that silently truncates long tabs, and a Gmail
 * label that only proves a write was ATTEMPTED against whatever the settings pointed at then. This
 * reads the actual tab through the same credentials and the same SPREADSHEET_ID / TRACKER_SHEET the
 * automation uses, so its answer is the automation's answer.
 *
 * It prints the total row count first. A tab with far fewer rows than expected is itself the finding.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';

const needle = (process.argv[2] || '').trim();

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });

const book = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
console.log(`Workbook: "${book.data.properties?.title}"`);
console.log(`          https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
console.log(`Tab:      "${config.trackerSheet}"\n`);

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `'${config.trackerSheet.replace(/'/g, "''")}'`,
  valueRenderOption: 'FORMATTED_VALUE'
});
const rows = res.data.values || [];
if (!rows.length) {
  console.log('That tab is completely empty.');
  process.exit(0);
}

const header = rows[config.trackerHeaderRow - 1] || [];
const dataRows = rows.slice(config.trackerHeaderRow);
const filled = dataRows.filter((r) => r.some((c) => String(c || '').trim()));

console.log(`Header row ${config.trackerHeaderRow}: ${header.length} column(s)`);
/*
 * Print the first columns WITH THEIR INDEX. Values landing in the wrong column is invisible until you can
 * see which name sits at which position — that is how an address ended up under "Deal Stage", 64 columns
 * right of where it belonged, and nobody could tell from looking at the sheet.
 */
console.log('  first 12: ' + header.slice(0, 12).map((h, i) => `${i}=${h || '(blank)'}`).join('  '));
const needed = ['REI Record ID', 'REI BlackBook Link', 'Property Address', 'Calendar Event ID'];
const absent = needed.filter((n) => !header.includes(n));
if (absent.length) {
  console.log(`  MISSING COLUMNS: ${absent.join(', ')}`);
  console.log('  A visit cannot be recognised again without one of the first three, so every run would');
  console.log('  append another row. Writing now refuses rather than duplicating.');
}
console.log(`Rows below it: ${dataRows.length}  ·  with any content: ${filled.length}\n`);

if (!needle) {
  console.log('Last 5 rows with content:');
  for (const r of filled.slice(-5)) {
    console.log(`  ${(r[1] || r[3] || '(blank)').slice(0, 70)}`);
  }
  console.log('\nPass something to search for, e.g.:  node scripts\\find-in-tracker.mjs "Estudillo"');
  process.exit(0);
}

// Case-insensitive substring, across every cell. Deliberately not clever: the question being answered
// is "is this text anywhere in this tab", and any normalisation here could hide a genuine miss.
const want = needle.toLowerCase();
const hits = [];
dataRows.forEach((row, i) => {
  const at = row.findIndex((cell) => String(cell || '').toLowerCase().includes(want));
  if (at >= 0) hits.push({ rowNumber: config.trackerHeaderRow + 1 + i, row, at });
});

console.log(`Searching every cell for "${needle}": ${hits.length} row(s)\n`);
if (!hits.length) {
  console.log('NOT IN THIS TAB. That is definitive — this read the tab the automation writes to,');
  console.log('through the same credentials, with no truncation.');
  console.log('\nCheck next:');
  console.log(`  - Is the row in another tab? Tabs here: ${(book.data.sheets || []).map((s) => s.properties.title).join(', ')}`);
  console.log('  - Did the write fail? A dropdown rule refusing one value rejects the whole row.');
  console.log('    logs\\scheduled-task.log records the reason.');
  process.exit(1);
}

for (const hit of hits) {
  console.log(`--- row ${hit.rowNumber}  (matched in column ${header[hit.at] || `#${hit.at + 1}`})`);
  header.forEach((name, c) => {
    const value = String(hit.row[c] || '').trim();
    if (value && name) console.log(`  ${String(name).padEnd(24)} ${value.slice(0, 90)}`);
  });
  console.log('');
}
