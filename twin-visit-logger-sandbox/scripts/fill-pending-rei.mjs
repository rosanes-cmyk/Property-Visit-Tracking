/**
 * Finish the rows a colleague started on the board.
 *
 *   node scripts/fill-pending-rei.mjs            <- DRY RUN. Says what it would fill in, changes nothing.
 *   node scripts/fill-pending-rei.mjs --yes      <- writes
 *
 * The client's ask, having watched the automation wait on REI's notification email: "instead of waiting
 * in the email... just add the number and then the name of the seller and date and it will do automatic,
 * and my teammate can access it as well [on] the dashboard."
 *
 * So the board's "+ Add property" no longer demands an address. A colleague types the three things they
 * already have in front of them — phone, seller, date — and the row is parked with the address column
 * reading "PENDING REI LOOKUP — (650) 620-4017". Apps Script cannot go any further than that: it has no
 * browser, so it cannot open REI. This script is the half that can.
 *
 * It is the SAME pipeline as a booking email, minus Gmail: find the contact in REI by phone (or by the
 * link, if one was given), scrape it read-only, update the row that already exists, and put the visit on
 * Juan's calendar. Nothing new is invented here — an address the colleague did not have comes from REI or
 * the row stays parked and says why.
 *
 * Safety, unchanged from every other path:
 *   - REI is read-only. The scraper opens Notes/Tasks/Property and clicks nothing that writes.
 *   - No calendar event without a real address AND a real appointment time.
 *   - The EXISTING row is updated in place. Nothing is appended, so a colleague's row cannot become two.
 *   - A row it cannot resolve keeps its placeholder and gets a reason written into Exception Reason,
 *     because a silently skipped row looks exactly like a row nobody has got to yet.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { findExistingVisit, upsertVisit } from '../src/google/sheets.mjs';
import { syncCalendarEvent } from '../src/google/calendar.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';
import { claimBookingPriority, clearBookingPriority } from '../src/utils/priority.mjs';
import { haltForPause } from '../src/utils/paused.mjs';
import { buildDescription } from '../src/google/calendar.mjs';
import { briefingFromDescription } from '../src/whatsapp/note.mjs';
import { notifyChat } from '../src/utils/notify.mjs';
import { readTasks, pickTaskForVisit, completeTask } from '../src/rei/tasks.mjs';
import { shouldCompleteTask } from '../src/rei/task-gate.mjs';
import fsp from 'node:fs/promises';
import { DateTime } from 'luxon';
import { haltIfNotActiveMachine } from '../src/google/agent-settings.mjs';
import { beginJob, updateJob, endJob, recordActivity } from '../src/utils/heartbeat.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const FORCE = args.includes('--force');
/*
 * --scheduled: this run came from the 2-minute timer, not from a person.
 *
 * The two want very different things from a busy lock, and I had them both on the long wait. The timer
 * fires every 120 seconds while the wait ran for 12 MINUTES, so up to six copies queued at once, each
 * printing "REI is busy" every five seconds and each finally exiting 1 — which Task Scheduler records as
 * a failed task and status.cmd reports as a problem. Hundreds of lines of noise describing a system that
 * was working correctly.
 *
 * A scheduled run has a successor 120 seconds away, so standing down costs nothing. A run somebody TYPED
 * has no successor, which is why that one still waits the full twelve minutes.
 */
const SCHEDULED = args.includes('--scheduled');

/*
 * Must match PENDING_REI_PREFIX in apps-script/WebApp.gs. If the two ever disagree, rows sit on the board
 * forever looking like finished records with a strange address, and nothing reports it — so the check
 * below fails loudly on startup instead.
 */
const PENDING_PREFIX = 'PENDING REI LOOKUP —';

/*
 * NO SINGLE LEAD MAY HOLD THE QUEUE.
 *
 * The client watched one contact sit for fifteen minutes with nothing on screen, and the booking behind it
 * was never looked at. The cause was found and fixed one layer down (expandTruncatedText could spend
 * minutes clicking elements that were never clickable), but the shape of that failure is the point: an
 * unbounded step anywhere inside the scrape stalls every booking after it, and the log shows nothing at all
 * because the last line printed was a success.
 *
 * So the whole per-lead scrape gets a wall clock. This is a backstop, not the fix — the inner budgets are
 * the fix — and it exists because the next unbounded step will be somewhere I have not thought of.
 *
 * Four minutes: a slow REI page legitimately takes 60-90 seconds with the notes tab and its retries, so
 * this is generous enough never to cut short a run that is genuinely working, and short enough that a
 * stall costs one lead rather than a morning. The row is left parked and picked up on the next pass.
 *
 * The abandoned scrape's page is left to the context close. Racing it means we stop WAITING for it, not
 * that it stops — and forcing a page closed underneath a running scrape is how you turn a stall into a
 * crash that loses the leads already done.
 */
const LEAD_BUDGET_MS = 4 * 60 * 1000;

