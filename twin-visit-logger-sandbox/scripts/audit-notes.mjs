/**
 * Find leads whose own NOTES already say what happened, while their status still says Scheduled.
 *
 *   node scripts/audit-notes.mjs           <- dry run: lists every contradiction, changes nothing
 *   node scripts/audit-notes.mjs --yes     <- applies the ones it is confident about
 *   node scripts/audit-notes.mjs --limit 5 <- only the first N (default: all)
 *
 * Why this exists, in the client's words: "as you see in the dashboard its not the same in the rei that
 * already updated at all by my colleagues."
 *
 * He was right, and the reason was not REI. His own tracker already held the answers. On one screen:
 *
 *   Lili          card: Visit Scheduled / OVERDUE    note: "Cancelled the property visit - spoke to her
 *                                                           first about the price range"
 *   Henry Watson  card: Visit Scheduled / Stalled     note: "Lead is no show, continue to engage with him"
 *
 * The team records outcomes in notes. REI notes are scraped into the row. And nothing ever read them, so
 * six leads sat in "Upcoming Visit — confirm the visit is going ahead" for visits that were over.
 *
 * This is the counterpart to recheck-rei.mjs and covers what that cannot: no browser, no REI login, no REI
 * link needed, so it sees all 378 rows rather than the 4 with a REI page.
 *
 * What it will and will not write:
 *   - Visit Status only, and only onto a row that currently says 'Scheduled' or nothing. A status somebody
 *     already set is never overwritten — if the notes disagree with it, that is reported for a person.
 *   - The one guarded stage move, Visit Scheduled -> Visit Completed — Needs Review, matching what the
 *     workbook does itself when a person sets Visit Status to Completed.
 *   - Never Visit Notes, Current Stage beyond that one move, money, owners or next actions.
 *   - Every change prints the sentence it came from. A status inferred from prose must be auditable.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { notifyChat } from '../src/utils/notify.mjs';
import { visitOutcomeFromNotes } from '../src/rei/cancel-signal.mjs';
import { STAGE_ADVANCE_FROM, STAGE_ON_COMPLETION } from '../src/rei/recheck.mjs';
import { haltForPause } from '../src/utils/paused.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  const n = i >= 0 ? Number.parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : Infinity;
})();

/*
 * Every column a colleague might have typed an outcome into.
 *
 * Visit Notes is where it belongs, but REI's own notes land in Automation Note and the visible card text
 * on the dashboard is drawn from several of these. Reading one column would have missed Lili, whose
 * cancellation arrived through the REI note sync rather than being typed by hand.
 */
const NOTE_COLUMNS = ['Visit Notes', 'Automation Note', 'Latest Activity', 'Next Action', 'Seller Motivation'];

/*
 * Paused before anything is read or written.
 *
 * This one writes Visit Status and Current Stage from the tracker's own note columns, hourly, on a schedule
 * — and it was the only auto-update with no pause on it, so a paused system was still moving stages. The
 * client asked to stop "the check in REI auto update", and this is that, done from the sheet side.
 */
if (haltForPause({ force: args.includes('--force') })) process.exit(0);

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

const rows = grid.slice(config.trackerHeaderRow).map((cells, i) => {
  const row = { __rowNumber: config.trackerHeaderRow + 1 + i };
  headers.forEach((h, j) => { if (h) row[h] = cells[j] === undefined ? '' : cells[j]; });
  return row;
}).filter((r) => r['Property Address']);

const text = (v) => String(v == null ? '' : v).trim();
console.log(`${rows.length} live row(s). Reading: ${NOTE_COLUMNS.filter((c) => colOf.has(c)).join(', ')}\n`);

const willChange = [];
const conflicts = [];
let noEvidence = 0;

