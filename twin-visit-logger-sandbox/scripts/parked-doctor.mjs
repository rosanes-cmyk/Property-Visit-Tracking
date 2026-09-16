/**
 * Why is a card still sitting on the board after the PC said it filled the row?
 *
 *   node scripts/parked-doctor.mjs
 *
 * READ-ONLY. It opens no browser, takes no lock, and writes nothing — to the sheet, to REI, or to Chat.
 * Safe to run while anything else is running.
 *
 * WHY IT EXISTS. The finisher's log said, in plain words:
 *
 *   --- Everett Morgan
 *       filled row 418 · calendar event set
 *       Chat briefing posted
 *   6 row(s) filled in, 2 left parked.
 *
 * and the board still showed Everett Morgan as "Finding in REI", along with six others — one of them
 * parked for 11.8 days. Refreshing changed nothing, and the dashboard reads the sheet live, so both of
 * those statements cannot be true at once.
 *
 * There are only three ways that happens, and they need different fixes:
 *
 *   1. THE WRITE WENT TO A DIFFERENT ROW. The matcher did not recognise the parked row, so the data landed
 *      on a second row for the same person. The parked one then waits for ever while a duplicate carries
 *      the booking — and "no duplicate tracker rows" is a rule this project is supposed to hold.
 *   2. THE WRITE DID NOT REACH THE ADDRESS CELL. The row is the right one and still reads
 *      "PENDING REI LOOKUP —", which means "filled row 418" reported a success that did not happen.
 *   3. IT IS GENUINELY A DIFFERENT ROW. Two people really are waiting, and nothing is wrong except that
 *      the first six that finished were not these.
 *
 * This prints exactly what is needed to tell them apart: every parked row with its number, and every seller
 * or phone number that appears on more than one row. Nobody should have to read a spreadsheet by hand to
 * answer a question the software can answer in ten seconds.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';

const PENDING_PREFIX = 'PENDING REI LOOKUP —';
const text = (v) => String(v ?? '').trim();
/* Last ten digits: the sheet holds "(510) 214-3017" and REI holds "15102143017" for one person. */
const digits = (v) => text(v).replace(/\D/g, '').slice(-10);

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `${config.trackerSheet}!A1:CZ`,
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'FORMATTED_STRING'
});

const grid = res.data.values || [];
if (!grid.length) {
  console.log('The tracker tab is empty.');
  process.exit(0);
}

const headers = grid[0].map((h) => String(h).trim());
const rows = grid.slice(1).map((values, i) => {
  const rec = { __row: i + 2 };
  headers.forEach((h, c) => { rec[h] = values[c]; });
  return rec;
});

console.log(`Read ${rows.length} row(s) from "${config.trackerSheet}".\n`);

/* 1. WHAT IS ACTUALLY PARKED, straight from the cell the board reads. */
const parked = rows.filter((r) => text(r['Property Address']).startsWith(PENDING_PREFIX));
console.log(`=== ${parked.length} row(s) still parked ===`);
if (!parked.length) {
  console.log('  None. Every row has a real address, so the board should be clear.');
  console.log('  If a card is still showing, it is the PAGE that is stale — reload it.\n');
} else {
  for (const r of parked) {
    console.log(`  row ${r.__row}  ${text(r['Seller Name']) || '(no name)'}`
      + `  ${text(r.Phone) || '(no phone)'}  visit ${text(r['Visit Date']) || '(none)'}`);
    const why = text(r['Exception Reason']);
    if (why) console.log(`          reason on the row: ${why}`);
  }
  console.log('');
}

/*
 * 2. THE SAME PERSON ON TWO ROWS, which is what a failed match leaves behind.
 *
 * Matched on PHONE first, because that is what the finisher itself matches on and it survives the spelling
 * differences REI is full of — the log matched "Emmanuel Hodge" against a board card reading "Emmanuel
 * Hoggs". Name is checked too, for rows with no phone.
 */
const groups = new Map();
for (const r of rows) {
  const key = digits(r.Phone) || text(r['Seller Name']).toLowerCase();
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const dupes = [...groups.values()].filter((g) => g.length > 1);

console.log(`=== ${dupes.length} person(s) on more than one row ===`);
if (!dupes.length) {
  console.log('  None. So nothing was written to a duplicate instead of the parked row.\n');
} else {
  for (const g of dupes) {
    console.log(`  ${text(g[0]['Seller Name']) || '(no name)'}  ${text(g[0].Phone) || '(no phone)'}`);
    for (const r of g) {
      const addr = text(r['Property Address']);
      console.log(`      row ${r.__row}  ${addr.startsWith(PENDING_PREFIX) ? 'STILL PARKED' : 'filled'}`
        + `  ${addr.slice(0, 60) || '(no address)'}`
        + `  event ${text(r['Calendar Event ID']) ? 'yes' : 'no'}`);
    }
  }
  console.log('');
  console.log('  A person on two rows with one PARKED and one FILLED is the answer: the finisher did not');
  console.log('  recognise the parked row and wrote a new one. The parked card will never clear on its own.');
  console.log('');
}

/* 3. The verdict, so nobody has to interpret the lists above. */
console.log('=== What this means ===');
if (!parked.length) {
  console.log('  Nothing is parked. The board is showing a stale page.');
} else if (dupes.some((g) => g.some((r) => text(r['Property Address']).startsWith(PENDING_PREFIX))
  && g.some((r) => !text(r['Property Address']).startsWith(PENDING_PREFIX)))) {
  console.log('  DUPLICATE ROWS. At least one person has a parked row AND a filled row. The finisher is');
  console.log('  writing to the wrong one. Send this output over — the fix is in the matcher, not on you.');
} else {
  console.log('  The parked rows are real and have no duplicate. They are simply not finished yet:');
  console.log('  the reason on each row above says why, and "the office PC has not" is not one of them');
  console.log('  if this list is short. Run scripts\\fill-pending.cmd and watch which of these move.');
}
