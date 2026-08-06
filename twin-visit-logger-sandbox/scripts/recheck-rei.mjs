/**
 * Go back to REI for leads already in the tracker, and bring the sheet and the calendar up to date.
 *
 *   node scripts/recheck-rei.mjs                 <- dry run: says what it WOULD change
 *   node scripts/recheck-rei.mjs --yes           <- applies it
 *   node scripts/recheck-rei.mjs --limit 40      <- more per run (default 20)
 *   node scripts/recheck-rei.mjs --limit 200 --wait --yes   <- sweep everything due, queueing for REI
 *   node scripts/recheck-rei.mjs --limit 400 --wait --include-closed --yes   <- the WHOLE sheet, closed leads too
 *   node scripts/recheck-rei.mjs --only "Jose"   <- one lead, matched on seller or address
 *   node scripts/recheck-rei.mjs --only "Schatz,Thatcher,Toledo" --yes   <- several, one queue for REI
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
import { OWNER_VALUES, VISITOR_VALUES, STAGE_VALUES, DISPOSITION_VALUES } from '../src/google/owner-map.mjs';
import { closeOutRefusal, stageBehindTracker } from '../src/rei/stage-map.mjs';
import { appendAuditLog, auditLine } from '../src/google/audit-log.mjs';
import { acquireLock, acquireLockWaiting } from '../src/utils/lock.mjs';
import {
  pickRecheckCandidates, recheckKey, recheckSkipReason, reiFieldsFromScrape,
  diffFromRei, calendarAffected, describeChanges, RECHECKABLE, REI_WINS, RECHECK_PER_RUN
} from '../src/rei/recheck.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const numArg = (name, fallback) => {
  const i = args.indexOf(name);
  const n = i >= 0 ? Number.parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const LIMIT = numArg('--limit', RECHECK_PER_RUN);
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? String(args[i + 1] || '').toLowerCase() : ''; })();
/*
 * --wait, for a sweep somebody is sitting in front of.
 *
 * The client: "all of them should be checked." A whole-list sweep is `--limit 200`, and without this it stands
 * down the moment the scheduled run has the lock — which for a command you have just typed means it does
 * nothing and says so. --only already waits because it is by definition a hand-typed run; a big --limit is
 * the same situation and now says so explicitly rather than being inferred.
 */
const WAIT = args.includes('--wait');
/*
 * --include-closed: sweep the leads somebody parked, too.
 *
 * "its 378 leads … okay okay so start now, we need now all that updated." Off by default, because a closed-out
 * lead is a decision and re-reading 214 of them every twenty minutes buys nothing. Worth having as a one-off:
 * an offer made and never followed up would be sitting in exactly that pile.
 */
