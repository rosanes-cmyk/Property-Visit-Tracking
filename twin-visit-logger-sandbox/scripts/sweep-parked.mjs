/**
 * Check the leads somebody parked, slowly, and REPORT the ones that look alive again.
 *
 *   node scripts/sweep-parked.mjs                 40 leads, oldest-checked first
 *   node scripts/sweep-parked.mjs --limit 10      a smaller bite
 *   node scripts/sweep-parked.mjs --only "Ruiz"   one lead, now
 *
 * WHY THIS EXISTS
 *
 * The client asked whether Lost / Closed Out and Long-Term Nurture should join the ordinary auto-check, and
 * asked twice for a straight answer. The straight answer is that both extremes are wrong.
 *
 * Adding them to the 20-minute rotation would roughly DOUBLE REI page loads — and REI page volume is exactly
 * what has been logging this account out all along. It would also starve the jobs that matter: a real booking
 * typed on the board already waits behind the sweeps, and putting 214 mostly-dead leads in front of it makes
 * that worse for no gain on most days.
 *
 * But never re-reading them is also wrong, in two specific ways:
 *
 *   Long-Term Nurture is DEFINED as "check back later". A bucket you never check back on is a bucket that
 *   does nothing.
 *
 *   Closed leads come back. Somebody reopens one in REI, the stage moves off dead, and the tracker says Lost
 *   for ever. That is a live deal disappearing quietly, which is the most expensive kind of failure here.
 *
 * So: a slow clock with a hard cap. Once a day, forty leads, oldest-checked first, which brings every parked
 * lead round about weekly for roughly twenty minutes of browser time a day. Bounded and predictable.
 *
 * IT WRITES NOTHING. NOT ONE CELL.
 *
 * That is the important design decision, not a limitation. Moving a lead OUT of Lost / Closed Out is a
 * business judgement — the project's own rule is that Current Stage belongs to the team — and `stageAdvance`
 * already refuses to drag a closed lead back into the pipeline on REI's say-so. Automating the un-close would
 * be the automation overruling a decision a person made, which is precisely the thing that got a colleague
 * blamed once already.
 *
 * So it tells you, and you decide. Finding out within a week instead of never is the whole value.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { mapReiStage, reiSaysLost } from '../src/rei/stage-map.mjs';
import { notifyChat } from '../src/utils/notify.mjs';
import { acquireLock } from '../src/utils/lock.mjs';
import { bookingIsWaiting } from '../src/utils/priority.mjs';
import { haltForPause } from '../src/utils/paused.mjs';
import { haltIfNotActiveMachine } from '../src/google/agent-settings.mjs';
import { beginJob, updateJob, endJob, recordActivity } from '../src/utils/heartbeat.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  const n = i >= 0 ? Number.parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 40;
})();
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? String(args[i + 1] || '').toLowerCase() : ''; })();

const text = (v) => String(v == null ? '' : v).trim();

/* The stages this sweep is FOR — the two a person deliberately parked. Nothing else belongs here: every
 * other stage is already covered, more often, by the ordinary re-check. */
const PARKED = ['Lost / Closed Out', 'Long-Term Nurture'];

/*
 * When each parked lead was last looked at. Its own file, separate from the ordinary re-check's state, so
 * this slow rotation cannot be knocked out of order by the fast one and vice versa.
 */
const STATE_FILE = path.resolve('./data/parked-sweep.json');
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return {}; }
}
async function writeState(s) {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
  } catch { /* bookkeeping must not fail the sweep */ }
}

if (haltForPause({ force: args.includes('--force') })) process.exit(0);

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });
if (await haltIfNotActiveMachine(sheets, config.spreadsheetId)) process.exit(0);

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `${config.trackerSheet}!A1:CZ`,
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'FORMATTED_STRING'
});
const grid = res.data.values || [];
const headers = (grid[0] || []).map(text);
const rows = grid.slice(1).map((cells, i) => {
  const r = { __rowNumber: 2 + i };
  headers.forEach((h, j) => { if (h) r[h] = cells[j] === undefined ? '' : cells[j]; });
  return r;
}).filter((r) => text(r['Property Address']));

let parked = rows.filter((r) =>
  PARKED.includes(text(r['Current Stage']))
  && text(r['REI BlackBook Link'])
  && text(r['Source']) !== 'TEST');

if (ONLY) parked = parked.filter((r) => `${text(r['Seller Name'])} ${text(r['Property Address'])}`.toLowerCase().includes(ONLY));

console.log(`${parked.length} parked lead(s) with a REI link.`);
if (!parked.length) { console.log('Nothing to sweep.'); process.exit(0); }

/*
 * Oldest first, so the rotation is fair and every parked lead comes round. Without this it would re-read the
 * top forty for ever and the ones further down would never be seen at all — which is the same as not running.
 */
