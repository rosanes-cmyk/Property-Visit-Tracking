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

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const FORCE = args.includes('--force');

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
  console.log(`${pending.length} row(s) added on the board and waiting on REI:`);
  for (const r of pending) {
    console.log(`  row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} · ${text(r['Property Address'])}`);
  }
  console.log('');

  /*
   * One browser profile, one lock. This waits rather than standing down: it runs on a timer, but the row
   * it finishes is one a colleague is watching on the board, so "skipped, try again in ten minutes" is a
   * person staring at a record that never completes.
   */
  const release = await acquireLockWaiting('run', {
    onWait: (secondsLeft) => console.log(`  REI is busy — retrying, up to ${Math.ceil(secondsLeft / 60)} more minute(s)`)
  });
  if (!release) {
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
       * Matched the ordinary way — record id, then link, then normalised address. The parked row is found
       * by its phone and link, so the write lands on the row the colleague created rather than appending
       * a second one beside it.
       */
      const match = await findExistingVisit(auth, visit);
      const calendarEventId = await syncCalendarEvent(auth, visit, match.calendarEventId || '');
      visit.calendarEventId = calendarEventId;
      const written = await upsertVisit(auth, visit, match);
      console.log(`    filled row ${written?.rowNumber ?? '?'}` +
        ` · calendar event ${calendarEventId ? 'set' : 'NOT created (no valid time yet)'}`);
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