const INCLUDE_CLOSED = args.includes('--include-closed');

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
  const why = recheckSkipReason(row, { includeClosed: INCLUDE_CLOSED });
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
let candidates = pickRecheckCandidates(rows, state, { now: new Date(), limit: LIMIT, includeClosed: INCLUDE_CLOSED });
if (ONLY) {
  /*
   * --only ignores the SCHEDULE, never the eligibility rules.
   *
   * It used to ignore both, so `--only "Jose"` picked four rows with no REI link and then reported four
   * failures that were entirely predictable — the run knew there was nothing to open before it opened a
   * browser. It also matched "San Jose" in the address, which is how a search for one seller returned
   * five. Seller names are tried first now, and the address only if no seller matched.
   */
  /*
   * A REI contact id or URL is tried between the two.
   *
   * Comparing the tracker against one specific REI contact is the natural way to check whether the
   * automation is right, and a contact id is the one identifier that cannot match the wrong lead — unlike
   * a name, where "Jose" also finds "San Jose". Without this there was no way to say "this contact":
   * `--only "https://my.reiblackbook.com/contacts/20525007"` matched nothing at all, because the value is
   * compared against the seller name and the address and never against the link.
   */
  const TIERS = [
    ['seller name', (r) => String(r['Seller Name'] || '')],
    ['REI contact id / link', (r) => `${r['REI BlackBook Link'] || ''} ${r['REI Record ID'] || ''}`],
    ['property address', (r) => String(r['Property Address'] || '')]
  ];
  /*
   * SEVERAL names, comma-separated — because the request is usually a screenshot, not one lead.
   *
   * The client, pointing at a card of eight: "the picture only i gave it, that should be for now, not all."
   * Eight separate commands means eight separate waits for the REI lock, and the eight are one job.
   *
   *   --only "Schatz,Thatcher,Toledo"
   *
   * A single name behaves exactly as before, so nothing already documented changes. Each part is matched on
   * its own through the same tiers, and the results are merged by row number so a needle matching two rows,
   * or two needles matching one, cannot double-check a lead.
   */
  const needles = ONLY.split(',')
    .map((part) => part.trim())
    // A pasted URL is matched on its contact id, so a trailing slash or query string cannot spoil it.
    .map((part) => (part.match(/contacts\/(\d+)/) || [null, part])[1])
    .filter(Boolean);
  const byRow = new Map();
  const hitOn = [];
  const missed = [];
  for (const needle of needles) {
    let found = [];
    let on = '';
    for (const [label, read] of TIERS) {
      found = rows.filter((r) => read(r).toLowerCase().includes(needle));
      if (found.length) { on = label; break; }
    }
    if (!found.length) { missed.push(needle); continue; }
    hitOn.push(`"${needle}" → ${found.length} on ${on}`);
    for (const r of found) byRow.set(r.__rowNumber, r);
  }
  const matched = [...byRow.values()].sort((a, b) => a.__rowNumber - b.__rowNumber);
  const needle = needles.join(', ');
  /*
   * A needle that matched nothing is named individually. With one needle that was the whole story; with eight
   * it is the difference between "seven leads are queued and Chan is not in the tracker" and a bare count that
   * looks like everything was found.
   */
  if (missed.length) {
    console.log(`\n--only → NOT FOUND: ${missed.map((m) => `"${m}"`).join(', ')}`);
    console.log('  No row has that seller name, REI contact id, or address. If one of those is a REI contact');
    console.log('  you expected to be tracked, it was never logged — the booking email never arrived or never');
    console.log('  processed. Add it with:  node scripts/add-visit-from-rei.mjs "<the REI contact URL>"');
  }
  if (matched.length) {
    console.log(`\n--only matched ${matched.length} row(s): ${hitOn.join(' · ')}`);
  } else {
    /*
     * Say that the lead is not in the tracker, rather than "matched 0 on address".
     *
     * A contact id that matches nothing almost always means the lead was never logged — no booking email
     * arrived, or it arrived and failed — which is a different problem from a lead being ineligible, and
     * needs a different action.
     */
    console.log(`\n--only "${needle}" → nothing to check.`);
  }

  const eligible = [];
  for (const row of matched) {
    const why = recheckSkipReason(row, { includeClosed: INCLUDE_CLOSED });
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

/*
 * The SAME lock run-once.mjs takes, and for a concrete reason: REI kept logging the client out.
 *
 * Both this script and the 5-minute booking-email run open chromium.launchPersistentContext on the same
 * profile directory — the one holding REI's session cookies. Two Chromium processes on one profile corrupt
 * it, and the schedules guarantee a collision: the email task fires at :00 :05 :10 :15 :20 and this at :00
 * :20 :40, so they land on the same minute every twenty. Now that a run reads 20 leads and takes five to
 * eight minutes, it overlaps several.
 *
 * The cost is that the email task skips maybe a third of its runs while this holds the lock. That is
 * cheap: it runs every five minutes and the next one picks up whatever accumulated. A logged-out REI
 * stops everything until somebody notices.
 */
/*
 * A SCHEDULED run stands down; a run somebody typed WAITS.
 *
 * The two want opposite things from a busy lock. The timer fires every twenty minutes, so skipping costs
 * nothing — the next one picks up whatever accumulated. A person checking one lead has no next one, and
 * losing the race three times in a row is how this actually went. Waiting is chosen by --only, which is
 * already the flag that means "I am doing this by hand, now".
 */
const release = (ONLY || WAIT)
  ? await acquireLockWaiting('run', {
    onWait: (secondsLeft) => console.log(`  REI is busy — retrying, up to ${Math.ceil(secondsLeft / 60)} more minute(s)`)
  })
  : await acquireLock();
if (!release) {
  /*
   * The TIMEOUT message belongs to anything that waited, not only to --only.
   *
   * This was gated on ONLY, so a --wait sweep that queued for the full twelve minutes ended with "Another REI
   * run is active — skipped ... this run will be picked up by the next one" — which reads as though it never
   * tried, and points at the wrong remedy. It had tried for twelve minutes, and the real cause was a lock file
   * left behind by a run that had been Ctrl+C'd.
   */
  if (ONLY || WAIT) {
    console.log('\nREI stayed busy for 12 minutes, which is longer than any single run should take.');
    console.log('A run may have died holding the lock:');
    console.log('  type data\\run.lock        <- shows the pid that claimed it');
    console.log('  del data\\run.lock         <- only once you are sure no browser is open');
    process.exit(1);
  }
  console.log('\nAnother REI run is active — skipped, to avoid two browsers on one profile.');
  console.log('That is what was logging REI out. This run will be picked up by the next one.');
  process.exit(0);
}

// launchReiContext returns the context itself; callers close it. Matches add-visit-from-rei.
const context = await launchReiContext();
const changedRows = [];
// Leads where REI never answered the question, collected so the closing summary cannot claim
// agreement over the top of them.
const unanswered = [];
/*
 * Leads REI calls dead that the tracker has too far along to close automatically. Not failures — conflicts,
 * and each one is somebody's decision about a real deal.
 */
const closeOutConflicts = [];
/* Leads where REI's stage is BEHIND the tracker's — a disagreement about where the deal is, for a person. */
const stageConflicts = [];
/* Leads REI HAS assigned, to somebody the workbook's dropdown does not hold. Fixable by adding the name. */
const unmappedOwners = [];
// Leads REI has already written off. Reported to a person, never acted on.
const deadFlagged = [];
/*
 * What to record in the workbook's Automation Log, so "when was this last checked, and what changed?" can
 * be answered while looking at the lead rather than by opening a log file on one particular laptop.
 */
const auditRows = [];
/*
 * Leads whose page could not be read at all. Tracked separately from `unanswered`, because a failed scrape
 * is not a lead REI declined to answer about — it is a lead nothing looked at, and the run must not be
 * able to close by claiming agreement over the top of it.
 */
const failures = [];
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
      failures.push({ row, reason: error.message });
      continue;
    }

    let reiFields = reiFieldsFromScrape(scraped, { zone: config.calendarTimezone });

    /*
     * A scrape that yields NOTHING is a failure, not a quiet agreement — and it gets one second chance.
     *
     * "REI returned NOTHING to compare — no appointment date and no contact fields. The page may not have
     * rendered, or the contact has no appointment in REI." That message was honest about not knowing, and then
     * the run moved on and counted the lead as checked. So the lead went to the back of a 20-minute queue
     * having been looked at not at all, and the closing summary could still say the run was clean.
     *
     * The client, on a log full of them: "but we need to fix those asap."
     *
     * Zero fields is not a state REI can legitimately produce for a contact that exists — even a lead with no
     * appointment has a name and a phone number. So it means the page had not finished rendering. One retry
     * after a pause fixes exactly that; if the second attempt is also empty, it is recorded as unreadable,
     * which vetoes the all-clear at the end of the run.
     */
    if (!Object.keys(reiFields).length) {
      console.log('    REI returned nothing — the page may not have rendered. Retrying once…');
      await new Promise((resolve) => { setTimeout(resolve, 4000); });
      try {
        scraped = await scrapeReiVisit(context, link);
        reiFields = reiFieldsFromScrape(scraped, { zone: config.calendarTimezone });
      } catch (error) {
        console.log(`    the retry failed too: ${error.message}`);
      }
      if (!Object.keys(reiFields).length) {
        console.log('    still nothing. Recorded as UNREADABLE — this lead was NOT checked.');
        failures.push({ row, reason: 'REI returned no fields at all, twice — the page never rendered' });
        auditRows.push({ level: 'EXCEPTION', id: String(row['Property ID'] || ''),
          message: `REI page for row ${row.__rowNumber} — ${row['Seller Name'] || '(no name)'} — returned no `
            + 'fields at all on two attempts. The lead was NOT checked; nothing was written.' });
        continue;
      }
      console.log('    the retry worked — the page had not finished rendering.');
    }

    const changes = diffFromRei(row, reiFields);
    console.log(`    ${describeChanges(row, changes, reiFields, scraped)}`);

    if (scraped.visitTaskState === 'unknown') unanswered.push({ row, reason: scraped.visitTaskReason });

    /*
     * REI says dead, the tracker says nearly closed. Reported, never acted on.
     *
     * stageCloseOut refuses anything from Verbal Agreement onwards, because auto-closing a deal at contract
     * stage could bury one that is nearly done. A refusal nobody sees is the same as no guard at all — the
     * two systems disagree and nobody is told — so it is collected here and printed in the summary.
     */
    const refusal = closeOutRefusal(row['Current Stage'], reiFields['Current Stage']);
    if (refusal) {
      closeOutConflicts.push({ row, reason: refusal });
      auditRows.push({ level: 'EXCEPTION', id: String(row['Property ID'] || ''),
        message: `${row['Seller Name'] || '(no name)'} · ${row['Property Address'] || ''} — ${refusal}` });
    }

    /*
     * REI BEHIND the tracker on stage. Reported, never written — "how about the lead stage?"
     *
     * Every other field now takes REI's answer. This one cannot, because the tracker holds Contract Sent Date,
     * Contract Signed Date and Transaction Handoff Status and REI has no equivalent: a lead the tracker has at
     * Contract Signed and REI still has at Offer Sent is REI missing information, not the tracker being stale.
     * Moving it back would erase the dates that prove it.
     *
     * Reporting it is the point. If the two systems disagree about where a deal is, one of them is wrong and
     * somebody has to say which.
     */
    /*
     * REI has an owner the workbook's dropdown will not accept. Reported, because otherwise it is invisible.
     *
     * The client: "why other is unassigned?" — and there was no way to tell from the output. mapOwner returns
     * '' for a name the dropdown does not hold, the field is skipped, and a lead REI assigned to Theavil Marie
     * looked exactly like one REI had never assigned. Only one of those two is fixable, and it is fixed by
     * adding the name to the dropdown.
     */
    if (reiFields.__unmappedOwner && !text(row['Assigned Owner'])) {
      const who = reiFields.__unmappedOwner;
      console.log(`    REI assigns this to "${who}" — not a value the Assigned Owner dropdown accepts, `
        + 'so nothing was written.');
      unmappedOwners.push({ row, who });
      auditRows.push({ level: 'EXCEPTION', id: String(row['Property ID'] || ''),
        message: `${row['Seller Name'] || '(no name)'} — REI assigns this lead to "${who}", which is not a `
          + 'value the Assigned Owner dropdown holds. The lead stays Unassigned until the name is added.' });
    }

    const behind = stageBehindTracker(row['Current Stage'], reiFields['Current Stage']);
    if (behind) {
      stageConflicts.push({ row, reason: behind });
      auditRows.push({ level: 'EXCEPTION', id: String(row['Property ID'] || ''),
        message: `${row['Seller Name'] || '(no name)'} · ${row['Property Address'] || ''} — ${behind}` });
    }

    /*
     * Print the sentence a Cancelled status came from.
     *
     * The status is read out of free page text by a regex, so it CAN be wrong — the phrase allows two
     * words to intervene, which is what it takes to catch "cancelled booked appointment". Showing the
     * matched sentence means a wrong call is visible in the log instead of just quietly true in the sheet.
     */
    if (scraped.cancelPhrase) {
      console.log(`    REI says: "...${scraped.cancelPhrase}..."`);
    }
    /*
     * Dead-lead tags are REPORTED, never acted on.
     *
     * Jose's contact carried "Dead Lead", "Lost Deal" and "We're Passing" from July 20 while the tracker
     * had him at Visit Scheduled. Closing a deal out is a decision about somebody's property, the team has
     * made that call by hand throughout, and the text available is an account-update note rather than the
     * contact's live tag list — it says what was true the day it was written. So it goes to a person.
     */
    if (scraped.deadLeadTags?.length && !changes.some((c) => c.closedOut)) {
      /*
       * The wording matters, because "closing a lead out is a human decision" is no longer the whole truth.
       *
       * REI's STAGE field now does close a lead out — see stageCloseOut. Tags still do not, and David
       * Jackowitz is why: he carries Dead Lead, Lost Deal, We're Passing AND Follow up simultaneously, so his
       * tags cannot settle anything. This message was left saying nothing would ever change, which would have
       * had somebody reading the log conclude the automation had refused when in fact it had never looked at
       * the stage. It also no longer fires at all on a lead that WAS just closed out, where it would
       * contradict the line directly above it.
       */
      console.log(`    ⚠ REI has this lead tagged: ${scraped.deadLeadTags.join(', ')} — ` +
        `the tracker still says stage "${row['Current Stage'] || '(blank)'}". ` +
        "Tags alone do not close a lead out; REI's Lead Stage field would.");
      deadFlagged.push({ row, tags: scraped.deadLeadTags });
      auditRows.push({ level: 'EXCEPTION', id: String(row['Property ID'] || ''),
        message: `REI has row ${row.__rowNumber} — ${row['Seller Name'] || '(no name)'} — tagged `
          + `${scraped.deadLeadTags.join(', ')} while the tracker says stage `
          + `"${row['Current Stage'] || '(blank)'}", and REI's Lead Stage does NOT say lost or dead. `
          + 'Tags alone are not acted on — a person decides.' });
    }

    const key = recheckKey(row);
    state[key] = { ...(state[key] || {}), lastCheckedAt: new Date().toISOString() };

    if (!changes.length) continue;
    state[key].lastChangedAt = new Date().toISOString();
    changedRows.push({ row, changes, scraped });

    if (!APPLY) continue;

    // Write ONLY the changed cells, one range each. Writing the whole row would clobber every column a
    // person has edited since the row was created.
    /*
     * Refuse a value the sheet's dropdown will reject, and say so, rather than let it fail the batch.
     *
     * mapOwner already guarantees this upstream. This is the second check, in the code that actually
     * writes, because one bad cell does not fail alone — it fails every other correction in the same
     * request, silently, and with 367 leads now linked that is a whole batch of real fixes lost.
     */
    const DROPDOWN = { 'Assigned Owner': OWNER_VALUES, 'Assigned Visitor': VISITOR_VALUES,
      'Current Stage': STAGE_VALUES, 'Final Disposition': DISPOSITION_VALUES };
    const legal = changes.filter((c) => {
      const allowed = DROPDOWN[c.field];
      if (!allowed || allowed.includes(String(c.to))) return true;
      console.log(`    SKIPPED ${c.field} = "${c.to}" — not a value the sheet's dropdown accepts.`);
      console.log(`      Add it to the ${c.field} list in the workbook if that is a real person.`);
      return false;
    });

    const data = legal
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
      auditRows.push({ level: 'INFO', id: String(row['Property ID'] || ''), message: auditLine(row, legal) });
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
    /*
     * Say plainly when a gap was FILLED rather than a value corrected.
     *
     * "REI confirms ... Assigned Owner '' -> 'Juan'" reads like an overwrite. It is the opposite: the cell
     * was empty, the dashboard was flagging "Missing: Assigned Owner", and REI knew the answer all along.
     */
    const filled = changes.filter((c) => c.filledBlank);
    if (filled.length) {
      console.log(`    filled ${filled.length} empty field(s) from REI: ` +
        filled.map((c) => `${c.field} = "${c.to}"`).join(', '));
    }

    const statusChange = changes.find((c) => c.field === 'Visit Status');
    /*
     * A MOVED VISIT notifies too. This was cancel-and-complete only, and that was wrong: if REI moves a
     * visit from Friday to Monday, the row and the calendar are corrected silently and the person driving
     * there finds out by turning up on the wrong day. The calendar reminder moves with it, but a reminder
     * that quietly relocates itself is not the same as being told.
     */
    const movedChange = changes.find((c) => c.field === 'Visit Date' || c.field === 'Visit Time');
    // A gift ranks below a cancellation but above a moved date: one message per lead, most consequential first.
    const giftChange = changes.find((c) => c.field === 'Gift Status');
    const who = `${row['Seller Name'] || '(no name)'} · ${row['Property Address']}`;
    if (statusChange) {
      const when = String(row['Visit Date'] || '').trim();
      await notifyChat(
        `REI re-check: ${who} — visit ${when ? `on ${when} ` : ''}is now ${statusChange.to} in REI ` +
        `(was "${statusChange.from || 'blank'}"). Tracker, dashboard and calendar updated.`,
        { kind: statusChange.to === 'Canceled' ? 'warn' : 'ok' }
      );
    } else if (giftChange) {
      /*
       * A gift notifies too. The client asked directly: "is this will show in the web hook chat notif?"
       *
       * It did not — the alert fired only on a status change or a moved visit. But a gift going out is a
       * FOLLOW-UP action Cherry tracks a whole section of the 3pm queue for, and it is the one kind of
       * change here that somebody may need to speak to a seller about the same day. Rob Walker's was an
       * apology basket for a bad estimate; nobody should learn about that from a spreadsheet next week.
       */
      const sent = changes.find((c) => c.field === 'Gift Sent Date');
      await notifyChat(
        `REI re-check: ${who} — a GIFT is recorded in REI` +
        `${sent ? `, delivering ${sent.to}` : ''}. ` +
        `${(changes.find((c) => c.field === 'Gift Recommendation Reason') || {}).to || ''}`.trim() +
        ' Tracker and dashboard updated.',
        { kind: 'ok' }
      );
    } else if (movedChange) {
      /*
       * A moved visit updates the sheet, the dashboard and the calendar — and says NOTHING in Chat.
       *
       * The client's instruction, after seeing one: "i dont want the update for this in the chat, it will
       * confuse my teammate; as long as its updating in the dashboard its fine."
       *
       * He is right, and the alert he saw is why. It read "the visit MOVED in REI. Visit Date 2026-07-29 ->
       * 07/29/2026" — the same day written two ways, because the comparison was a raw string test. So the
       * team was being told visits had moved when nothing had. sameFieldValue now compares dates by day, and
       * the calendar event stops being rewritten every run as well.
       *
       * A genuine move still reaches everybody, through the row, the dashboard, the calendar invitation and
       * the Automation Log line below. What it no longer does is interrupt the Space. Cancellations and gifts
       * still notify, because those need a decision from a person rather than a corrected diary.
       */
      const moved = changes.filter((c) => c.field === 'Visit Date' || c.field === 'Visit Time')
        .map((c) => `${c.field} ${c.from || '(blank)'} -> ${c.to}`).join(' · ');
      console.log(`    visit moved: ${moved} — sheet, dashboard and calendar updated, no Chat message sent`);
    }
  }
  /*
   * A summary row every run, even a run that changed nothing.
   *
   * Without it, silence in the log is ambiguous: it reads the same whether the automation checked twenty
   * leads and found them all correct, or stopped running three days ago. Those need opposite reactions.
   */
  auditRows.push({ level: 'INFO', id: '',
    message: `REI re-check ${APPLY ? 'run' : 'DRY RUN'}: ${candidates.length} lead(s) read, ` +
      `${changedRows.length} updated, ${unanswered.length} unverified, ${failures.length} unreadable, ` +
      `${deadFlagged.length} tagged dead in REI. ${eligibleCount} of ${rows.length} rows are re-checkable.` });
} finally {
  await context.close();
  await release();
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
/*
 * Failures first, and they veto the all-clear.
 *
 * This run reported "REI agrees with the sheet on every lead checked. Nothing to change." after all twenty
 * leads failed with a login redirect. Nothing had been checked at all. It is the fourth time a summary in
 * this feature has claimed agreement it never verified, so a failed scrape now blocks that sentence
 * outright rather than being invisible to it.
 */
if (failures.length) {
  const loggedOut = failures.filter((f) => /login/i.test(f.reason)).length;
  console.log(`${failures.length} of ${candidates.length} lead(s) COULD NOT BE READ. Nothing was checked ` +
    'on them, and nothing about them can be concluded from this run.');
  if (loggedOut) {
    // One line, not twenty identical ones: the fix is the same for all of them.
    console.log(`\n  ${loggedOut} failed because REI is LOGGED OUT. Fix it with:`);
    console.log('      npm run login:rei');
    console.log('  Sign in, close the window, and the timers pick the session up. Nothing is corrupted —');
    console.log('  a failed lead is not recorded as checked, so it goes straight back to the front.');
  }
  for (const f of failures.filter((x) => !/login/i.test(x.reason)).slice(0, 5)) {
    console.log(`  row ${f.row.__rowNumber}  ${f.row['Seller Name'] || '(no name)'} — ${f.reason}`);
  }
}

if (unmappedOwners.length) {
  /*
   * Grouped by NAME rather than listed per lead. "Theavil Marie — 34 leads" is one dropdown edit; the same
   * thing as 34 separate lines reads like 34 problems.
   */
  const byName = new Map();
  for (const { row, who } of unmappedOwners) {
    if (!byName.has(who)) byName.set(who, []);
    byName.get(who).push(row.__rowNumber);
  }
  console.log(`\n${unmappedOwners.length} lead(s) are Unassigned only because REI's owner is not in the dropdown:`);
  for (const [who, rows] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${who}" — ${rows.length} lead(s), rows ${rows.slice(0, 8).join(', ')}`
      + (rows.length > 8 ? ` and ${rows.length - 8} more` : ''));
  }
  console.log('Add the name to the Assigned Owner dropdown in the workbook, tell me, and they fill themselves.');
}

