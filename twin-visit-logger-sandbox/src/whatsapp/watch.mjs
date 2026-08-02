/**
 * Watch Juan's calendar; create a WhatsApp group for each upcoming property visit.
 *
 *   node src/whatsapp/watch.mjs            -> DRY RUN. Lists what it would create, creates nothing.
 *   node src/whatsapp/watch.mjs --yes      -> actually creates the groups.
 *
 * Why the calendar and not the tracker: events land there from BOTH writers — this scraper and the
 * workbook's Apps Script — so watching the calendar covers every way a visit gets booked, and there
 * is exactly one definition of "a visit is happening".
 *
 * It never sends a message. It creates the group and stops.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { authorizeGoogle } from '../google/auth.mjs';
import { config } from '../config.mjs';
import { planForEvents } from './plan.mjs';
import { launchWhatsApp, assertLoggedIn, createGroup, groupExists } from './client.mjs';

const APPLY = process.argv.includes('--yes');
const STATE_FILE = path.resolve('./data/whatsapp-groups.json');

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { groups: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** Same rule as the calendar module: match by name so a shared calendar is found, and fail loudly. */
async function resolveCalendarId(calendar) {
  const wanted = String(config.calendarName || '').trim();
  if (!wanted) return config.calendarId;
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const hit = (list.data.items || []).find(
    (c) => String(c.summary || '').trim().toLowerCase() === wanted.toLowerCase()
  );
  if (!hit) throw new Error(`Calendar named "${wanted}" is not in this account's calendar list.`);
  return hit.id;
}

async function main() {
  if (!config.whatsappTeamNumbers.length && !config.whatsappIncludeSeller) {
    throw new Error('Nobody to add. Set WHATSAPP_TEAM_NUMBERS in .env (comma-separated).');
  }

  const auth = await authorizeGoogle();
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await resolveCalendarId(calendar);

  const now = new Date();
  const res = await calendar.events.list({
    calendarId,
    timeMin: new Date(now.getTime() - 12 * 3600 * 1000).toISOString(),
    timeMax: new Date(now.getTime() + config.whatsappLookaheadDays * 86400 * 1000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });
  const events = res.data.items || [];

  const state = await readState();
  const { create, skipped } = planForEvents(events, {
    timezone: config.calendarTimezone,
    teamNumbers: config.whatsappTeamNumbers,
    includeSeller: config.whatsappIncludeSeller,
    ownNumber: config.whatsappOwnNumber,
    template: config.whatsappGroupTemplate,
    now,
    alreadyDone: new Set(Object.keys(state.groups))
  });

  console.log(`Calendar: ${calendarId}`);
  console.log(`${events.length} event(s) in the next ${config.whatsappLookaheadDays} days`);
  console.log(`${create.length} group(s) to create · ${skipped.length} skipped\n`);

  for (const s of skipped) {
    const title = s.event?.summary || '(no title)';
    if (s.reason === 'not a Property Visit event') continue;   // other people's meetings, not news
    console.log(`  skip: ${title} — ${s.reason}`);
  }
  if (!create.length) {
    console.log('\nNothing to do.');
    return;
  }

  console.log(`\nMode: ${APPLY ? 'CREATE' : 'DRY RUN (nothing will be created)'}\n`);
  for (const plan of create) {
    console.log(`  "${plan.name}"  ${plan.startLocal}`);
    console.log(`     ${plan.address}`);
    for (const p of plan.participants) console.log(`     + ${p.role.padEnd(6)} ${p.number}`);
    if (plan.sellerIncluded) console.log('     NOTE: the seller is in this group and can read everything posted in it.');
  }

  const context = await launchWhatsApp({
    userDataDir: config.whatsappUserDataDir,
    headless: false,
    timezone: config.calendarTimezone
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const selectors = JSON.parse(await fs.readFile(config.whatsappSelectorConfig, 'utf8'));
    await assertLoggedIn(page, selectors);

    for (const plan of create) {
      console.log(`\n--- ${plan.name}`);

      // Self-healing: if the group is already on WhatsApp, record it and move on. This is what
      // makes a lost state file harmless instead of a source of duplicate groups.
      if (await groupExists(page, selectors, plan.name)) {
        console.log('    already exists on WhatsApp — recording it, not creating another');
        state.groups[plan.eventId] = { name: plan.name, foundExisting: true, at: new Date().toISOString() };
        await writeState(state);
        continue;
      }

      const report = await createGroup(page, selectors, {
        name: plan.name,
        participants: plan.participants,
        apply: APPLY
      });
      for (const line of report.steps) console.log(`    ${line}`);
      if (report.notFound.length) {
        console.log(`    NOT ON WHATSAPP (skipped): ${report.notFound.join(', ')}`);
      }
      if (report.created) {
        state.groups[plan.eventId] = {
          name: plan.name,
          participants: report.added,
          at: new Date().toISOString()
        };
        await writeState(state);
        console.log('    recorded');
      }
    }
  } finally {
    await context.close();
  }

  console.log(APPLY
    ? '\nDone.'
    : '\nDRY RUN — nothing was created. Re-run with --yes once the numbers above look right.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
