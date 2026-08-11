/**
 * Send the visit briefing to Chat for a lead that is ALREADY booked.
 *
 *   node scripts/send-briefing.mjs "Sheng Luo"
 *   node scripts/send-briefing.mjs --today            every visit on today's calendar
 *   node scripts/send-briefing.mjs --tomorrow
 *
 * Or double-click scripts\send-briefing.cmd and type the name.
 *
 * WHY THIS EXISTS
 *
 * The client, looking at a calendar event that already had everything on it: "im asking about the notes for
 * that should be send in whats app since its already added in caldar the lead."
 *
 * The briefing only ever went out at the MOMENT a booking was first processed — from the email intake, or
 * from a row typed on the board. A visit booked last week, or booked on a PC that has since died, produces
 * no briefing ever again. And the briefing is the thing a person copies into the visit's WhatsApp group, so
 * "it was posted once, three days ago, above four hundred other messages" is the same as never.
 *
 * There was no way to ask for it. Now there is.
 *
 * WHERE THE TEXT COMES FROM
 *
 * The CALENDAR EVENT's own description, not a fresh REI scrape. Three reasons, in order of importance:
 *
 *   1. It is what the visitor is already reading. Building a second version from REI risks the two
 *      disagreeing, and the one nobody checks would be the one in the car.
 *   2. It needs no browser, so it takes the run lock from nothing and returns in about a second — which
 *      matters when somebody is asking for it because they are leaving for the visit.
 *   3. It works when REI is logged out, which is exactly when somebody is most likely to be chasing this.
 *
 * The trade, stated: if REI has changed since the event was written, this sends the older picture. The
 * hourly sweep is what keeps the event current, and the briefing says when it was last written so a reader
 * can judge for themselves.
 */
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { briefingFromDescription } from '../src/whatsapp/note.mjs';
import { notifyChat } from '../src/utils/notify.mjs';

const args = process.argv.slice(2);
const TODAY = args.includes('--today');
const TOMORROW = args.includes('--tomorrow');
const NEEDLE = args.filter((a) => !a.startsWith('--')).join(' ').trim().toLowerCase();

if (!NEEDLE && !TODAY && !TOMORROW) {
  console.log('\nWho is the briefing for?\n');
  console.log('  node scripts/send-briefing.mjs "Sheng Luo"');
  console.log('  node scripts/send-briefing.mjs --today');
  console.log('  node scripts/send-briefing.mjs --tomorrow\n');
  process.exit(1);
}

const text = (v) => String(v == null ? '' : v).trim();

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });
const calendar = google.calendar({ version: 'v3', auth });

/* ------------------------------------------------------------------ the rows */

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `${config.trackerSheet}!A1:CZ`,
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'FORMATTED_STRING'
});
const grid = res.data.values || [];
const headers = (grid[0] || []).map((h) => text(h));
const rows = grid.slice(1)
  .map((cells, i) => {
    const row = { __rowNumber: 2 + i };
    headers.forEach((h, j) => { if (h) row[h] = cells[j] === undefined ? '' : cells[j]; });
    return row;
  })
  .filter((r) => text(r['Property Address']));

const zone = config.calendarTimezone;
const dayKey = (d) => d.setZone(zone).toFormat('yyyy-MM-dd');
const wanted = TODAY ? dayKey(DateTime.now())
  : TOMORROW ? dayKey(DateTime.now().plus({ days: 1 }))
    : '';

/*
 * Matching, in tiers, most specific first — the same shape --only uses in the re-check, and for the same
 * reason: a bare name search for "Jose" also finds "San Jose" in an address, which is how a request for one
 * seller once returned five.
 */
let matches;
if (wanted) {
  matches = rows.filter((r) => {
    const raw = text(r['Visit Date']);
    if (!raw) return false;
    const d = DateTime.fromFormat(raw, 'yyyy-MM-dd', { zone });
    return (d.isValid ? dayKey(d) : raw.slice(0, 10)) === wanted;
  });
} else {
  matches = rows.filter((r) => text(r['Seller Name']).toLowerCase().includes(NEEDLE));
  if (!matches.length) matches = rows.filter((r) => text(r['Property Address']).toLowerCase().includes(NEEDLE));
}

