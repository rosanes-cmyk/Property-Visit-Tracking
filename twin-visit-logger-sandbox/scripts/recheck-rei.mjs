/**
 * Go back to REI for leads already in the tracker, and bring the sheet and the calendar up to date.
 *
 *   node scripts/recheck-rei.mjs                 <- dry run: says what it WOULD change
 *   node scripts/recheck-rei.mjs --yes           <- applies it
 *   node scripts/recheck-rei.mjs --limit 10      <- more per run (default 5)
 *   node scripts/recheck-rei.mjs --only "Jose"   <- one lead, matched on seller or address
 *
 * Why this exists: the chain was one-way. A booking email arrived, REI was read once, the row and the
 * calendar event were written, and nothing ever looked again — so a visit completed, cancelled or moved
 * inside REI never reached the tracker. The client's example: "Jose Anguiano · OVERDUE — visit was
 * 2026-08-01 and is still marked Scheduled … you will check it time to time the update in rei and then
 * update in the dashboard, it should be accurate."
 *
 * What it will and will not do:
 *   - REI is READ ONLY here. It opens the contact page and clicks nothing. (The one REI write this
 *     project can make, closing a booked-appointment task, lives in src/rei/tasks.mjs and is not used.)
 *   - Only six columns can be changed: Visit Date, Visit Time, Visit Status, Seller Name, Phone, Email.
 *     See RECHECKABLE in src/rei/recheck.mjs for why each of the others is excluded.
 *   - A BLANK from REI never overwrites a value. A field missing from a scrape usually means the page
 *     did not render, not that the seller has no phone number.
 *   - Bounded per run, because each lead opens a real browser page.
 *
 * The decisions all live in src/rei/recheck.mjs and are unit-tested; this file is the plumbing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { syncCalendarEvent } from '../src/google/calendar.mjs';
import { notifyChat } from '../src/utils/notify.mjs';
import {
  pickRecheckCandidates, recheckKey, recheckSkipReason, reiFieldsFromScrape,
  diffFromRei, calendarAffected, describeChanges, RECHECKABLE
} from '../src/rei/recheck.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const numArg = (name, fallback) => {
  const i = args.indexOf(name);
  const n = i >= 0 ? Number.parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const LIMIT = numArg('--limit', 5);
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? String(args[i + 1] || '').toLowerCase() : ''; })();

const STATE_FILE = path.resolve('./data/rei-recheck.json');

/*
 * When each lead was last asked about lives in a local file, not a sheet column.
 *
 * Adding a column would mean touching HEADERS, which is the one thing in this project guaranteed to
 * break something else — the live tab already carries three columns the Apps Script does not declare.
 * A state file is the same approach the WhatsApp watcher uses, and losing it costs one extra re-check
 * per lead rather than any data.
 */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return {}; }
}
async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
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

const rows = grid.slice(config.trackerHeaderRow).map((cells, i) => {
  const row = { __rowNumber: config.trackerHeaderRow + 1 + i };
  headers.forEach((h, j) => { if (h) row[h] = cells[j] === undefined ? '' : cells[j]; });
  return row;
}).filter((r) => r['Property Address']);

console.log(`${rows.length} live row(s) in the tab.`);

