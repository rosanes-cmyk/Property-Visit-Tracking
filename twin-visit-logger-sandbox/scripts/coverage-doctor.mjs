/**
 * Which leads is the 20-minute re-check ACTUALLY reaching?
 *
 *   node scripts/coverage-doctor.mjs
 *   node scripts/coverage-doctor.mjs --hours 48     look further ahead in the simulation
 *
 * READ-ONLY. No browser, no lock, nothing written — to the sheet, to REI, or to Chat. Safe at any time.
 * It prints row numbers, ages and counts. It never prints a seller name, address, phone or email.
 *
 * WHY IT EXISTS. The re-check's own banner says how many rows it COULD ever look at ("156 of 418"), and
 * the health check says the job RAN. Neither says which leads were actually read, and the two together
 * read as full coverage. They are not the same claim.
 *
 * `pickRecheckCandidates` sorts by urgency and takes the top 20. The urgency terms are deliberately in
 * separated magnitudes (src/rei/recheck.mjs:394-401):
 *
 *     Opportunity Priority x 10,000     up to 1,000,000
 *     stage weight x 100                up to       600
 *     how long it has waited            up to        99   <-- capped
 *
 * Waiting is capped at 98 (99 if never checked). So staleness can NEVER promote a lead past one with a
 * strictly higher Opportunity Priority, and there is no fairness floor — contrast sweep-parked.mjs, which
 * sorts oldest-checked-first on purpose "so the rotation is fair and every parked lead comes round".
 *
 * Whether that starves anything depends entirely on the shape of the Opportunity Priority column:
 *
 *   - blank or all-equal        -> every term ties, `waited` decides, nothing starves
 *   - a few coarse tiers        -> the tiers rotate, nothing starves
 *   - many distinct values      -> the top ~2x the per-run cap rotate and the rest never come round
 *
 * Only the workbook can say which of those is true, which is why this reads it rather than guessing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import {
  pickRecheckCandidates, recheckSkipReason, recheckKey,
  RECHECK_PER_RUN, RECHECK_MINUTES
} from '../src/rei/recheck.mjs';

const args = process.argv.slice(2);
const numArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const HOURS = numArg('--hours', 24);
/* Measured, not assumed: recheck.mjs:250 puts a 20-lead run at five to eight minutes of browser time. */
const SECONDS_PER_LEAD = numArg('--seconds-per-lead', 20);

const text = (v) => String(v ?? '').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
const rows = grid.slice(1)
  .map((values, i) => {
    const row = { __rowNumber: i + 2 };
    headers.forEach((h, c) => { if (h) row[h] = values[c]; });
    return row;
  })
  .filter((r) => headers.some((h) => h && text(r[h])));

console.log(`Workbook tab "${config.trackerSheet}" — ${plural(rows.length, 'row', 'rows')}.`);
console.log('');

/*
 * The re-check drops rows with a blank Property Address BEFORE it counts anything (recheck-rei.mjs:207),
 * so such a row appears in no tally and no skip reason — it is simply absent from the denominator. Count
 * it here, because an invisible row is the one nobody goes looking for.
 */
const addressless = rows.filter((r) => !text(r['Property Address']));
const visible = rows.filter((r) => text(r['Property Address']));

const skipped = new Map();
const eligible = [];
for (const row of visible) {
  const reason = recheckSkipReason(row);
  if (reason) skipped.set(reason, (skipped.get(reason) || 0) + 1);
  else eligible.push(row);
}