if (!matches.length) {
  console.log(`\nNothing matched ${wanted ? `a visit on ${wanted}` : `"${NEEDLE}"`}.`);
  console.log('Check the spelling of the seller name, or try part of the address.');
  process.exit(1);
}

console.log(`\n${matches.length} lead(s) matched:\n`);
for (const r of matches) {
  console.log(`  row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} · ${text(r['Property Address'])}`);
}
console.log('');

/* ------------------------------------------------------------- the briefings */

/*
 * The calendar id is resolved the same way the rest of the project does — by NAME first, because the client's
 * events live on "Juan's Official Calendar" rather than the account's own, and an id in .env pointing at the
 * wrong one would silently send briefings built from the wrong events.
 */
let calendarId = config.calendarId || 'primary';
if (config.calendarName) {
  try {
    const list = await calendar.calendarList.list({ maxResults: 250 });
    const found = (list.data.items || []).find((c) => text(c.summary) === text(config.calendarName));
    if (found) calendarId = found.id;
  } catch { /* fall back to the configured id */ }
}

let sent = 0;
let skipped = 0;

for (const row of matches) {
  const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
  const address = text(row['Property Address']);
  const eventId = text(row['Calendar Event ID']);

  if (!eventId) {
    /*
     * No event means no description to build from. Reported rather than guessed at: assembling a briefing out
     * of the tracker's own columns would produce something that looks the same and says less, and the visitor
     * would have no way to tell which kind they were reading.
     */
    console.log(`  ${who} — SKIPPED: no calendar event on this row, so there is nothing to build from.`);
    console.log('      The visit was probably added by hand. Book it through the dashboard and it will get one.');
    skipped += 1;
    continue;
  }

  let event;
  try {
    event = (await calendar.events.get({ calendarId, eventId })).data;
  } catch (error) {
    console.log(`  ${who} — SKIPPED: the calendar event could not be read (${error.message}).`);
    skipped += 1;
    continue;
  }

  const description = text(event.description);
  if (!description) {
    console.log(`  ${who} — SKIPPED: the calendar event has no details on it.`);
    skipped += 1;
    continue;
  }

  const startIso = event.start?.dateTime || event.start?.date || '';
  const appointmentText = startIso
    ? DateTime.fromISO(startIso).setZone(zone).toFormat('ccc, LLL d, yyyy, h:mm a')
    : `${text(row['Visit Date'])} ${text(row['Visit Time'])}`.trim();

  const briefing = briefingFromDescription(description, { address, appointmentText });

  const FENCE = String.fromCharCode(96, 96, 96);
  const fenced = `${FENCE}\n${briefing.split(FENCE).join("'''")}\n${FENCE}`;
  /*
   * keepContactDetails, exactly as the intake does. A briefing sends somebody to a house to meet a person; a
   * redacted phone number means they arrive unable to ring ahead and go hunting in REI, which defeats it.
   * The destination is the same team-only Chat space either way.
   */
  const posted = await notifyChat(
    `*Visit briefing — ${who}*\n` +
    'Asked for by hand. Copy the block below into the visit group.\n\n' +
    `${fenced}\n\n━━\n📅 ${appointmentText}\n📍 ${address}`,
    { kind: 'ok', keepContactDetails: true }
  );

  if (posted) { sent += 1; console.log(`  ${who} — briefing posted to Chat.`); }
  else { skipped += 1; console.log(`  ${who} — COULD NOT POST. Check the Chat webhook.`); }
}

console.log(`\n${sent} briefing(s) sent${skipped ? `, ${skipped} skipped` : ''}.`);
console.log(sent ? 'Open Google Chat and copy the block into the visit group.' : '');
process.exit(sent ? 0 : 1);
