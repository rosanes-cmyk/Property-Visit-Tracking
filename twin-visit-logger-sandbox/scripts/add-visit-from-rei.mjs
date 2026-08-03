/**
 * Put ONE REI contact into the tracker and onto the calendar, without needing its Gmail notification.
 *
 *   node scripts/add-visit-from-rei.mjs "1390 Estudillo"                                       <- dry run
 *   node scripts/add-visit-from-rei.mjs "1390 Estudillo" --yes                                 <- writes
 *   node scripts/add-visit-from-rei.mjs "https://my.reiblackbook.com/contacts/20473369"         <- by URL
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
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { findExistingVisit, upsertVisit } from '../src/google/sheets.mjs';
import { syncCalendarEvent } from '../src/google/calendar.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { fieldFromDescription } from '../src/whatsapp/plan.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const given = args.filter((a) => a !== '--yes');
let link = given.find((a) => /^https?:\/\//i.test(a)) || '';
const searchTerm = link ? '' : (given[0] || '').trim();

/*
 * When the visit is found on the calendar, remember WHICH event it is.
 *
 * syncCalendarEvent only recognises an existing event by the private extended properties this project
 * writes (reiRecordId / reiLinkHash). An event created by the workbook's Apps Script does not carry
 * them, so it would not be recognised and a SECOND event would be inserted — a duplicate on Juan's
 * calendar for a visit happening tomorrow morning. We already know the exact event id, so it is passed
 * in rather than searched for.
 */
let knownEventId = '';

const auth = await authorizeGoogle();

/*
 * A plain word instead of a URL means "find it on the calendar".
 *
 * Hunting down a contact URL by hand is the step most likely to go wrong, and getting it wrong writes
 * ANOTHER seller's details onto this visit's row. Every visit event already carries its REI link in
 * the description, put there by whichever writer created it — so the safer input is the address.
 */
if (searchTerm) {
  if (/^<.*>$/.test(searchTerm)) {
    console.log(`"${searchTerm}" is the placeholder text, not a real value. Put the address in, e.g.:\n`);
    console.log('  node scripts\\add-visit-from-rei.mjs "1390 Estudillo"');
    process.exit(1);
  }

  const calendar = google.calendar({ version: 'v3', auth });
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const wanted = String(config.calendarName || '').trim().toLowerCase();
  const cal = (list.data.items || []).find((c) => String(c.summary || '').trim().toLowerCase() === wanted)
    || { id: config.calendarId, summary: '(from CALENDAR_ID)' };

  const now = new Date();
  const res = await calendar.events.list({
    calendarId: cal.id,
    timeMin: new Date(now.getTime() - 30 * 86400 * 1000).toISOString(),
    timeMax: new Date(now.getTime() + 90 * 86400 * 1000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });

  const needle = searchTerm.toLowerCase();
  const hits = (res.data.items || []).filter((e) =>
    /property visit/i.test(e.summary || '') &&
    `${e.summary || ''} ${e.location || ''}`.toLowerCase().includes(needle));

  console.log(`Looked for "${searchTerm}" on "${cal.summary}": ${hits.length} property-visit event(s)\n`);
  for (const e of hits) console.log(`  ${e.start?.dateTime || e.start?.date}  ${e.summary}`);

  if (hits.length !== 1) {
    console.log(hits.length
      ? '\nMore than one match — be more specific, or pass the REI contact URL directly.'
      : '\nNo match. Check the spelling, or pass the REI contact URL directly.');
    process.exit(1);
  }

  knownEventId = hits[0].id || '';
  link = fieldFromDescription(hits[0].description || '', 'REI BlackBook');
  if (!link) {
    console.log('\nThat event has no REI BlackBook link in its description, so the contact cannot be');
    console.log('found from it. Open the contact in REI and pass its URL instead.');
    process.exit(1);
  }
  console.log(`\nREI link from that event: ${link}`);
}

if (!link) {
  console.log('Give the property address, or the REI contact URL:\n');
  console.log('  node scripts\\add-visit-from-rei.mjs "1390 Estudillo"');
  console.log('  node scripts\\add-visit-from-rei.mjs "https://my.reiblackbook.com/contacts/12345678"');
  console.log('\nAdd --yes to actually write. Without it, nothing is created or changed.');
  process.exit(1);
}

console.log(`REI contact: ${link}`);
console.log(`Mode:        ${APPLY ? 'WRITE' : 'DRY RUN (nothing will be written)'}\n`);

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
const eventIdToUse = match.calendarEventId || knownEventId;
console.log(`\nTracker: ${match.found ? `row ${match.rowNumber} already exists — it will be UPDATED` : 'no existing row — one will be ADDED'}`);
if (eventIdToUse) {
  console.log(`Calendar: event ${eventIdToUse} will be UPDATED` +
    (match.calendarEventId ? ' (id from the tracker row)' : ' (the event found on the calendar above — no duplicate)'));
} else {
  console.log('Calendar: no event found — a new one will be created');
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --yes once the above looks right.');
  process.exit(0);
}

// Calendar first, so the row can carry the event id in one write rather than two.
const calendarEventId = await syncCalendarEvent(auth, visit, eventIdToUse);
const written = await upsertVisit(auth, { ...visit, calendarEventId }, match);

console.log('\n=== Written ===');
console.log(`  Workbook   https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
console.log(`  Tab        ${config.trackerSheet}`);
console.log(`  Row        ${written?.rowNumber ?? '(unknown)'} (${written?.appended ? 'new row' : 'updated an existing row'})`);
console.log(`  Calendar   ${config.calendarName || config.calendarId}`);
console.log(`  Event id   ${calendarEventId}`);
console.log('\nThe dashboard reads from that tab, so it updates on its own.');