for (const row of rows) {
  const notes = NOTE_COLUMNS.filter((c) => colOf.has(c)).map((c) => text(row[c])).filter(Boolean).join(' · ');
  const found = visitOutcomeFromNotes(notes);
  if (!found.status) { noEvidence += 1; continue; }

  const current = text(row['Visit Status']);
  if (current === found.status) continue;      // already agrees — nothing to do

  /*
   * A status a person already set is never overwritten.
   *
   * If the notes read "cancelled" and somebody has since marked the visit Completed, the note is probably
   * older than the decision — and even if it is not, a regex over prose does not get to overrule a human.
   * It is reported instead, which is the whole point: somebody looks.
   */
  if (current && current !== 'Scheduled') {
    conflicts.push({ row, found, current });
    continue;
  }
  willChange.push({ row, found, current });
}

console.log(`${noEvidence} row(s) say nothing about an outcome — left alone.\n`);

if (!willChange.length && !conflicts.length) {
  console.log('No lead\'s notes contradict its status. The board matches what the team has written down.');
  process.exit(0);
}

if (willChange.length) {
  console.log(`${'='.repeat(70)}\n${willChange.length} lead(s) whose notes say the visit is OVER while the row still says Scheduled:\n`);
  for (const { row, found, current } of willChange) {
    const stageMove = found.status === 'Completed' && text(row['Current Stage']) === STAGE_ADVANCE_FROM;
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} · ${row['Property Address']}`);
    console.log(`      Visit Status  "${current || '(blank)'}" -> "${found.status}"   (${found.kind})`);
    if (stageMove) console.log(`      Current Stage "${STAGE_ADVANCE_FROM}" -> "${STAGE_ON_COMPLETION}"`);
    // The evidence, always. A status inferred from prose that cannot be traced back to a sentence is not
    // something anyone should have to take on trust.
    console.log(`      because: "...${found.phrase}..."`);
  }
}

if (conflicts.length) {
  console.log(`\n${'='.repeat(70)}\n${conflicts.length} lead(s) where the notes and a HUMAN-SET status disagree — not touched:\n`);
  for (const { row, found, current } of conflicts) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} — row says "${current}", ` +
      `notes say "${found.status}" (${found.kind})`);
    console.log(`      because: "...${found.phrase}..."`);
  }
  console.log('\nThese need a person to decide. The automation does not overrule a status somebody set.');
}

if (!APPLY) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Nothing was written. Re-run with --yes to apply the ${willChange.length} change(s) above.`);
  process.exit(0);
}

/*
 * Write only the cells that change, one range each.
 *
 * The same rule as the REI re-check: writing whole rows would clobber every column a person has edited
 * since the row was created.
 */
const data = [];
for (const { row, found } of willChange.slice(0, LIMIT)) {
  const cell = (header, value) => ({
    range: `${config.trackerSheet}!${columnLetter(colOf.get(header) + 1)}${row.__rowNumber}`,
    values: [[value]]
  });
  data.push(cell('Visit Status', found.status));
  if (found.status === 'Completed' && text(row['Current Stage']) === STAGE_ADVANCE_FROM
      && colOf.has('Current Stage')) {
    data.push(cell('Current Stage', STAGE_ON_COMPLETION));
  }
}

if (data.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  console.log(`\nWrote ${data.length} cell(s) across ${Math.min(willChange.length, LIMIT)} lead(s).`);
}

/*
 * One summary message, not one per lead.
 *
 * A first run over a backlog could touch dozens of rows, and dozens of Chat messages in a burst is how a
 * space gets muted — which would then hide the single live cancellation this all exists to surface.
 */
const applied = willChange.slice(0, LIMIT);
if (applied.length) {
  const lines = applied.slice(0, 8)
    .map(({ row, found }) => `• ${row['Seller Name'] || '(no name)'} — ${found.status} (${found.kind})`);
  await notifyChat(
    `Notes audit: ${applied.length} lead(s) had an outcome written in their notes while the row still said ` +
    `Scheduled. Status corrected on the tracker and dashboard:\n${lines.join('\n')}` +
    (applied.length > 8 ? `\n…and ${applied.length - 8} more` : '') +
    (conflicts.length ? `\n\n${conflicts.length} more disagree with a status somebody set — left for a person.` : ''),
    { kind: 'warn' }
  );
}

/** 1-based column index to an A1 letter. */
function columnLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