console.log('WHAT THE 20-MINUTE RE-CHECK CAN SEE');
for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} skipped — ${reason}`);
}
if (addressless.length) {
  console.log(`  ${String(addressless.length).padStart(4)} INVISIBLE — blank Property Address, so the re-check`);
  console.log('       drops them before counting and reports them as neither eligible nor skipped.');
  console.log(`       Rows: ${addressless.map((r) => r.__rowNumber).join(', ')}`);
}
console.log(`  ${String(eligible.length).padStart(4)} eligible to be re-checked`);
console.log('');

/* ---- the shape of Opportunity Priority, which is what decides whether anything starves ---- */
const priorityOf = (row) => Number(String(row['Opportunity Priority'] ?? '').replace(/[^\d.]/g, '')) || 0;
const priorities = eligible.map(priorityOf);
const distinct = new Set(priorities);
const blank = priorities.filter((p) => p === 0).length;

console.log('THE COLUMN THAT DECIDES THE ORDER — "Opportunity Priority"');
if (!headers.includes('Opportunity Priority')) {
  console.log('  The column is NOT in this tab, so every lead scores 0 and the order is decided by');
  console.log('  how long each has waited. That is a fair rotation — nothing can starve.');
} else {
  console.log(`  ${plural(distinct.size, 'distinct value', 'distinct values')} across ${plural(eligible.length, 'eligible lead', 'eligible leads')}` +
    (blank ? `, ${blank} of them blank or zero` : ''));
  console.log(`  Highest ${Math.max(...priorities, 0)} · lowest ${Math.min(...priorities, 0)}`);
}
console.log('');

/* ---- what has actually been read, from the re-check's own state file ---- */
const STATE_FILE = path.resolve('./data/rei-recheck.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; }

const now = new Date();
const ageHours = (row) => {
  const iso = state[recheckKey(row)]?.lastCheckedAt;
  if (!iso) return Infinity;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? Infinity : (now.getTime() - t.getTime()) / 3600000;
};

if (!Object.keys(state).length) {
  console.log('WHAT HAS ACTUALLY BEEN READ');
  console.log(`  No record yet at ${STATE_FILE} — this PC has not completed a re-check, so there is`);
  console.log('  nothing to measure. Run one and come back.');
} else {
  const ages = eligible.map(ageHours);
  const never = ages.filter((h) => h === Infinity).length;
  const band = (lo, hi) => ages.filter((h) => h !== Infinity && h >= lo && h < hi).length;
  const oldest = ages.filter((h) => h !== Infinity).sort((a, b) => b - a)[0] || 0;

  console.log('WHAT HAS ACTUALLY BEEN READ');
  console.log(`  ${String(band(0, 1)).padStart(4)} read in the last hour`);
  console.log(`  ${String(band(1, 6)).padStart(4)} read 1-6 hours ago`);
  console.log(`  ${String(band(6, 24)).padStart(4)} read 6-24 hours ago`);
  console.log(`  ${String(band(24, Infinity)).padStart(4)} read more than a DAY ago`);
  console.log(`  ${String(never).padStart(4)} NEVER read on this PC`);
  if (oldest) console.log(`  Oldest re-check: ${oldest.toFixed(1)} hours ago.`);
}
console.log('');

/* ---- run the real picker forward, so the answer is the code's, not an argument about the code ---- */
const runs = Math.round((HOURS * 60) / RECHECK_MINUTES);
const sim = {};
for (const key of Object.keys(state)) sim[key] = { ...state[key] };
const seen = new Map();
let clock = now.getTime();

for (let r = 0; r < runs; r += 1) {
  const picked = pickRecheckCandidates(eligible, sim, { now: new Date(clock) });
  picked.forEach((row, i) => {
    const key = recheckKey(row);
    /*
     * Stamped per lead DURING the run (recheck-rei.mjs:775), not at the start. That gap is why the top
     * TWO runs' worth rotate rather than the top one: a lead read 20 minutes ago plus browse time is
     * still inside the 20-minute window at the next run and sits it out.
     */
    sim[key] = { lastCheckedAt: new Date(clock + (i + 1) * SECONDS_PER_LEAD * 1000).toISOString() };
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  clock += RECHECK_MINUTES * 60 * 1000;
}

const starved = eligible.filter((row) => !seen.has(recheckKey(row)));

console.log(`WHAT THE NEXT ${HOURS} HOURS WOULD COVER`);
console.log(`  (${runs} runs of ${RECHECK_PER_RUN} leads, using the real pickRecheckCandidates)`);
console.log(`  ${String(eligible.length - starved.length).padStart(4)} of ${eligible.length} eligible leads would be read at least once`);
console.log(`  ${String(starved.length).padStart(4)} would NOT be read at all`);

if (starved.length) {
  const worst = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log('');
  console.log(`  The busiest lead would be read ${worst[1]} times while those ${starved.length} are read none.`);
  console.log('  This is the capped-ageing effect: waiting is worth at most 99 points and priority is');
  console.log('  worth up to 1,000,000, so a lower-ranked lead can never age its way into a slot.');
  console.log('');
  console.log(`  Rows never reached: ${starved.slice(0, 40).map((r) => r.__rowNumber).join(', ')}` +
    (starved.length > 40 ? `, and ${starved.length - 40} more` : ''));
  console.log('');
  console.log('  WHAT STILL COVERS THEM, so this is a gap and not a blackout:');
  console.log('    - the hourly bucket sweep reads work-queue leads directly, ignoring this ordering');
  console.log('    - a full sweep by hand reads everything:');
  console.log('        node scripts/recheck-rei.mjs --limit 400 --wait --yes');
} else {
  console.log('');
  console.log('  Every eligible lead comes round. Nothing starves on this sheet.');
}
