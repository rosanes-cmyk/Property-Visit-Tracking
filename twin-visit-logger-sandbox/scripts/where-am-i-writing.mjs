/**
 * Answer "it did not show up in the sheet / calendar" — by naming exactly what this .env points at.
 *
 *   node scripts/where-am-i-writing.mjs
 *
 * Read-only. It opens nothing and writes nothing. It exists because "Visit synchronized" is not an
 * answer when the workbook you are looking at is not the workbook that was written to.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';

const auth = await authorizeGoogle();

/* ---------- which Google account is this? ---------- */
const oauth = google.oauth2({ version: 'v2', auth });
const me = await oauth.userinfo.get().then((r) => r.data).catch(() => ({}));
console.log(`Authorized as: ${me.email || '(could not read the account email)'}`);
console.log('If that is not the account you expect, delete credentials/token.json and re-run');
console.log('node scripts/google-auth.mjs\n');

/* ---------- the workbook ---------- */
const sheets = google.sheets({ version: 'v4', auth });
console.log('=== SPREADSHEET ===');
console.log(`SPREADSHEET_ID = ${config.spreadsheetId}`);
console.log(`Link           = https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
try {
  const book = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  console.log(`Title          = "${book.data.properties?.title}"`);
  const tabs = (book.data.sheets || []).map((s) => s.properties.title);
  console.log(`TRACKER_SHEET  = "${config.trackerSheet}"` +
    (tabs.includes(config.trackerSheet) ? '   <- exists' : '   <- NOT A TAB IN THIS WORKBOOK'));
  console.log(`Tabs present   = ${tabs.map((t) => `"${t}"`).join(', ')}`);
  if (!tabs.includes(config.trackerSheet)) {
    console.log('\n  THIS IS THE PROBLEM: rows are being written to a tab name that does not exist');
    console.log(`  here. Set TRACKER_SHEET in .env to one of the tabs listed above (usually "Data").`);
  }
} catch (error) {
  console.log(`Title          = COULD NOT OPEN: ${error.message}`);
  console.log('  Either SPREADSHEET_ID is wrong, or this Google account has no access to it.');
}

/* ---------- the calendar ---------- */
console.log('\n=== CALENDAR ===');
const calendar = google.calendar({ version: 'v3', auth });
const wanted = String(config.calendarName || '').trim();
console.log(`CALENDAR_NAME  = ${wanted || '(not set — falling back to CALENDAR_ID)'}`);
console.log(`CALENDAR_ID    = ${config.calendarId}`);
try {
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const all = list.data.items || [];
  const hit = wanted
    ? all.find((c) => String(c.summary || '').trim().toLowerCase() === wanted.toLowerCase())
    : all.find((c) => c.id === config.calendarId);

  if (hit) {
    console.log(`Writing to     = "${hit.summary}"  (${hit.id})  [${hit.accessRole}]`);
    if (!['owner', 'writer'].includes(hit.accessRole)) {
      console.log('  WARNING: that access role cannot create events. It needs owner or writer');
      console.log('  ("Make changes to events"). A view-only share silently accepts nothing.');
    }
    /*
     * Show the visit events actually on it, so "not in the calendar" is checkable.
     *
     * UPCOMING events are listed in full and FIRST. maxResults was 20, which sounded harmless and was
     * not: sorted by start time from 30 days ago, the first twenty were all in the past, so a visit
     * booked for tomorrow was missing from the very listing whose job is to prove it is there. It read
     * as "the event was never created" when the event existed the whole time.
     */
    const res = await calendar.events.list({
      calendarId: hit.id, q: 'Property Visit', singleEvents: true, orderBy: 'startTime',
      timeMin: new Date(Date.now() - 30 * 86400000).toISOString(), maxResults: 250
    });
    const visits = (res.data.items || []).filter((e) => /^Property Visit\b/i.test(e.summary || ''));
    const now = Date.now();
    const startOf = (e) => new Date(e.start?.dateTime || e.start?.date || 0).getTime();
    const upcoming = visits.filter((e) => startOf(e) >= now);
    const past = visits.filter((e) => startOf(e) < now);

    console.log(`\nUPCOMING property visits on it: ${upcoming.length}` +
      '   <- these are the ones the WhatsApp watcher acts on');
    for (const e of upcoming) {
      console.log(`  ${e.start?.dateTime || e.start?.date}  ${e.summary}`);
      console.log(`      ${e.htmlLink}`);
    }
    if (!upcoming.length) {
      console.log('  None. No group will be created until a visit is booked in the future.');
    }

    console.log(`\nPast property visits in the last 30 days: ${past.length}` +
      (past.length ? '  (most recent last)' : ''));
    for (const e of past.slice(-5)) {
      console.log(`  ${e.start?.dateTime || e.start?.date}  ${e.summary}`);
    }
    if (past.length > 5) console.log(`  ...and ${past.length - 5} earlier`);

    if (!visits.length) {
      console.log('\n  Nothing at all. If a run reported "Visit synchronized", it wrote to a different calendar.');
    }
    if (res.data.nextPageToken) {
      console.log('\n  NOTE: there are more events than one page — this listing is not complete.');
    }
  } else {
    console.log('Writing to     = NOT FOUND in this account\'s calendar list.');
    console.log('Calendars this account can see:');
    for (const c of all) console.log(`  - "${c.summary}"  (${c.id})  [${c.accessRole}]`);
  }
} catch (error) {
  console.log(`Could not read the calendar list: ${error.message}`);
}

console.log('\nNothing was changed.');
