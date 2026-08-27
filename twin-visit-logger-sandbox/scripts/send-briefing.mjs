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
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import { briefingFromDescription } from '../src/whatsapp/note.mjs';
import { notifyChat } from '../src/utils/notify.mjs';

const args = process.argv.slice(2);
const TODAY = args.includes('--today');
const TOMORROW = args.includes('--tomorrow');
/*
 * --force re-sends something already sent today. Without it, a lead briefed this morning is skipped.
 *
 * The client's whole point was "i dont need to open or type" — which means this runs on a timer, and a
 * timer that fires twice (a PC that restarts, a task run by hand to check it works) must not put the same
 * briefing in the space twice. Two identical briefings is how a person starts skimming past them.
 */
const FORCE = args.includes('--force');
const NEEDLE = args.filter((a) => !a.startsWith('--')).join(' ').trim().toLowerCase();

/*
 * Which briefings have already gone out, by day. A local file, not a sheet column: it is bookkeeping about a
 * message, nobody needs it in the workbook, and adding a column is the one change in this project guaranteed
 * to break something else.
 */
const SENT_FILE = path.resolve('./data/briefed.json');
async function readSent() {
  try { return JSON.parse(await fs.readFile(SENT_FILE, 'utf8')); } catch { return {}; }
}
async function writeSent(state) {
  try {
    await fs.mkdir(path.dirname(SENT_FILE), { recursive: true });
    await fs.writeFile(SENT_FILE, JSON.stringify(state, null, 2));
  } catch { /* bookkeeping must never fail the send it is recording */ }
}

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

/**
 * The calendar day a Visit Date cell means, as yyyy-MM-dd, or '' when it cannot be read.
 *
 * `--today` used to assume the cell was already `yyyy-MM-dd` and fall back to `raw.slice(0, 10)` — which
 * compares the first ten characters of something like "8/27/2026" against "2026-08-27" and never matches.
 *
 * The client ran `--today` on a day whose work queue card said, three lines up:
 *
 *   Ngam Lam · 2155 32nd Avenue, San Francisco · Owner: Juan · visit TODAY at 1:30 PM
 *
 * and got "Nothing matched a visit on 2026-08-27". Asking for him BY NAME worked and posted a full briefing,
 * so the event and the row were both fine — only the date comparison was broken.
 *
 * That matters far more than one typed command: the 07:30 Morning Briefings job runs this same path. On any
 * day the sheet renders Visit Date in US format, every briefing for every visit is silently skipped, and the
 * visitor sets off without the property, the numbers or the seller's phone. Nothing errors, and the log line
 * reads like a quiet day.
 *
 * Sheets hands back the cell's DISPLAY value, so the format is whatever the column happens to be formatted
 * as — and this workbook has been re-imported, migrated and hand-edited, so it is not consistent. Hence a
 * list rather than one format.
 *
 * M/d is tried before d/M because the workbook's timezone is America/Los_Angeles. Both are listed, and the
 * order only decides ambiguous dates: when the first number is above 12 the US reading is invalid anyway, so
 * d/M catches "13/08/2026" without ever hijacking a date the US reading could have parsed.
 */
const DATE_FORMATS = [
  'yyyy-MM-dd', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd H:mm',
  'M/d/yyyy', 'M/d/yyyy H:mm:ss', 'M/d/yyyy h:mm a', 'M/d/yy',
  'd/M/yyyy', 'd/M/yy',
  'MMMM d, yyyy', 'MMM d, yyyy'
];
function dayKeyFromCell(raw) {
  const t = text(raw);
  if (!t) return '';
  for (const format of DATE_FORMATS) {
    const d = DateTime.fromFormat(t, format, { zone });
    if (d.isValid) return dayKey(d);
  }
  const iso = DateTime.fromISO(t, { zone });
  return iso.isValid ? dayKey(iso) : '';
}
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
  matches = rows.filter((r) => dayKeyFromCell(r['Visit Date']) === wanted);
  /*
   * Say when a date could not be read at all, rather than counting it as "no visit that day". An unreadable
   * cell and an empty one are different findings, and the second one hid the first for as long as this bug
   * existed.
   */
  const unreadable = rows.filter((r) => text(r['Visit Date']) && !dayKeyFromCell(r['Visit Date']));
  if (unreadable.length) {
    console.log(`\nNOTE: ${unreadable.length} row(s) have a Visit Date this cannot read, so they were not`);
    console.log('      considered. They are listed here rather than silently skipped:');
    for (const r of unreadable.slice(0, 10)) {
      console.log(`        row ${r.__rowNumber}  ${text(r['Seller Name']) || '(no name)'} — `
        + `"${text(r['Visit Date'])}"`);
    }
  }
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
const already = await readSent();
const stamp = dayKey(DateTime.now());

for (const row of matches) {
  const who = text(row['Seller Name']) || `row ${row.__rowNumber}`;
  const address = text(row['Property Address']);
  const eventId = text(row['Calendar Event ID']);

  /*
   * Keyed on the ROW plus the day, so the same lead can legitimately be briefed again tomorrow (a visit that
   * moved) but not twice this morning. A typed request with --force always goes: somebody asking by hand has
   * a reason, and refusing them because a timer already sent one would be maddening.
   */
  const sentKey = `${row.__rowNumber}|${stamp}`;
  if (!FORCE && already[sentKey]) {
    console.log(`  ${who} — already briefed today at ${already[sentKey]}. Add --force to send it again.`);
    skipped += 1;
    continue;
  }

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

  if (posted) {
    sent += 1;
    console.log(`  ${who} — briefing posted to Chat.`);
    /*
     * Recorded only on a SUCCESSFUL send. Stamping the attempt would mean one Chat outage silences that
     * lead's briefing for the whole day — the same rule the REI logout alert follows, and for the same
     * reason: the failure mode of over-recording is silence nobody notices.
     */
    already[sentKey] = DateTime.now().setZone(zone).toFormat('h:mm a');
    await writeSent(already);
  } else {
    skipped += 1;
    console.log(`  ${who} — COULD NOT POST. Check the Chat webhook.`);
  }
}

console.log(`\n${sent} briefing(s) sent${skipped ? `, ${skipped} skipped` : ''}.`);
console.log(sent ? 'Open Google Chat and copy the block into the visit group.' : '');
process.exit(sent ? 0 : 1);
