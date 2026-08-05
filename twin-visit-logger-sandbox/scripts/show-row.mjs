/**
 * Print the tracker row(s) for one lead, exactly as the automation reads them. Read-only.
 *
 *   node scripts/show-row.mjs "Amelia"
 *   node scripts/show-row.mjs "20525007"
 *
 * Why this exists: scrape-dump.mjs proved REI supplies "Assigned Owner: Juan" and that diffFromRei would
 * fill it into an empty cell. Yet the scheduled run reported NO changes for Amelia's row — which can only
 * mean her cell is not empty — while the dashboard card shows "Unassigned" and the sheet's own exception
 * column says "Missing: Assigned Owner". Those three cannot all be true, and reading the source has not
 * told me which one is lying.
 *
 * So this prints the cells. It also counts how many rows match the lead, because a duplicate imported row
 * with no REI link would explain it completely: the card on screen would be the duplicate, and the
 * re-check would only ever touch the row that has a REI page.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { recheckSkipReason, FILL_IF_BLANK } from '../src/rei/recheck.mjs';

const needle = (process.argv[2] || '').toLowerCase();
if (!needle) {
  console.error('Usage: node scripts/show-row.mjs "Amelia"');
  process.exit(1);
}

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId, range: config.trackerSheet
});
const grid = res.data.values || [];
const headers = (grid[config.trackerHeaderRow - 1] || []).map((h) => String(h).trim());

const rows = grid.slice(config.trackerHeaderRow).map((cells, i) => {
  const row = { __rowNumber: config.trackerHeaderRow + 1 + i };
  headers.forEach((h, j) => { if (h) row[h] = cells[j] === undefined ? '' : cells[j]; });
  return row;
});

const hit = (r) => [r['Seller Name'], r['Property Address'], r['REI BlackBook Link'], r['REI Record ID']]
  .some((v) => String(v || '').toLowerCase().includes(needle));
const matched = rows.filter(hit);

console.log(`\n${matched.length} row(s) match "${needle}" out of ${rows.length}\n`);
/*
 * A duplicate is the single most likely explanation, so it is stated before the cells rather than left to
 * be noticed. The dashboard shows every row; the re-check only ever touches rows with a REI link.
 */
if (matched.length > 1) {
  console.log('MORE THAN ONE ROW. The dashboard shows all of them; the re-check only touches rows with a');
  console.log('REI link, so a duplicate without one would sit on the board untouched forever.\n');
}

for (const row of matched) {
  const why = recheckSkipReason(row);
  console.log('='.repeat(70));
  console.log(`ROW ${row.__rowNumber}   ${row['Seller Name'] || '(no name)'}`);
  console.log(`  re-checkable: ${why ? `NO — ${why}` : 'yes'}`);
  console.log('  --- the owner columns, blanks marked ---');
  for (const field of [...FILL_IF_BLANK, 'Assigned Visitor']) {
    if (!headers.includes(field)) { console.log(`  ${field.padEnd(24)} (COLUMN DOES NOT EXIST)`); continue; }
    const raw = row[field];
    // A cell holding a space, or a formula returning "", looks filled to one reader and empty to another.
    // Printing the length and the quoted value distinguishes them.
    console.log(`  ${field.padEnd(24)} ${raw === '' ? '(EMPTY)' : `"${raw}"  [${String(raw).length} chars]`}`);
  }
  console.log('  --- everything else that has a value ---');
  for (const h of headers) {
    if (!h || FILL_IF_BLANK.includes(h) || h === 'Assigned Visitor') continue;
    const v = String(row[h] ?? '').trim();
    if (v) console.log(`  ${h.padEnd(24)} ${v.replace(/\s+/g, ' ').slice(0, 80)}`);
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log('Nothing was changed.');