// Why the rest were left alone — otherwise "4 of 380" looks like a bug.
const skipTally = {};
for (const row of rows) {
  const why = recheckSkipReason(row);
  if (why) skipTally[why] = (skipTally[why] || 0) + 1;
}
for (const [why, n] of Object.entries(skipTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  skipped — ${why}`);
}
/*
 * Say plainly how little of the sheet this can ever see.
 *
 * The first run covered 4 rows out of 378 because 374 have no REI link — they are the imported history,
 * and there is no page to open for them. That is not a fault in the re-check, but leaving it as one line
 * in a tally invites the belief that the whole tracker is being kept accurate when a hundredth of it is.
 */
const eligibleCount = rows.length - Object.values(skipTally).reduce((a, b) => a + b, 0);
console.log(`\n${eligibleCount} of ${rows.length} row(s) can ever be re-checked` +
  (skipTally['no REI link'] ? ` — ${skipTally['no REI link']} have no REI link, so there is no page to open.` : '.'));

const state = await readState();
let candidates = pickRecheckCandidates(rows, state, { now: new Date(), limit: LIMIT });
if (ONLY) {
  /*
   * --only ignores the SCHEDULE, never the eligibility rules.
   *
   * It used to ignore both, so `--only "Jose"` picked four rows with no REI link and then reported four
   * failures that were entirely predictable — the run knew there was nothing to open before it opened a
   * browser. It also matched "San Jose" in the address, which is how a search for one seller returned
   * five. Seller names are tried first now, and the address only if no seller matched.
   */
  const bySeller = rows.filter((r) => String(r['Seller Name'] || '').toLowerCase().includes(ONLY));
  const matched = bySeller.length
    ? bySeller
    : rows.filter((r) => String(r['Property Address'] || '').toLowerCase().includes(ONLY));
  if (bySeller.length) console.log(`\n--only "${ONLY}" → matched ${matched.length} on seller name`);
  else console.log(`\n--only "${ONLY}" → no seller matched; matched ${matched.length} on address`);

  const eligible = [];
  for (const row of matched) {
    const why = recheckSkipReason(row);
    if (why) console.log(`    skipping ${row['Seller Name']} — ${why}`);
    else eligible.push(row);
  }
  candidates = eligible.slice(0, LIMIT);
  console.log(`--only → ${candidates.length} row(s) to check, ignoring the schedule`);
}

if (!candidates.length) {
  console.log('\nNothing is due for a re-check. Everything active was checked recently.');
  process.exit(0);
}

console.log(`\n${candidates.length} lead(s) to re-check:`);
for (const row of candidates) console.log(`  row ${row.__rowNumber}  ${row['Seller Name']} · ${row['Property Address']}`);

// launchReiContext returns the context itself; callers close it. Matches add-visit-from-rei.
const context = await launchReiContext();
const changedRows = [];
// Leads where REI never answered the question, collected so the closing summary cannot claim
// agreement over the top of them.
const unanswered = [];
try {
  for (const row of candidates) {
    const link = String(row['REI BlackBook Link']).trim();
    console.log(`\n--- row ${row.__rowNumber}  ${row['Seller Name']}`);
    let scraped;
    try {
      scraped = await scrapeReiVisit(context, link);
    } catch (error) {
      // A login expiry or a slow page must not be recorded as "checked", or the lead would go to the
      // back of the queue having been looked at not at all.
      console.log(`    could not read REI: ${error.message}`);
      continue;
    }

    const reiFields = reiFieldsFromScrape(scraped, { zone: config.calendarTimezone });
    const changes = diffFromRei(row, reiFields);
    console.log(`    ${describeChanges(row, changes, reiFields, scraped)}`);

    if (scraped.visitTaskState === 'unknown') unanswered.push({ row, reason: scraped.visitTaskReason });

    const key = recheckKey(row);
    state[key] = { ...(state[key] || {}), lastCheckedAt: new Date().toISOString() };

    if (!changes.length) continue;
    state[key].lastChangedAt = new Date().toISOString();
    changedRows.push({ row, changes, scraped });

    if (!APPLY) continue;

    // Write ONLY the changed cells, one range each. Writing the whole row would clobber every column a
    // person has edited since the row was created.
    const data = changes
      .filter((c) => colOf.has(c.field))
      .map((c) => ({
        range: `${config.trackerSheet}!${columnLetter(colOf.get(c.field) + 1)}${row.__rowNumber}`,
        values: [[c.to]]
      }));
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data }
      });
      console.log(`    wrote ${data.length} cell(s)`);
    }

    /*
     * The calendar has to follow. Moving the date in the sheet and leaving the event where it was is the
     * worst possible half-job: the row would be right and Juan would still drive on the old day.
     */
    /*
     * Tagging a cancelled event does not need an appointment time — it keeps the date the event already
     * has. Requiring appointmentStartIso here would skip the calendar for exactly the cancellations where
     * REI has dropped the appointment fields, leaving a live, reminder-firing event on Juan's day.
     */
    const cancelling = changes.some((c) => c.field === 'Visit Status' && c.to === 'Canceled');
    if (calendarAffected(changes) && (cancelling || scraped.appointmentStartIso)) {
      try {
        // Returns the event id — the SAME one when it updates in place, which is what must happen for a
        // moved visit. A second event on Juan's calendar for one property is the failure to avoid here.
        const eventId = await syncCalendarEvent(auth, scraped, row['Calendar Event ID'] || '');
        const same = eventId && eventId === String(row['Calendar Event ID'] || '');
        console.log(`    calendar: ${eventId ? (same ? 'existing event moved' : `event ${eventId}`) : 'not updated'}`);
      } catch (error) {
        console.log(`    calendar NOT updated: ${error.message}`);
      }
    }

    /*
     * Tell the team, at the moment it is found.
     *
     * A Sheets API write does NOT fire onEdit, so none of the workbook's own alerts run for anything this
     * script changes. Without this, the timer could discover that a visit was cancelled, correct the row
     * and the calendar, and nobody would know until somebody happened to look at the dashboard — which,
     * for a visit later the same day, is exactly too late. The client's ops lead asked for a cancellation
     * to "notify as well", and on this path that has to happen here.
     *
     * Only a STATUS change is announced. A corrected phone number or a tidied seller name is not news,
     * and a message per cosmetic diff every two hours is how a Chat space gets muted.
     */
    const statusChange = changes.find((c) => c.field === 'Visit Status');
    if (statusChange) {
      const when = String(row['Visit Date'] || '').trim();
      await notifyChat(
        `REI re-check: ${row['Seller Name'] || '(no name)'} · ${row['Property Address']} — visit ` +
        `${when ? `on ${when} ` : ''}is now ${statusChange.to} in REI (was "${statusChange.from || 'blank'}"). ` +
        'Tracker, dashboard and calendar updated.',
        { kind: statusChange.to === 'Canceled' ? 'warn' : 'ok' }
      );
    }
  }
} finally {
  await context.close();
  // State is written even when a lead threw, so a crash mid-run does not re-check the same three leads
  // forever while the fourth is never reached.
  await writeState(state);
}

console.log(`\n${'='.repeat(60)}`);
/*
 * The summary must not contradict the detail above it.
 *
 * The live run on Jose printed the per-lead line "REI could not tell us whether the visit happened" and
 * then, four lines later, "REI agrees with the sheet on every lead checked. Nothing to change." The
 * second is what a person skims and remembers, and it is the one that is wrong. A run that could not
 * answer the question has to close by saying so.
 */
if (unanswered.length) {
  console.log(`${unanswered.length} lead(s) could NOT be verified — REI did not say whether the visit happened:`);
  for (const { row, reason } of unanswered) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} — ${reason}`);
  }
  console.log('These rows are UNCHANGED and may still be wrong. Settle one with:');
  console.log(`  node scripts/rei-task-doctor.mjs "${unanswered[0].row['REI BlackBook Link']}"`);
  if (!changedRows.length) console.log('\nNothing else differed: dates and contact details all matched.');
}
if (!changedRows.length && !unanswered.length) {
  console.log('REI agrees with the sheet on every lead checked. Nothing to change.');
} else if (!changedRows.length) {
  // nothing to add — the unanswered block above is the whole story
} else if (APPLY) {
  console.log(`${changedRows.length} lead(s) updated from REI.`);
} else {
  console.log(`${changedRows.length} lead(s) would change. Re-run with --yes to apply:`);
  for (const { row, changes } of changedRows) console.log(`  ${describeChanges(row, changes)}`);
}
console.log(`Fields a re-check may ever touch: ${RECHECKABLE.join(', ')}`);

/** 1-based column index to an A1 letter. */
function columnLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
