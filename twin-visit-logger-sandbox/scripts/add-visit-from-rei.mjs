/**
 * Put ONE REI contact into the tracker and onto the calendar, without needing its Gmail notification.
 *
 *   node scripts/add-visit-from-rei.mjs "https://my.reiblackbook.com/contacts/20473369"        <- dry run
 *   node scripts/add-visit-from-rei.mjs "https://my.reiblackbook.com/contacts/20473369" --yes  <- writes
 *
 * Why this exists: the normal path is Gmail-driven, and a Gmail message is consumed exactly once — it
 * gets a Processed or Error label and is never looked at again. So a booking whose email was already
 * handled (or errored, or filtered, or simply never arrived) can never reach the tracker afterwards.
 * Until now the only recourse was typing the row by hand, which defeats the point.
 *
 * It is the same pipeline as a real run and obeys the same rules:
 *   - the REI page is read-only; the scraper opens Notes/Tasks/Property and clicks nothing that writes
 *   - no calendar event without a real address AND a real appointment time
 *   - an existing row is UPDATED, never duplicated: the same match-by-record-id/link/address as usual
 *   - an existing calendar event is REUSED via its stored ID or its extended properties
 *   - no Gmail label is touched, so nothing about the inbox changes either way
 */
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { findExistingVisit, upsertVisit } from '../src/google/sheets.mjs';
import { syncCalendarEvent } from '../src/google/calendar.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const link = args.find((a) => /^https?:\/\//i.test(a)) || '';

if (!link) {
  console.log('Give the REI contact URL:\n');
  console.log('  node scripts\\add-visit-from-rei.mjs "https://my.reiblackbook.com/contacts/12345678"');
  console.log('\nAdd --yes to actually write. Without it, nothing is created or changed.');
  process.exit(1);
}

console.log(`REI contact: ${link}`);
console.log(`Mode:        ${APPLY ? 'WRITE' : 'DRY RUN (nothing will be written)'}\n`);

const auth = await authorizeGoogle();
const context = await launchReiContext();
let visit;
try {
  visit = await scrapeReiVisit(context, link, {});
} finally {
  await context.close().catch(() => {});
}

visit = { ...visit, reiLink: visit.reiLink || link, scrapedAt: new Date().toISOString() };

console.log('=== What REI says ===');
for (const [label, key] of [
  ['Seller', 'sellerName'],
  ['Phone', 'phone'],
  ['Property', 'propertyAddress'],
  ['Appointment', 'appointmentStartIso'],
  ['Assigned Owner', 'assignedOwner'],
  ['Contact Stage', 'contactStage'],
  ['Lead Source', 'leadSource'],
  ['REI record id', 'reiRecordId']
]) console.log(`  ${label.padEnd(15)} ${visit[key] || '(blank on the REI contact)'}`);

if (visit.warnings?.length) {
  console.log('\nWarnings from the scrape:');
  for (const w of [...new Set(visit.warnings)]) console.log(`  - ${w}`);
}

/*
 * The same three fields the email path treats as non-negotiable. Assigned Owner is deliberately not
 * among them: REI often has no owner and the team assigns it by hand, so requiring it would block a
 * real booking. A missing owner is reported and the dashboard flags the row.
 */
const missing = [];
if (!visit.sellerName) missing.push('Seller name');
if (!visit.propertyAddress) missing.push('Property address');
if (!visit.appointmentStartIso) missing.push('Appointment date/time');
if (missing.length) {
  console.log(`\nSTOPPING — these are blank on the REI contact: ${missing.join(', ')}`);
  console.log('Fill them in on that REI contact and run this again. Nothing is guessed here: an');
  console.log('invented address or time would put a real person at the wrong house at the wrong hour.');
  process.exit(1);
}

if (!visit.assignedOwner) {
  console.log('\nNOTE: no Assigned Owner on this REI contact, so the tracker row will have none either.');
  console.log('Set "Appointment Assigned To" on the REI contact if you want it filled in everywhere.');
}

const match = await findExistingVisit(auth, visit);
console.log(`\nTracker: ${match.found ? `row ${match.rowNumber} already exists — it will be UPDATED` : 'no existing row — one will be ADDED'}`);
console.log(`Calendar: ${match.calendarEventId ? `event ${match.calendarEventId} is on file — it will be UPDATED` : 'no event id on file — one will be created or matched by REI record id'}`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --yes once the above looks right.');
  process.exit(0);
}

// Calendar first, so the row can carry the event id in one write rather than two.
const calendarEventId = await syncCalendarEvent(auth, visit, match.calendarEventId || '');
const written = await upsertVisit(auth, { ...visit, calendarEventId }, match);

console.log('\n=== Written ===');
console.log(`  Workbook   https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
console.log(`  Tab        ${config.trackerSheet}`);
console.log(`  Row        ${written?.rowNumber ?? '(unknown)'} (${written?.appended ? 'new row' : 'updated an existing row'})`);
console.log(`  Calendar   ${config.calendarName || config.calendarId}`);
console.log(`  Event id   ${calendarEventId}`);
console.log('\nThe dashboard reads from that tab, so it updates on its own.');