function withLeadBudget(promise, who, ms = LEAD_BUDGET_MS) {
  let timer;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `gave up after ${Math.round(ms / 60000)} minutes on this contact - REI never finished responding. `
      + `The row stays parked and the next run will try it again, so the other bookings can carry on.`
    )), ms);
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}


/*
 * Paused before anything is opened or read. This is an auto-update of already-tracked leads — the exact
 * class of job the pause switch exists for — even though the row it finishes was typed by a person.
 */
if (haltForPause({ force: FORCE })) process.exit(0);

function text(value) {
  return String(value == null ? '' : value).trim();
}

/*
 * The date and time a colleague typed on the board, as an ISO instant — or '' when they cannot be read.
 *
 * Used only when REI holds no appointment of its own, which is the ordinary case for a booking typed in
 * before REI knows about it.
 *
 * Both cells arrive as DISPLAY strings, so the format depends on how that column happens to be formatted
 * in the workbook: '08/30/2026' and '2026-08-30' are both real, and the time cell can be '2:00 PM' or
 * '14:00'. The same lesson as the morning briefing, which silently posted nothing for weeks because it
 * accepted exactly one date format — so the list is broad and anything unreadable is REPORTED, never
 * skipped in silence.
 *
 * No time typed means 9:00 AM, matching maybeCreateVisitEvent_ in the workbook so the two producers cannot
 * disagree about the same booking. The caller says so on screen, because a visit silently placed at 9am is
 * the fault that was just fixed on the other side.
 */
const TYPED_DATE_FORMATS = ['M/d/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'M/d/yy', 'd/M/yyyy', 'LLLL d, yyyy', 'LLL d, yyyy'];
const TYPED_TIME_FORMATS = ['h:mm a', 'h:mma', 'H:mm', 'h a', 'h:mm:ss a', 'HH:mm:ss'];

function typedStart(typedDate, typedTime, zone = config.calendarTimezone) {
  const dateStr = text(typedDate);
  if (!dateStr) return '';

  let day = DateTime.fromISO(dateStr, { zone });
  if (!day.isValid) {
    for (const fmt of TYPED_DATE_FORMATS) {
      day = DateTime.fromFormat(dateStr, fmt, { zone });
      if (day.isValid) break;
    }
  }
  if (!day.isValid) return '';

  let hour = 9;
  let minute = 0;
  const timeStr = text(typedTime);
  if (timeStr) {
    let clock = null;
    for (const fmt of TYPED_TIME_FORMATS) {
      const parsed = DateTime.fromFormat(timeStr, fmt, { zone });
      if (parsed.isValid) { clock = parsed; break; }
    }
    /*
     * A time-only cell can come back from Sheets as a full date on the 1899-12-30 epoch. Only the clock
     * from it is ever used — the date always comes from the Visit Date cell.
     */
    if (!clock) {
      const asIso = DateTime.fromISO(timeStr, { zone });
      if (asIso.isValid) clock = asIso;
    }
    if (!clock) return '';           // a time was typed and could not be read: say so rather than guess 9am
    hour = clock.hour;
    minute = clock.minute;
  }

  return day.set({ hour, minute, second: 0, millisecond: 0 }).toISO();
}

/** 1 -> A, 27 -> AA. Exception Reason sits past column Z, so a single letter will not do. */
function columnLetter(index) {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/*
 * PASS 2 — backfill a missing REI BlackBook Link.
 *
 * A row with a REAL address never comes here as a parked row, and recheck.mjs refuses any row without a
 * link ("no REI link"). So a booking that arrives complete-looking falls between both jobs and is
 * permanently outside the REI sweep: no stage changes, no gift tracking, no owner corrections, no
 * cancellation detection, and nothing anywhere saying so.
 *
 * That was an edge case until the client confirmed their colleague will ALWAYS reply with the address.
 * Now it is every booking from the phone path, and manual dashboard bookings where somebody typed the
 * address have always had it too.
 *
 * BOUNDED ON PURPOSE, twice over. The 379 imported legacy rows have no link either, and each lookup is a
 * real browser page on a machine whose 2-minute board-intake job is already losing its turn to the long
 * sweeps. An unbounded version would send it browsing REI for hours and starve the job a colleague is
 * actually watching.
 *
 *   30 days  — covers every live booking and cannot reach the 2023-24 history
 *   10 a run — at roughly a minute a page, a bounded slice of one run
 *
 * A row whose Created Date cannot be read is SKIPPED, not assumed recent: touching a legacy row is the
 * worse of the two mistakes. It is logged, so "unreadable" cannot hide.
 *
 * It writes ONE cell, the link, and nothing else. Making the row visible to the sweep is the whole job —
 * the sweep itself then enriches it properly on its own schedule, with all of its own guards. A second
 * writer of the same fields is how a tracker starts disagreeing with itself.
 */
const REI_LINK_BACKFILL_DAYS = 30;
const REI_LINK_BACKFILL_MAX = 10;

/** Days since a display-string date, or null when it cannot be read. */
function daysSinceCell(raw) {
  const s = text(raw);
  if (!s) return null;
  let y, m, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (iso) { [, y, m, d] = iso; }
  else if (us) { [, m, d, y] = us; }
  else {
    const parsed = DateTime.fromJSDate(new Date(s));
    if (!parsed.isValid) return null;
    return Math.floor(DateTime.now().diff(parsed, 'days').days);
  }
  const dt = DateTime.fromObject({ year: Number(y), month: Number(m), day: Number(d) },
    { zone: config.calendarTimezone });
  if (!dt.isValid) return null;
  return Math.floor(DateTime.now().setZone(config.calendarTimezone).startOf('day').diff(dt.startOf('day'), 'days').days);
}

/** Rows that have a real address but no REI link, newest first, capped. */
function rowsNeedingReiLink(rows) {
  const out = [];
  let unreadable = 0;
  for (const r of rows) {
    const addr = text(r['Property Address']);
    if (!addr || addr.startsWith(PENDING_PREFIX)) continue;   // blank, or already PASS 1's job
    if (text(r['REI BlackBook Link'])) continue;              // never overwrite a link that exists
    if (!text(r['Phone'])) continue;                          // nothing to search REI by
    const age = daysSinceCell(r['Created Date']);
    if (age === null) { unreadable += 1; continue; }
    if (age > REI_LINK_BACKFILL_DAYS || age < 0) continue;
    out.push({ row: r, age });
  }
  out.sort((a, b) => a.age - b.age || b.row.__rowNumber - a.row.__rowNumber);
  return { rows: out.slice(0, REI_LINK_BACKFILL_MAX).map((x) => x.row), unreadable, total: out.length };
}

/** Write just the REI BlackBook Link cell. Never throws — a note about a row must not fail the run. */
async function writeReiLink(sheets, headers, row, link) {
  const col = headers.indexOf('REI BlackBook Link');
  if (col < 0) { console.log('    the tracker has no "REI BlackBook Link" column'); return false; }
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${config.trackerSheet}!${columnLetter(col + 1)}${row.__rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[link]] }
  });
  return true;
}

