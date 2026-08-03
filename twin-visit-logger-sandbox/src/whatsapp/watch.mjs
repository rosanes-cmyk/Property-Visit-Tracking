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
import { planForEvents, suspiciousNumber } from './plan.mjs';
import { launchWhatsApp, assertLoggedIn, createGroup, groupExists } from './client.mjs';
import { launchReiContext, assertAuthenticated } from '../rei/browser.mjs';
import { readTasks, pickTaskForVisit, completeTask } from '../rei/tasks.mjs';
import { shouldCompleteTask } from '../rei/task-gate.mjs';
import { fieldFromDescription, localDay } from './plan.mjs';

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

  // Check the configured numbers before touching anything. A mistyped number does not fail loudly —
  // it just silently matches nobody, and the group ends up short a member.
  const numberWarnings = [];
  for (const [label, value] of [
    ['WHATSAPP_OWN_NUMBER', config.whatsappOwnNumber],
    ...config.whatsappTeamNumbers.map((n) => ['WHATSAPP_TEAM_NUMBERS', n])
  ]) {
    if (!value) continue;
    const problem = suspiciousNumber(value);
    if (problem) numberWarnings.push(`  ${label}: ${value} — ${problem}`);
  }
  if (numberWarnings.length) {
    console.log('CHECK YOUR .env — these numbers look wrong:');
    console.log(numberWarnings.join('\n'));
    console.log('');
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

  await clearReiTasks(create, state, calendar, calendarId);

  console.log(APPLY
    ? '\nDone.'
    : '\nDRY RUN — nothing was created or completed. Re-run with --yes once the above looks right.');
}

/**
 * Mark the REI task complete — the only write this project makes to REI.
 *
 * The interlock: re-read Juan's calendar to confirm the event is really there, and require that this
 * run recorded the WhatsApp group. Neither is taken on trust from earlier in the run, because the
 * whole point of leaving a task open is that it is the thing that makes a failure visible.
 */
async function clearReiTasks(plans, state, calendar, calendarId) {
  if (!config.reiCompleteTasks) {
    console.log('\nREI task completion is off (set REI_COMPLETE_TASKS=true in .env to enable).');
    return;
  }
  const done = plans.filter((p) => state.groups[p.eventId]);
  if (!done.length) return;

  console.log(`\n=== Clearing ${done.length} REI task(s) ===`);
  const selectors = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
  const rei = await launchReiContext({ headless: false });
  try {
    const page = rei.pages()[0] || (await rei.newPage());

    for (const plan of done) {
      console.log(`\n--- ${plan.name}`);

      // 1. Is the event really on Juan's calendar, right now?
      let calendarVerified = false;
      try {
        const event = await calendar.events.get({ calendarId, eventId: plan.eventId });
        calendarVerified = event.data.status !== 'cancelled';
      } catch (error) {
        console.log(`    calendar check failed: ${error.message}`);
      }

      // 2. Did the group actually get recorded?
      const groupVerified = Boolean(state.groups[plan.eventId]);

      // 3. Find the task on the contact page.
      const contactUrl = fieldFromDescription(plan.rawDescription, 'REI BlackBook');
      let task = null;
      const visit = {
        phone: plan.participants.find((p) => p.role === 'seller')?.number || plan.sellerPhone || '',
        date: localDay(new Date(plan.startIso), config.calendarTimezone)
      };

      if (!contactUrl) {
        console.log('    no REI link on the calendar event — cannot find the task');
      } else {
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await assertAuthenticated(page, selectors.login || {});
        await page.waitForTimeout(2500);
        const tasks = await readTasks(page, selectors, { timezone: config.calendarTimezone });
        task = pickTaskForVisit(tasks, visit);
        console.log(`    ${tasks.length} booked-appointment task(s) on the contact`);
      }

      const gate = shouldCompleteTask({
        enabled: config.reiCompleteTasks,
        apply: APPLY,
        task,
        visit,
        groupVerified,
        calendarVerified,
        alreadyComplete: Boolean(task?.complete)
      });

      console.log(`    calendar verified: ${calendarVerified} · group verified: ${groupVerified}`);
      if (!gate.complete) { console.log(`    NOT completing — ${gate.reason}`); continue; }

      const result = await completeTask(page, selectors, task);
      console.log(result.confirmed
        ? `    task marked complete (${result.clicked})`
        : `    clicked ${result.clicked || 'nothing'} but could not confirm — check REI by hand. Row now: ${result.rowText}`);
    }
  } finally {
    await rei.close();
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
