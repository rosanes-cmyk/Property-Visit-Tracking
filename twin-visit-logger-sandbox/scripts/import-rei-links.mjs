/**
 * Give the tracker the REI links it is missing, from the team's own workbook.
 *
 *   node scripts/import-rei-links.mjs            <- dry run: what it WOULD match
 *   node scripts/import-rei-links.mjs --yes      <- writes the links
 *
 * Why this matters more than anything else built today: 374 of 378 tracker rows have no REI link, so the
 * 20-minute re-check can only ever see FOUR leads. The dashboard says "209 REI link missing". Everything
 * about keeping the board accurate from REI is capped at about one percent of the sheet.
 *
 * The client's own Property_Visit_Tracking workbook turns out to carry 373 REI links — hyperlinked onto the
 * seller NAMES in its Data tab, which is why no import ever picked them up: a hyperlink lives in the file's
 * relationship table, not in the cell text, so every CSV export of that sheet dropped them silently.
 *
 * Reads build/rei-links.json, extracted from that workbook. That file holds seller names, phones and
 * addresses, so it is gitignored — see CLAUDE.md: never commit seller data.
 *
 * What it will and will not do:
 *   - Writes REI BlackBook Link and REI Record ID, and ONLY onto rows where the link is blank. An existing
 *     link is never replaced: the tracker's own may be newer, and a wrong link would point the re-check at
 *     another seller's page and then write that seller's phone number onto this row.
 *   - Matches on phone first, then normalized address, then name+city. Anything matching more than one
 *     tracker row is REPORTED, never guessed at.
 *   - Dry run unless --yes.
 */
import fs from 'node:fs/promises';
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { normalizeAddress } from '../src/google/sheets.mjs';

const APPLY = process.argv.includes('--yes');
const SOURCE = './build/rei-links.json';

const text = (v) => String(v == null ? '' : v).trim();
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const nameKey = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');

let source;
try {
  source = JSON.parse(await fs.readFile(SOURCE, 'utf8'));
} catch {
  console.error(`Could not read ${SOURCE}.`);
  console.error('Put the extracted rei-links.json in the build\\ folder next to package.json and re-run.');
  process.exit(1);
}

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });
const book = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
console.log(`Workbook: "${book.data.properties?.title}"  ·  tab "${config.trackerSheet}"`);
console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing will be written\n');

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId, range: config.trackerSheet
});
const grid = res.data.values || [];
const headers = (grid[config.trackerHeaderRow - 1] || []).map((h) => String(h).trim());
const colOf = new Map(headers.map((h, i) => [h, i]));
for (const need of ['REI BlackBook Link', 'Property Address']) {
  if (!colOf.has(need)) { console.error(`The tab has no "${need}" column.`); process.exit(1); }
}

const rows = grid.slice(config.trackerHeaderRow).map((cells, i) => {
  const row = { __rowNumber: config.trackerHeaderRow + 1 + i };
  headers.forEach((h, j) => { if (h) row[h] = cells[j] === undefined ? '' : cells[j]; });
  return row;
}).filter((r) => r['Property Address']);

const already = rows.filter((r) => text(r['REI BlackBook Link'])).length;
console.log(`${rows.length} tracker row(s): ${already} already have a REI link, ${rows.length - already} do not.`);
console.log(`${source.length} link(s) in the source workbook.\n`);

/*
 * Three ways to recognise the same lead, tried in order of how hard each is to get wrong.
 *
 * Phone first: ten digits either match or they do not. Address second, through the SAME normalizer the
 * upsert uses, so this cannot disagree with how the rest of the project decides two rows are one property.
 * Name plus city last, and only together — "Maria Garcia" alone is not an identity.
 */
const TIERS = [
  ['phone', (r, s) => digits10(r.Phone) && digits10(r.Phone) === digits10(s.phone)],
  ['address', (r, s) => {
    const a = normalizeAddress(r['Property Address']);
    const b = normalizeAddress(s.address);
    return Boolean(a && b) && (a === b || a.startsWith(b) || b.startsWith(a));
  }],
  ['name+city', (r, s) => Boolean(nameKey(r['Seller Name']) && nameKey(s.name))
    && nameKey(r['Seller Name']) === nameKey(s.name)
    && Boolean(s.city) && normalizeAddress(r['Property Address']).includes(normalizeAddress(s.city))]
];