const state = await readState();
const seenAt = (r) => state[String(r.__rowNumber)]?.at || '';
parked.sort((a, b) => (seenAt(a) < seenAt(b) ? -1 : seenAt(a) > seenAt(b) ? 1 : a.__rowNumber - b.__rowNumber));
const batch = parked.slice(0, LIMIT);
console.log(`Checking ${batch.length} of them this run (oldest checked first).\n`);

/*
 * The ordinary lock. This is the LOW-priority job of the lot, so it does NOT wait: if anything else wants
 * REI, this stands down and tries tomorrow. A weekly rotation losing one day costs nothing; a booking a
 * colleague is watching losing twenty minutes to a dead lead costs something real.
 */
const release = await acquireLock();
if (!release) {
  console.log('REI is busy. Standing down — this is the lowest-priority sweep and tomorrow will do.');
  process.exit(0);
}

const alive = [];
const failed = [];
let context;

beginJob('parked-sweep', { total: batch.length, phase: 'opening REI' });
try {
  context = await launchReiContext();
  let n = 0;
  for (const row of batch) {
    /*
     * Stand down for a booking, between leads.
     *
     * This job already refuses to WAIT for the lock, on the grounds that it is the lowest-priority sweep —
     * but it never asked the opposite question, whether something more urgent wanted the browser while it
     * already HELD it. It walks a batch of dead leads one page at a time, so a booking arriving thirty
     * seconds after it started used to queue for the whole batch. The client watched exactly that: twenty
     * minutes with a booking waiting and nothing happening.
     *
     * A weekly rotation losing a day costs nothing. A colleague watching a timer costs something real.
     */
    if (bookingIsWaiting()) {
      console.log(`\n  A booking is waiting for REI — standing down after ${n} lead(s).`);
      console.log('  These are parked leads; tomorrow will do.');
      break;
    }
    const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
    n += 1;
    updateJob({ phase: 'checking parked leads', item: who, index: n, total: batch.length });
    console.log(`--- ${who}`);

    let scraped;
    try {
      scraped = await scrapeReiVisit(context, text(row['REI BlackBook Link']));
    } catch (error) {
      console.log(`    could not read REI: ${error.message}`);
      failed.push({ row, reason: error.message });
      continue;
    }

    /* Recorded whether or not anything was found: a lead that was LOOKED at should go to the back of the
     * queue, or a page that always fails would be retried every single day for ever. */
    state[String(row.__rowNumber)] = { at: new Date().toISOString() };

    const reiStage = text(scraped.contactStage);
    if (!reiStage) { console.log('    REI gave no stage — nothing to compare'); continue; }

    /*
     * The one question this sweep asks: does REI still consider this dead?
     *
     * reiSaysLost is the same test the close-out rule uses, so the two cannot disagree about what "dead"
     * means. Anything it does NOT call lost, on a lead the tracker has parked, is worth a person's eyes.
     */
    if (reiSaysLost(reiStage)) { console.log(`    still parked in REI (${reiStage})`); continue; }

    const mapped = mapReiStage(reiStage);
    console.log(`    LOOKS ALIVE — REI says "${reiStage}"${mapped ? ` (${mapped})` : ''}`);
    alive.push({ row, reiStage, mapped });
  }
} finally {
  if (context) await context.close();
  await release();
  await writeState(state);
  const summary = `${batch.length} checked, ${alive.length} look alive again`
    + (failed.length ? `, ${failed.length} unreadable` : '');
  endJob({ summary, ok: !failed.length });
  recordActivity(`Parked-lead sweep — ${summary}.`, { kind: alive.length ? 'warn' : 'ok', job: 'parked-sweep' });
}

console.log(`\n${'='.repeat(60)}`);
if (!alive.length) {
  console.log(`All ${batch.length} are still parked in REI too. Nothing to report.`);
  process.exit(0);
}

/*
 * One message for the batch, never one per lead. Three separate notifications about dead leads coming back is
 * how a space gets muted — and this is a "look at these when you have a minute" message, not an emergency.
 */
const lines = alive.slice(0, 10).map(({ row, reiStage, mapped }) =>
  `• *${text(row['Seller Name']) || '(no name)'}* — you have _${text(row['Current Stage'])}_, `
  + `REI says *${reiStage}*${mapped ? ` (${mapped})` : ''}`);

await notifyChat(
  `*${alive.length} parked lead(s) look alive again in REI*\n`
  + 'These are marked Lost / Closed Out or Long-Term Nurture on the board, but REI no longer says so.\n'
  + 'Nothing has been changed — have a look and decide.\n\n'
  + lines.join('\n')
  + (alive.length > 10 ? `\n…and ${alive.length - 10} more` : ''),
  { kind: 'warn' }
);
console.log(`Reported ${alive.length} to Chat. Nothing was written to the tracker.`);
