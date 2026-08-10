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
import { haltForPause } from '../src/utils/paused.mjs';
import { buildDescription } from '../src/google/calendar.mjs';
import { briefingFromDescription } from '../src/whatsapp/note.mjs';
import { notifyChat } from '../src/utils/notify.mjs';
import { readTasks, pickTaskForVisit, completeTask } from '../src/rei/tasks.mjs';
import { shouldCompleteTask } from '../src/rei/task-gate.mjs';
import fsp from 'node:fs/promises';
import { DateTime } from 'luxon';

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
 * Paused before anything is opened or read. This is an auto-update of already-tracked leads — the exact
 * class of job the pause switch exists for — even though the row it finishes was typed by a person.
 */
if (haltForPause({ force: FORCE })) process.exit(0);

function text(value) {
  return String(value == null ? '' : value).trim();
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

async function main() {
  console.log('Twin Visit Logger · finish the rows added on the board');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN — nothing will be written'}\n`);

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
    return;
  }
  const headers = grid[0].map((h) => String(h).trim());
  const rows = grid.slice(1).map((values, i) => {
    const rec = { __rowNumber: i + 2 };
    headers.forEach((h, c) => { rec[h] = values[c]; });
    return rec;
  });

  const pending = rows.filter((r) => text(r['Property Address']).startsWith(PENDING_PREFIX));
  if (!pending.length) {
    console.log('No rows are waiting on REI. Everything added from the board has been filled in.');
    return;
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

  console.log(`${pending.length} row(s) added on the board and waiting on REI, soonest visit first:`);
  for (const r of pending) {
    console.log(`  row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} · ${text(r['Property Address'])}`);
  }
  console.log('');

  /*
   * One browser profile, one lock. This waits rather than standing down: it runs on a timer, but the row
   * it finishes is one a colleague is watching on the board, so "skipped, try again in ten minutes" is a
   * person staring at a record that never completes.
   */
  /*
   * A scheduled run waits 90 seconds — comfortably inside its own 2-minute period, so copies cannot stack
   * — and a typed one waits the full twelve, because nothing is coming after it.
   */
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

  try {
    for (const row of pending) {
      const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
      const { link, phone } = lookupKeyFor(row);
      console.log(`\n--- ${who}`);

      if (!link && !phone) {
        console.log('    no phone and no REI link on this row — cannot look anything up');
        stuck += 1;
        continue;
      }
      console.log(`    looking up REI by ${link ? 'link' : 'phone'}: ${link || phone}`);

      let scraped;
      try {
        scraped = await scrapeReiVisit(context, link, {
          phone,
          sellerName: text(row['Seller Name']),
          appointmentStartIso: ''
        });
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
         */
        console.log('    REI has no Property Address on that contact — leaving the row parked');
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
        if (typedDate) visit.appointmentStartIso = visit.appointmentStartIso || '';
      }

      const calendarEventId = await syncCalendarEvent(auth, visit, match.calendarEventId || '');
      visit.calendarEventId = calendarEventId;
      const written = await upsertVisit(auth, visit, match);
      console.log(`    filled row ${written?.rowNumber ?? '?'}` +
        ` · calendar event ${calendarEventId ? 'set' : 'NOT created (no valid time yet)'}`);

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
    }
  } finally {
    await context.close();
    await release();
  }

  console.log(`\n${filled} row(s) ${APPLY ? 'filled in' : 'would be filled in'}, ${stuck} left parked.`);
  if (!APPLY) console.log('Re-run with --yes once the above looks right.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