/** The phone or REI link a parked row was created with, taken from the row's own columns first. */
function lookupKeyFor(row) {
  const link = text(row['REI BlackBook Link']);
  if (link) return { link, phone: text(row['Phone']) };
  const phone = text(row['Phone']);
  if (phone) return { link: '', phone };
  /*
   * Last resort: the placeholder itself carries what was typed. A colleague who filled in the phone on
   * the form and nothing else still has it in the address cell, so a row is never unresolvable purely
   * because a column was cleared afterwards.
   */
  const parked = text(row['Property Address']);
  const rest = parked.startsWith(PENDING_PREFIX) ? parked.slice(PENDING_PREFIX.length).trim() : '';
  if (/^https?:\/\//i.test(rest)) return { link: rest, phone: '' };
  return { link: '', phone: rest };
}

/**
 * Put the reason a row is still parked ONTO the row, where the person waiting will see it.
 *
 * The board's card reads Exception Reason. Until now the only thing ever written there was the generic
 * "Waiting for the PC to read REI and fill in the address and details", which is true of every parked row
 * and useless on the one that is stuck for a specific reason — and the card's own guess ("check the PC is
 * switched on") sent somebody to look at the one thing that was working.
 *
 * The `[since ...]` stamp is preserved rather than rewritten: the dashboard measures the elapsed time from
 * it, so replacing it would reset the clock on a row that has been waiting a day, and a timer that restarts
 * whenever the reason is updated would hide exactly the rows that need attention most.
 *
 * Never throws. This is a message about a row; it must not be able to fail the run that is describing it.
 */
async function noteParkReason(sheets, headers, row, reason) {
  try {
    const col = headers.indexOf('Exception Reason');
    if (col < 0) return;
    const prior = text(row['Exception Reason']);
    const stamp = (/\[since [^\]]*\]/.exec(prior) || [''])[0];
    const wanted = stamp ? `${reason} ${stamp}` : reason;
    if (prior === wanted) return;                        // already says this; do not spend a write
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.trackerSheet}!${columnLetter(col + 1)}${row.__rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[wanted]] }
    });
    console.log('    wrote the reason onto the row, so the board says it too');
  } catch (error) {
    console.log(`    (could not write the reason onto the row: ${error.message})`);
  }
}