if (stageConflicts.length) {
  console.log(`\n${stageConflicts.length} lead(s) where REI's stage is BEHIND the tracker:`);
  for (const { row, reason } of stageConflicts) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} — ${reason}`);
  }
  console.log('Nothing was changed. Either advance the stage in REI, or correct it on the dashboard.');
}

if (closeOutConflicts.length) {
  console.log(`\n${closeOutConflicts.length} lead(s) REI calls DEAD that the tracker has further along:`);
  for (const { row, reason } of closeOutConflicts) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} — ${reason}`);
  }
  console.log('Nothing was changed on these. Close them out on the dashboard, or move them on in REI.');
  console.log('They are logged as EXCEPTION in the workbook\'s "Automation Log" tab.');
}

if (!changedRows.length && !unanswered.length && !failures.length) {
  console.log('REI agrees with the sheet on every lead checked. Nothing to change.');
} else if (!changedRows.length) {
  // nothing to add — the unanswered block above is the whole story
} else if (APPLY) {
  console.log(`${changedRows.length} lead(s) updated from REI.`);
} else {
  console.log(`${changedRows.length} lead(s) would change. Re-run with --yes to apply:`);
  for (const { row, changes } of changedRows) console.log(`  ${describeChanges(row, changes)}`);
}
if (deadFlagged.length) {
  console.log(`\n${deadFlagged.length} lead(s) REI has tagged as dead while the tracker still shows them active:`);
  for (const { row, tags } of deadFlagged) {
    console.log(`  row ${row.__rowNumber}  ${row['Seller Name'] || '(no name)'} — ${tags.join(', ')} ` +
      `(stage "${row['Current Stage'] || '(blank)'}")`);
  }
  console.log('Set these to "Lost / Closed Out" on the dashboard if that is right. Not done automatically.');
}
/*
 * The footer has to list what the run can ACTUALLY change.
 *
 * It printed only RECHECKABLE, directly underneath a run that had just changed Current Stage, Approved
 * Offer Amount and Next Action. A closing line that contradicts the evidence above it is worse than no
 * line at all, and it is the fourth time in this feature that a summary has understated what happened.
 */
/*
 * This footer has to say what the run can ACTUALLY do, and what it can do changed today. It previously read
 * "fill only when empty" and "Assigned Owner/Visitor once named" is never touched — both untrue now, and a
 * closing summary that contradicts the run above it is the failure this footer exists to prevent.
 */
console.log(`REI wins on: ${[...RECHECKABLE, ...REI_WINS].join(', ')}`);
console.log('A BLANK from REI never overwrites anything — a missing field means the page did not render.');
console.log('Current Stage: FORWARD only, or to Lost / Closed Out when REI says the lead is dead.');
console.log('Never touched: Visit Notes, Seller Motivation, Seller Timeline, Asking Price, Seller Concerns.');
console.log('Every change above is in the workbook\'s "Automation Log" with its old value, so it can be undone.');

/*
 * Written last, and only when applying. A dry run logging "here is what I would have done" would fill the
 * team's audit trail with things that never happened.
 */
if (APPLY && auditRows.length) {
  const n = await appendAuditLog(sheets, config.spreadsheetId, auditRows);
  if (n) console.log(`\nLogged ${n} line(s) to the workbook's "Automation Log" tab.`);
}

/** 1-based column index to an A1 letter. */
function columnLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