const toWrite = [];
const ambiguous = [];
const conflicts = [];
const unmatched = [];

for (const s of source) {
  let hits = [];
  let how = '';
  for (const [label, test] of TIERS) {
    hits = rows.filter((r) => test(r, s));
    if (hits.length) { how = label; break; }
  }
  if (!hits.length) { unmatched.push(s); continue; }
  /*
   * More than one tracker row for one REI contact is reported, never resolved by picking.
   * Writing the same link onto two rows would make the re-check overwrite one seller's row from the
   * other's page — the exact class of damage the whole safety model exists to prevent.
   */
  if (hits.length > 1) { ambiguous.push({ s, how, rows: hits }); continue; }

  const row = hits[0];
  const existing = text(row['REI BlackBook Link']);
  if (existing) {
    // Only worth mentioning when it points somewhere ELSE.
    const a = (existing.match(/contacts\/(\d+)/) || [])[1];
    const b = (s.reiLink.match(/contacts\/(\d+)/) || [])[1];
    if (a && b && a !== b) conflicts.push({ s, row, existing });
    continue;
  }
  toWrite.push({ s, row, how });
}

const byTier = toWrite.reduce((acc, x) => ({ ...acc, [x.how]: (acc[x.how] || 0) + 1 }), {});
console.log('='.repeat(70));
console.log(`${toWrite.length} row(s) would GAIN a REI link:`);
for (const [tier, n] of Object.entries(byTier)) console.log(`    ${String(n).padStart(4)} matched on ${tier}`);
for (const { s, row, how } of toWrite.slice(0, 15)) {
  console.log(`  row ${String(row.__rowNumber).padStart(3)}  ${(row['Seller Name'] || '(no name)').padEnd(22)}` +
    ` ${(s.reiLink.match(/contacts\/\d+/) || [''])[0]}  (${how})`);
}
if (toWrite.length > 15) console.log(`  …and ${toWrite.length - 15} more`);

if (ambiguous.length) {
  console.log(`\n${ambiguous.length} source link(s) matched MORE THAN ONE tracker row — skipped, not guessed:`);
  for (const { s, how, rows: rs } of ambiguous.slice(0, 10)) {
    console.log(`  ${s.name} (${how}) -> rows ${rs.map((r) => r.__rowNumber).join(', ')}`);
  }
  if (ambiguous.length > 10) console.log(`  …and ${ambiguous.length - 10} more`);
  console.log('  These are probably duplicate tracker rows. Merge them and re-run.');
}

if (conflicts.length) {
  console.log(`\n${conflicts.length} row(s) already have a DIFFERENT REI link — left alone:`);
  for (const { s, row } of conflicts.slice(0, 10)) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name']} — tracker keeps its own link`);
  }
}

if (unmatched.length) {
  console.log(`\n${unmatched.length} source link(s) matched no tracker row at all.`);
  console.log('  Those leads are in the old workbook but not in this tracker. Nothing to do here —');
  console.log('  adding them would be an import, not a link fix.');
}

if (!APPLY) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Nothing was written. Re-run with --yes to add ${toWrite.length} link(s).`);
  console.log('Then the 20-minute re-check will cover those leads instead of just four.');
  process.exit(0);
}

const data = [];
const letter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
for (const { s, row } of toWrite) {
  // The canonical contact URL: REI's own links carry ?activeTab=chat and similar, and a stored link should
  // not depend on which tab somebody happened to have open when they copied it.
  const id = (s.reiLink.match(/contacts\/(\d+)/) || [])[1] || '';
  const clean = id ? `https://my.reiblackbook.com/contacts/${id}` : s.reiLink;
  data.push({ range: `${config.trackerSheet}!${letter(colOf.get('REI BlackBook Link') + 1)}${row.__rowNumber}`, values: [[clean]] });
  if (id && colOf.has('REI Record ID') && !text(row['REI Record ID'])) {
    data.push({ range: `${config.trackerSheet}!${letter(colOf.get('REI Record ID') + 1)}${row.__rowNumber}`, values: [[id]] });
  }
}

if (data.length) {
  // One batch. 700+ single writes would take minutes and could half-finish.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
}
console.log(`\nWrote ${data.length} cell(s) across ${toWrite.length} row(s).`);
console.log('The REI re-check can now see those leads. It runs every 20 minutes.');