async function main() {
  console.log('Twin Visit Logger · finish the rows added on the board');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN — nothing will be written'}\n`);

  const auth = await authorizeGoogle();
  const sheets = google.sheets({ version: 'v4', auth });

  /*
   * Only the ACTIVE PC runs. This is the job with the most to lose from two of them: a colleague types a
   * booking on the board, and two machines both scrape REI for it and both write the row and the calendar
   * event — the duplicate row and duplicate event the project is built to never create.
   */
  if (await haltIfNotActiveMachine(sheets, config.spreadsheetId)) return;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.trackerSheet}!A1:CZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const grid = res.data.values || [];
  if (!grid.length) {
    console.log('The tracker tab is empty.');
    return;
  }
  const headers = grid[0].map((h) => String(h).trim());
  const rows = grid.slice(1).map((values, i) => {
    const rec = { __rowNumber: i + 2 };
    headers.forEach((h, c) => { rec[h] = values[c]; });
    return rec;
  });

  const pending = rows.filter((r) => text(r['Property Address']).startsWith(PENDING_PREFIX));

  /*
   * Worked out BEFORE the early return, or PASS 2 would only ever run on the rare occasions a parked row
   * happened to be waiting too — which on a good day is never.
   */
  const backfill = rowsNeedingReiLink(rows);
  if (backfill.unreadable) {
    console.log(`(${backfill.unreadable} row(s) skipped for the link backfill: Created Date could not be read)`);
  }

  if (!pending.length && !backfill.rows.length) {
    console.log('No rows are waiting on REI. Everything added from the board has been filled in.');
    return;
  }
  if (!pending.length) {
    console.log('No rows are waiting on REI.');
  }
  /*
   * TODAY FIRST. The client: "if the lead was added for today it should be priority... work all ASAP."
   *
   * Unsorted, this read the sheet top to bottom, so a visit booked for next month was looked up before
   * one booked for this afternoon — and each lookup is a real browser page, so the afternoon visit could
   * wait several minutes behind work that did not matter yet. Rows with no date go last: they cannot be
   * urgent, and one of them failing must not delay a visit that is hours away.
   */
  const dayKey = (r) => {
    const raw = text(r['Visit Date']);
    if (!raw) return '9999-99-99';
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
    if (us) return `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
    return '9999-99-99';
  };
  pending.sort((a, b) => (dayKey(a) < dayKey(b) ? -1 : dayKey(a) > dayKey(b) ? 1 : a.__rowNumber - b.__rowNumber));

  if (pending.length) {
    console.log(`${pending.length} row(s) added on the board and waiting on REI, soonest visit first:`);
    for (const r of pending) {
      console.log(`  row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} · ${text(r['Property Address'])}`);
    }
    console.log('');
  }
  if (backfill.rows.length) {
    console.log(`${backfill.rows.length} row(s) need their REI link filled in` +
      (backfill.total > backfill.rows.length
        ? ` (${backfill.total} in the last ${REI_LINK_BACKFILL_DAYS} days; doing ${REI_LINK_BACKFILL_MAX} this run)`
        : '') + ':');
    for (const r of backfill.rows) {
      console.log(`  row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} · ${text(r['Phone'])}`);
    }
    console.log('');
  }

  /*
   * One browser profile, one lock. This waits rather than standing down: it runs on a timer, but the row
   * it finishes is one a colleague is watching on the board, so "skipped, try again in ten minutes" is a
   * person staring at a record that never completes.
   */
  /*
   * A scheduled run waits 90 seconds — comfortably inside its own 2-minute period, so copies cannot stack
   * — and a typed one waits the full twelve, because nothing is coming after it.
   */
  /*
   * Say a booking is queueing BEFORE waiting for the lock, so a sweep already holding the browser can
   * finish its current lead and stand down instead of making this wait out the whole run. Claimed only
   * when there is real work: an empty run must never make sweeps yield to nothing.
   */
  claimBookingPriority(`${pending.length} booking(s), ${backfill.rows.length} link(s)`);

  let lastSaid = 0;
  const release = await acquireLockWaiting('run', {
    timeoutMs: SCHEDULED ? 90 * 1000 : 12 * 60 * 1000,
    onWait: (secondsLeft) => {
      // Once every 30s rather than every 5s. The old rate said nothing new and buried the real output.
      if (Date.now() - lastSaid < 30000) return;
      lastSaid = Date.now();
      console.log(`  REI is busy — waiting, up to ${Math.ceil(secondsLeft / 60)} more minute(s)`);
    }
  });
  if (!release) {
    clearBookingPriority();
    if (SCHEDULED) {
      /*
       * Exit 0, deliberately. This is not a failure: REI was busy and the next run is two minutes away.
       * Exiting 1 made Task Scheduler record a failed task and status.cmd report a problem, which trains
       * somebody to ignore both.
       */
      console.log('REI was busy — standing down, the next run in 2 minutes will pick these up.');
      process.exit(0);
    }
    console.log('\nREI stayed busy for 12 minutes. These rows will be picked up by the next run.');
    process.exit(1);
  }

  const context = await launchReiContext();
  let filled = 0;
  let stuck = 0;
  // Counted apart from `stuck`: a link that could not be found is not a booking that did not happen.
  let linksFilled = 0;
  let linksMissed = 0;

  /*
   * This is the job the dashboard matters most for. A colleague types a booking on the board and watches
   * that row: "Being added…" with a timer. Until now the only thing they could see was the timer. Now the
   * app can show which lead is being looked up and how far through it is.
   */
  beginJob('board-intake', { total: pending.length, phase: 'opening REI' });
  let seen = 0;

  try {
    for (const row of pending) {
      const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
      seen += 1;
      updateJob({ phase: 'looking up REI', item: who, index: seen, total: pending.length });
      const { link, phone } = lookupKeyFor(row);
      console.log(`\n--- ${who}`);
      /*
       * ONE ROW MUST NOT BE ABLE TO KILL THE BATCH.
       *
       * The client's board showed a booking stuck at "Still not finished — 206m", while the run reported
       * "0 finished, 0 could not be looked up" every two minutes. Neither number was a skip: every skip path
       * in this loop counts. The run was THROWING partway through that row — after REI had been read — which
       * left the loop through the finally with nothing counted and nothing written.
       *
       * The reason it threw hardly matters next to the consequence: everything queued behind it was never
       * reached either. A single row with a value the sheet's validation rejects — the documented failure
       * here, where one bad cell fails the ENTIRE row write — would silently stall every booking after it.
       * On a busy morning that is the whole board.
       *
       * So each row gets its own try. A row that blows up is counted, named with its error, and the next one
       * carries on. The batch degrades one row at a time instead of all at once.
       */
      try {

      if (!link && !phone) {
        console.log('    no phone and no REI link on this row — cannot look anything up');
        stuck += 1;
        continue;
      }
      console.log(`    looking up REI by ${link ? 'link' : 'phone'}: ${link || phone}`);

      let scraped;
      try {
        scraped = await withLeadBudget(scrapeReiVisit(context, link, {
          phone,
          sellerName: text(row['Seller Name']),
          appointmentStartIso: ''
        }), who);
      } catch (error) {
        console.log(`    REI could not be read: ${error.message}`);
        stuck += 1;
        continue;
      }

      const address = text(scraped?.propertyAddress);
      if (!address) {
        /*
         * REI answered but holds no address. Reported rather than guessed — the whole point of the rule
         * "do not guess missing addresses" is that somebody would otherwise be sent to a house nobody
         * named. The row keeps its placeholder so the next run tries again after REI is filled in.
         *
         * AND THE REASON GOES ON THE ROW, which is the part that was missing and it cost a whole day.
         *
         * This branch ran every two minutes for twenty-five hours on two real bookings. The console said
         * exactly what was wrong each time — into a log file nobody had reason to open — while the board
         * showed "Still not finished 1489m · The office PC does this, and it has not. Check it is switched
         * on and signed in to Windows." The PC was on, and it had done it, over seven hundred times. The
         * client checked the PC, the tasks, the sign-in and the sheet, and the answer was a blank field in
         * REI the whole time.
         *
         * A diagnosis that only exists on the machine nobody is looking at is not a diagnosis.
         */
        /*
         * Which of the two it was, on the row itself.
         *
         * "REI holds no address" and "the page did not finish rendering" produced the identical message,
         * and the first is a believable, expected answer — so a timing bug wearing it got written onto the
         * row as REI's verdict and acted on. The scraper now says which; this passes that through instead
         * of overwriting it with the confident version.
         */
        var renderWarning = (scraped?.warnings || []).find((w) => /finished rendering/i.test(String(w)));
        console.log(renderWarning
          ? '    REI showed the Property Address label but no value — the page may not have finished loading'
          : '    REI has no Property Address on that contact — leaving the row parked');
        await noteParkReason(sheets, headers, row, renderWarning
          ? 'The REI page did not finish loading, so the address could not be read. This usually clears '
            + 'itself on the next run — no action needed unless it keeps saying this.'
          : 'REI has no Property Address on this contact. Add it in REI and this row finishes itself '
            + 'within a couple of minutes — nothing needs restarting.');
        stuck += 1;
        continue;
      }

      /*
       * The colleague's own typing WINS over REI for the visit date and time.
       *
       * They booked it; REI may not know about it yet, which is the entire reason this row exists rather
       * than a booking email. Everything else — address, stage, notes, owner — comes from REI, which is
       * the source of truth for the fields it holds.
       */
      const visit = {
        ...scraped,
        reiLink: scraped.reiLink || link,
        phone: scraped.phone || phone,
        sellerName: scraped.sellerName || text(row['Seller Name']),
        appointmentStartIso: scraped.appointmentStartIso,
        scrapedAt: new Date().toISOString()
      };

      const typedDate = text(row['Visit Date']);
      const typedTime = text(row['Visit Time']);
      if (typedDate) {
        console.log(`    keeping the date typed on the board: ${typedDate}${typedTime ? ` ${typedTime}` : ''}`);
      }

      /*
       * And actually keep it.
       *
       * This line printed "keeping the date typed on the board: 08/30/2026 2:00 PM" and then did not keep
       * it: appointmentStartIso came only from REI, and the one place that touched it afterwards read
       *
       *   if (typedDate) visit.appointmentStartIso = visit.appointmentStartIso || '';
       *
       * which assigns the value to itself. So when REI held no appointment — the normal case for a booking
       * a colleague typed in BEFORE REI knows about it, which is the entire reason this script exists — the
       * date was dropped and syncCalendarEvent threw "appointmentStartIso is invalid". The row went back on
       * the board to be retried, and failed the same way on every run.
       *
       * The client watched two visits sit in BEING ADDED for six hours, one of them the next day's, with
       * the log telling them the date was being kept.
       *
       * REI still wins when REI has a date: it is the source of truth for the fields it holds, and a
       * reschedule made in REI must not be overwritten by what somebody typed days earlier. This is only a
       * fallback for when REI has nothing.
       */
      if (!visit.appointmentStartIso && typedDate) {
        const typed = typedStart(typedDate, typedTime);
        if (typed) {
          visit.appointmentStartIso = typed;
          console.log(`    REI has no appointment date — using the typed one: ` +
            `${DateTime.fromISO(typed).setZone(config.calendarTimezone).toFormat('ccc d LLL yyyy, h:mm a')}` +
            `${typedTime ? '' : '  (no time was typed, so 9:00 AM — fix it on the board if that is wrong)'}`);
        } else {
          console.log(`    could not read the typed date "${typedDate}${typedTime ? ` ${typedTime}` : ''}" —` +
            ` no calendar event. Retype it on the board as 9/2/2026 and 2:00 PM.`);
        }
      }

      console.log(`    REI says: ${address}`);
      if (!APPLY) {
        console.log('    DRY RUN — would fill this row in and put the visit on the calendar');
        filled += 1;
        continue;
      }

      /*
       * Matched the ordinary way — record id, then link, then normalised address.
       *
       * The interesting case is when that match lands on a DIFFERENT row: the contact already had a
       * record, and the colleague booked from the board without knowing. The board catches most of these
       * by phone before the row is ever created, but not all — REI holds numbers and links the board
       * never saw, which is exactly why the lookup is happening here at all.
       *
       * Then the parked row must be CLEARED, not just left. upsertVisit writes to the matched row, so
       * without this the placeholder sits beside the real card forever, and every run tries it again.
       */
      const match = await findExistingVisit(auth, visit);
      const mergingInto = match?.rowNumber && match.rowNumber !== row.__rowNumber ? match.rowNumber : 0;
      if (mergingInto) {
        console.log(`    this contact already has row ${mergingInto} — merging into it`);
        /*
         * The date the colleague typed is the reason this row exists, so it is carried across. REI may
         * not know about the new booking yet; that is the whole point of somebody typing it.
         */
        // The typed date is already carried onto visit.appointmentStartIso above, before any of the
        // matching runs. The line that used to sit here assigned the field to itself and did nothing.
      }

      /*
       * A calendar failure must not throw the ADDRESS away.
       *
       * This threw and the per-row catch marked the whole row failed — for a booking where REI had already
       * answered with "123 Main Street, Test, Test, CA, 95446" and eight notes. The row kept its
       * placeholder and went back on the board to fail identically on every later run, and the one thing
       * it had successfully learned was discarded each time.
       *
       * The calendar is one of four things this does; the other three are worth keeping on their own. So a
       * failure here is recorded on the row and the run carries on to write it. A visit with an address and
       * no event is a lead the team can work and somebody can put in the diary by hand; a row still reading
       * PENDING REI LOOKUP is neither.
       */
      let calendarEventId = '';
      let calendarProblem = '';
      try {
        calendarEventId = await syncCalendarEvent(auth, visit, match.calendarEventId || '');
      } catch (error) {
        calendarProblem = String(error.message || error);
        console.log(`    calendar event NOT created: ${calendarProblem}`);
        console.log('    the row is still filled in below — only the calendar entry is missing.');
      }
      visit.calendarEventId = calendarEventId;
      const written = await upsertVisit(auth, visit, match);
      console.log(`    filled row ${written?.rowNumber ?? '?'}` +
        ` · calendar event ${calendarEventId ? 'set' : 'NOT created (no valid time yet)'}`);
      /*
       * On the row, not only in a log nobody opens. The reason a visit is missing from the calendar has to
       * be somewhere the person looking at the board can see it — that lesson has been learned twice here
       * already.
       */
      if (calendarProblem) {
        await noteParkReason(sheets, headers, row,
          `Filled in from REI, but no calendar event: ${calendarProblem} `
          + 'Check Visit Date and Visit Time on this row.');
      }

      /*
       * Clear the "waiting" flag, or the finished row is branded an Exception for ever.
       *
       * Data Quality Status is a FORMULA reading Exception Reason, so a stale reason does not just look
       * untidy on the card — the row counts as an exception in every total on the board, and the visitor
       * reads a red warning telling them the automation has not run on a record it plainly has.
       *
       * Only OUR sentence is removed, and a POSSIBLE DUPLICATE warning is deliberately kept: that one is
       * addressed to a person and is still true after the lookup. The "[since ...]" stamp goes either way,
       * because it drives the elapsed timer and there is nothing left to time.
       */
      const targetRow = written?.rowNumber ?? row.__rowNumber;
      const priorReason = text(row['Exception Reason']);
      const withoutStamp = priorReason.replace(/\s*\[since [^\]]*\]/g, '').trim();
      const cleaned = /^Waiting for the PC to read REI/i.test(withoutStamp) ? '' : withoutStamp;
      if (priorReason !== cleaned) {
        const col = headers.indexOf('Exception Reason');
        if (col >= 0) {
          const a1 = `${config.trackerSheet}!${columnLetter(col + 1)}${targetRow}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: config.spreadsheetId,
            range: a1,
            valueInputOption: 'RAW',
            requestBody: { values: [[cleaned]] }
          });
          console.log(cleaned
            ? `    kept the duplicate warning, dropped the waiting flag`
            : `    cleared the "waiting for the PC" flag on row ${targetRow}`);
        }
      }

      /*
       * From here on this does exactly what a booking EMAIL does — close the REI task, then post one Chat
       * message carrying the briefing and what was done.
       *
       * It did not, and the inconsistency was the client's to spot: "if someone added in here this should
       * be prio and work all ASAP to add, book, add calendar, closed, chat, check notes and alert GC." A
       * visit typed on the board reached the tracker and the calendar and then went silent, so the visitor
       * never got the briefing and the REI task stayed open. Same event, two different outcomes, depending
       * on which door it came through.
       *
       * The order is the same as the intake's, and for the same reason: the task is closed BEFORE the
       * message, so the message can report it.
       */
      let taskLine = '';
      if (config.reiCompleteTasks) {
        try {
          const visitKey = {
            phone: visit.phone,
            date: visit.appointmentStartIso
              ? DateTime.fromISO(visit.appointmentStartIso).setZone(config.calendarTimezone).toFormat('yyyy-MM-dd')
              : dayKey(row)
          };
          const taskPage = await context.newPage();
          try {
            await taskPage.goto(visit.reiLink, { waitUntil: 'domcontentloaded' });
            const reiSelectors = JSON.parse(await fsp.readFile(config.reiSelectorConfig, 'utf8'));
            const tasks = await readTasks(taskPage, reiSelectors, { timezone: config.calendarTimezone });
            const task = pickTaskForVisit(tasks, visitKey);
            const verdict = shouldCompleteTask({
              enabled: true,
              apply: true,
              task,
              visit: visitKey,
              rowWritten: Boolean(written),
              calendarVerified: Boolean(calendarEventId),
              alreadyComplete: Boolean(task?.complete)
            });
            if (!verdict.complete) {
              taskLine = `⚠️ REI task still open — ${verdict.reason}`;
            } else {
              const result = await completeTask(taskPage, reiSelectors, task);
              // `confirmed` is the row re-read, not the click landing. An unconfirmed close reads as open.
              taskLine = result.confirmed
                ? `✅ REI task closed — ${task.title || 'Booked appointment'}`
                : '⚠️ REI task — the click was not confirmed, check it in REI';
            }
          } finally {
            await taskPage.close().catch(() => {});
          }
        } catch (taskError) {
          taskLine = '⚠️ REI task still open — could not be reached, close it by hand';
        }
        console.log(`    ${taskLine}`);
      }

      if (config.chatVisitBriefing) {
        /*
         * The SAME builder and the SAME source text as the email path — buildDescription() is what goes on
         * the calendar event. Two builders would drift, and the one nobody looks at would be the one the
         * visitor is reading in the car.
         */
        const briefing = briefingFromDescription(buildDescription(visit), {
          address,
          appointmentText: visit.appointmentStartIso
            ? DateTime.fromISO(visit.appointmentStartIso)
              .setZone(config.calendarTimezone).toFormat('ccc, LLL d, yyyy, h:mm a')
            : `${typedDate}${typedTime ? ` ${typedTime}` : ''}`.trim()
        });
        const done = [
          calendarEventId
            ? `✅ Calendar — event on ${config.calendarName || 'the visit calendar'}`
            : "❌ Calendar — NOT created, this visit is on nobody's day",
          `✅ Dashboard — row ${written?.rowNumber ?? '?'} in "${config.trackerSheet}"`,
          taskLine,
          '➡️ NEXT: create the WhatsApp group, add the team, and paste this briefing'
        ].filter(Boolean).join('\n');

        const FENCE = String.fromCharCode(96, 96, 96);
        const fenced = `${FENCE}\n${briefing.split(FENCE).join("'''")}\n${FENCE}`;
        const posted = await notifyChat(
          `*Visit booked on the dashboard — ${visit.sellerName || 'seller'}*\n` +
          'Copy the block below into the visit group.\n\n' +
          `${fenced}\n\n━━ DONE FOR YOU ━━\n${done}`,
          // The seller's number survives here, as in the intake. Same team-only Chat space.
          { kind: 'ok', keepContactDetails: true }
        );
        console.log(`    Chat briefing ${posted ? 'posted' : 'NOT posted — check CHAT_WEBHOOK_URL'}`);
      }

      if (mergingInto) {
        /*
         * Blank the parked row rather than deleting it: deleting shifts every row below it, and the
         * tracker's own formulas, the dashboard and any stored row numbers are all positional. An empty
         * row is also what webAddRecord_ looks for when handing out the next slot, so the space is reused.
         */
        await sheets.spreadsheets.values.clear({
          spreadsheetId: config.spreadsheetId,
          range: `${config.trackerSheet}!A${row.__rowNumber}:CZ${row.__rowNumber}`
        });
        console.log(`    cleared the parked row ${row.__rowNumber} — one record, not two`);
      }
      filled += 1;
      } catch (error) {
        /*
         * Named, counted, and the run continues. The row keeps its PENDING placeholder, so the next run
         * tries it again — and if it is genuinely un-processable it will say the same thing every time,
         * which is a diagnosable pattern rather than a silent stall.
         */
        console.log(`    FAILED on this row: ${error.message}`);
        console.log('    It keeps its placeholder and the next run will try again.');
        stuck += 1;
      }
    }

    /*
     * PASS 2 — the link backfill. Same lock, same browser, after the rows a colleague is watching.
     *
     * Ordered second deliberately: a parked row has somebody staring at a timer on the board, and a
     * missing link is invisible to everyone. If the lock runs out or the run is killed partway, the
     * work that gets done is the work someone is waiting for.
     *
     * Failures here are counted separately and never touch `stuck`, which feeds the board-intake
     * summary and the "NOT REACHED" arithmetic. A link that could not be found is not a booking that
     * did not happen, and reporting it as one would cry wolf on the number that matters.
     */
    for (const row of backfill.rows) {
      const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
      const phone = text(row['Phone']);
      console.log(`\n--- ${who} (REI link)`);
      try {
        updateJob({ phase: 'filling in a missing REI link', item: who });
        const scraped = await withLeadBudget(
          scrapeReiVisit(context, '', { phone, sellerName: who, appointmentStartIso: '' }), who);
        const found = text(scraped?.reiLink);
        if (!found) {
          // Reported, not guessed. REI may simply hold no contact on that number.
          console.log(`    REI returned no contact link for ${phone} — leaving the row as it is`);
          linksMissed += 1;
          continue;
        }
        if (await writeReiLink(sheets, headers, row, found)) {
          console.log(`    wrote the REI link — this lead is now swept like any other`);
          linksFilled += 1;
        } else {
          linksMissed += 1;
        }
      } catch (error) {
        console.log(`    could not fill the REI link: ${error.message}`);
        linksMissed += 1;
      }
    }
  } finally {
    await context.close();
    await release();
    // Withdrawn here, not on the happy path only: a run that threw must not leave sweeps yielding.
    clearBookingPriority();
    // In the finally, so a crash still marks the job finished rather than leaving it reading as "running".
    /*
     * The count of rows it never accounted for, and this exists because the client's dashboard showed
     * "Board intake — 0 finished, 0 could not be looked up" every two minutes while one row sat waiting.
     *
     * Both zeros with a row queued is not a tidy result, it is a row that was passed over: either the run
     * threw before reaching it, or it left the loop through a path that forgot to count. And "0 and 0" reads
     * as "nothing to do", so the report looked CLEAN while a booking went unprocessed — the silent failure
     * this project exists to make impossible.
     *
     * Arithmetic rather than a new flag on every branch: seen minus what was accounted for cannot be fooled
     * by a path added later that forgets to increment, which is exactly how this happened.
     */
    const unaccounted = Math.max(0, pending.length - filled - stuck);
    const links = (linksFilled || linksMissed)
      ? `, ${linksFilled} REI link(s) filled in`
        + (linksMissed ? ` (${linksMissed} not found)` : '')
      : '';
    const summary = `${filled} finished, ${stuck} could not be looked up`
      + (unaccounted ? `, ${unaccounted} NOT REACHED` : '') + links;
    endJob({ summary, ok: !stuck && !unaccounted });
    recordActivity(`Board intake — ${summary}.`,
      { kind: (stuck || unaccounted) ? 'warn' : 'ok', job: 'board-intake' });
    if (unaccounted) {
      console.log(`\n${unaccounted} row(s) were never reached. They are still waiting and the next run will`);
      console.log('try again — but if this repeats, the run is stopping partway rather than skipping them.');
    }
  }

  console.log(`\n${filled} row(s) ${APPLY ? 'filled in' : 'would be filled in'}, ${stuck} left parked.`);
  if (!APPLY) console.log('Re-run with --yes once the above looks right.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
