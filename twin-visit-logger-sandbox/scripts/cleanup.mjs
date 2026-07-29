/**
 * Remove everything this automation created, so testing can restart from a clean slate.
 *
 *   node scripts/cleanup.mjs            -> DRY RUN: lists what would be removed, changes nothing
 *   node scripts/cleanup.mjs --yes      -> actually removes it
 *
 * What it removes:
 *   1. Google Calendar events created by this tool (summary starts "Property Visit |", or carries
 *      our private reiLinkHash/reiRecordId property) in a -90d..+365d window.
 *   2. The Gmail labels THB-VisitLogger-Processed / THB-VisitLogger-Error from every message that
 *      has them, so those notifications are eligible to be processed again.
 *   3. Local debug captures and run state (debug/, data/).
 *
 * What it deliberately does NOT touch:
 *   - The tracker's rows. Use the workbook menu "Clear all data rows" for that: it preserves the
 *     dashboard's formula columns, which a blind range-clear from here would destroy.
 *   - Anything in REI BlackBook.
 */
import fs from 'node:fs/promises';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';

const APPLY = process.argv.includes('--yes');
const tag = APPLY ? 'REMOVED' : 'would remove';

const auth = await authorizeGoogle();

/* ---------- 1. Calendar events ---------- */
const calendar = google.calendar({ version: 'v3', auth });
const timeMin = DateTime.now().setZone(config.calendarTimezone).minus({ days: 90 }).toISO();
const timeMax = DateTime.now().setZone(config.calendarTimezone).plus({ days: 365 }).toISO();

let pageToken;
let calFound = 0;
do {
  const res = await calendar.events.list({
    calendarId: config.calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 250,
    pageToken
  });
  for (const event of res.data.items || []) {
    const priv = event.extendedProperties?.private || {};
    const ours = /^Property Visit \|/i.test(event.summary || '') || priv.reiLinkHash || priv.reiRecordId;
    if (!ours) continue;
    calFound += 1;
    const when = event.start?.dateTime || event.start?.date || '(no date)';
    console.log(`[calendar] ${tag}: ${when}  ${event.summary || '(no title)'}`);
    if (APPLY) {
      await calendar.events
        .delete({ calendarId: config.calendarId, eventId: event.id, sendUpdates: 'none' })
        .catch((error) => console.error(`  failed to delete ${event.id}: ${error.message}`));
    }
  }
  pageToken = res.data.nextPageToken;
} while (pageToken);
console.log(`[calendar] ${calFound} automation event(s) found.`);

/* ---------- 2. Gmail labels ---------- */
const gmail = google.gmail({ version: 'v1', auth });
const labelsRes = await gmail.users.labels.list({ userId: 'me' });
const wanted = [config.gmailProcessedLabel, config.gmailErrorLabel];
let mailFound = 0;

for (const name of wanted) {
  const label = labelsRes.data.labels?.find((l) => l.name === name);
  if (!label) {
    console.log(`[gmail] label "${name}" does not exist — nothing to clear.`);
    continue;
  }
  let token;
  const ids = [];
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [label.id],
      maxResults: 500,
      pageToken: token
    });
    for (const m of res.data.messages || []) ids.push(m.id);
    token = res.data.nextPageToken;
  } while (token);

  mailFound += ids.length;
  console.log(`[gmail] ${tag}: label "${name}" from ${ids.length} message(s).`);
  if (APPLY && ids.length) {
    // batchModify caps at 1000 ids per call.
    for (let i = 0; i < ids.length; i += 1000) {
      await gmail.users.messages
        .batchModify({ userId: 'me', requestBody: { ids: ids.slice(i, i + 1000), removeLabelIds: [label.id] } })
        .catch((error) => console.error(`  failed to unlabel batch: ${error.message}`));
    }
  }
}
console.log(`[gmail] ${mailFound} labelled message(s) found.`);

/* ---------- 3. Local files ---------- */
for (const dir of ['./debug', './data']) {
  const entries = await fs.readdir(dir).catch(() => null);
  if (entries === null) {
    console.log(`[local] ${dir} does not exist.`);
    continue;
  }
  console.log(`[local] ${tag}: ${entries.length} file(s) in ${dir}`);
  if (APPLY) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

console.log(
  APPLY
    ? '\nCleanup complete. Now clear the tracker rows from the workbook menu:\n' +
      '  Twin Visit Logger -> "Clear all data rows"  (preserves dashboard formulas)'
    : '\nDRY RUN — nothing was changed. Re-run with --yes to apply.'
);
