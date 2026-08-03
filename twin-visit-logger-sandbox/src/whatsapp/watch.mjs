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
 * The one message it posts is the inspection note, into the group it just created and nowhere else —
 * WHATSAPP_POST_NOTE=false turns that off. It never messages a seller and never replies to anyone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { authorizeGoogle } from '../google/auth.mjs';
import { config } from '../config.mjs';
import { planForEvents, suspiciousNumber } from './plan.mjs';
import {
  launchWhatsApp, assertLoggedIn, createGroup, groupExists, warmUpNumbers, postGroupNote,
  openGroupByName
} from './client.mjs';
import { buildInspectionNote, containsSellerSensitive } from './note.mjs';
import { eventsFinished, MAX_TASK_ATTEMPTS } from './post-gate.mjs';
import { launchReiContext, assertAuthenticated } from '../rei/browser.mjs';
import { readTasks, pickTaskForVisit, completeTask } from '../rei/tasks.mjs';
import { shouldCompleteTask } from '../rei/task-gate.mjs';
import { acquireLock } from '../utils/lock.mjs';
import { notifyChat } from '../utils/notify.mjs';
import { fieldFromDescription, blockFromDescription, reiLinkFromDescription, localDay } from './plan.mjs';

/*
 * Bump this on every change shipped as a zip.
 *
 * Four separate diagnoses in this project have been wrong because a zip was extracted somewhere other
 * than the folder Node loads from, and the old code kept running while the new behaviour was being
 * looked for. The banner ends that: the build and the actual file path are the first thing printed, so
 * "did my update land?" is answered before anything else happens.
 */
const BUILD = '2026-08-03-note-31';

const APPLY = process.argv.includes('--yes');

/*
 * --force ignores data/whatsapp-groups.json entirely and re-checks every visit against WhatsApp.
 * For when the record and reality have parted company — groups deleted by hand, a state file copied
 * between machines. Nothing is duplicated by it: WhatsApp is still asked what exists first.
 */
const FORCE = process.argv.includes('--force');

/*
 * --rewarm re-resolves every number through wa.me even if it is already in the chat list. Slow, and
 * only needed if a chat has been deleted and the picker can no longer find someone.
 */
const REWARM = process.argv.includes('--rewarm');

/*
 * --repost-note forgets that a note was already sent for the selected visits, so one gets posted again.
 * For when a note went out wrong and was deleted by hand.
 *
 * This is NOT a licence to spam: postGroupNote still reads the open conversation and refuses if the
 * note is already there. The state flags are the belt; that check is the braces. So this reposts only
 * when the note is genuinely gone.
 */
const REPOST_NOTE = process.argv.includes('--repost-note');

/*
 * --only "text"  restricts the run to groups whose name contains that text, case-insensitively.
 * For trying something out on the test lead without touching a real seller's visit:
 *   node src/whatsapp/watch.mjs --yes --only "Test, Test"
 */
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';
})();
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
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const all = list.data.items || [];
  const wanted = String(config.calendarName || '').trim();

  if (!wanted) {
    // Falling back to CALENDAR_ID silently is how a run ends up reading somebody's personal primary
    // calendar, finding 29 unrelated meetings, and reporting "nothing to do" as if all were well.
    const fallback = all.find((c) => c.id === config.calendarId);
    console.log(`WARNING: CALENDAR_NAME is not set in .env, so this is using CALENDAR_ID.`);
    console.log(`         That resolves to: ${config.calendarId}` +
      (fallback ? ` ("${fallback.summary}")` : ' (not in this account\'s calendar list)'));
    console.log(`         For the property visits, set:  CALENDAR_NAME=Juan's Official Calendar`);
    console.log(`         Calendars this account can see:`);
    for (const c of all) console.log(`           - "${c.summary}"  [${c.accessRole}]`);
    console.log('');
    return { id: config.calendarId, name: fallback ? fallback.summary : '(unknown)' };
  }

  const hit = all.find((c) => String(c.summary || '').trim().toLowerCase() === wanted.toLowerCase());
  if (!hit) {
    throw new Error(
      `Calendar named "${wanted}" is not in this account's calendar list.\n` +
      `This account can see:\n` +
      all.map((c) => `  - "${c.summary}"  [${c.accessRole}]`).join('\n') +
      `\n\nIf Juan's calendar is not listed, the wrong Google account is authorized. ` +
      `Delete credentials/token.json and run: node scripts/google-auth.mjs`
    );
  }
  return { id: hit.id, name: hit.summary };
}

async function main() {
  // Printed first, before any work: which build this is, which file is really executing, and whether
  // the note will be posted. Three facts that have each cost a wrong diagnosis when left unstated.
  console.log(`Twin Visit Logger · WhatsApp watch · build ${BUILD}`);
  console.log(`Running: ${fileURLToPath(import.meta.url)}`);
  console.log(`Note posting: ${config.whatsappPostNote ? 'ON' : 'OFF (WHATSAPP_POST_NOTE=false)'}` +
    `${FORCE ? ' · --force: ignoring the state file' : ''}\n`);

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
  const target = await resolveCalendarId(calendar);
  const calendarId = target.id;

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
  const { create: planned, skipped } = planForEvents(events, {
    timezone: config.calendarTimezone,
    teamNumbers: config.whatsappTeamNumbers,
    includeSeller: config.whatsappIncludeSeller,
    ownNumber: config.whatsappOwnNumber,
    defaultCountry: config.phoneDefaultCountry,
    template: config.whatsappGroupTemplate,
    now,
    /*
     * "Done" means the group exists AND, when note posting is on, the note is in it. Treating a
     * recorded group as finished regardless is what left the first real group sitting in WhatsApp
     * with no note and no way back to it: the next run skipped the event before ever looking.
     */
    alreadyDone: (FORCE || REPOST_NOTE)
      ? new Set()
      : eventsFinished(state.groups, {
        requireNote: config.whatsappPostNote,
        requireTaskClosed: config.reiCompleteTasks
      })
  });

  const create = ONLY ? planned.filter((p) => p.name.toLowerCase().includes(ONLY)) : planned;

  // Clear the note flags only for the visits this run is actually touching, so --repost-note --only
  // cannot quietly re-open every other group's note as well.
  if (REPOST_NOTE) {
    for (const plan of create) {
      const entry = state.groups[plan.eventId];
      if (!entry) continue;
      delete entry.notePosted;
      delete entry.noteAttemptedAt;
    }
    await writeState(state);
    console.log(`--repost-note → the note will be sent again for ${create.length} visit(s), ` +
      'unless it is still in the group.\n');
  }
  if (ONLY) {
    console.log(`--only "${ONLY}" → ${create.length} of ${planned.length} kept; ` +
      `${planned.length - create.length} left alone this run\n`);
  }

  console.log(`Calendar: "${target.name}"  (${calendarId})`);
  console.log(`${events.length} event(s) in the next ${config.whatsappLookaheadDays} days`);
  console.log(`${create.length} group(s) to create · ${skipped.length} skipped\n`);

  // Group the skips by reason. A bare "29 skipped" hides the difference between "29 unrelated
  // meetings, working as intended" and "pointed at entirely the wrong calendar".
  const byReason = {};
  for (const s of skipped) (byReason[s.reason] = byReason[s.reason] || []).push(s.event?.summary || '(no title)');
  for (const reason of Object.keys(byReason)) {
    const titles = byReason[reason];
    console.log(`  ${titles.length} × ${reason}`);
    for (const t of titles.slice(0, 5)) console.log(`      ${t}`);
    if (titles.length > 5) console.log(`      …and ${titles.length - 5} more`);
  }

  if (!create.length) {
    console.log('\nNothing to do.');
    // "group already created" is a claim about the state FILE, and the file can be wrong — a group
    // deleted by hand is still recorded in it. Say so, rather than leaving a dead end.
    // The reason carries the group name — "group already created (1390 Estudillo Ave, …)" — so this
    // matches on the prefix. An exact key lookup silently never fires, which is worse than no hint.
    if (Object.keys(byReason).some((r) => r.startsWith('group already created'))) {
      console.log('\nThose are recorded in data\\whatsapp-groups.json as already done. If a group was');
      console.log('deleted by hand, or you want every visit re-checked against WhatsApp itself:');
      console.log('  node src\\whatsapp\\watch.mjs --yes --force');
      console.log('Nothing gets duplicated — WhatsApp is asked what exists before anything is created.');
    }
    if (byReason['not a Property Visit event']?.length === events.length && events.length) {
      console.log('\nNONE of the events on this calendar are property visits. Either this is the');
      console.log('wrong calendar, or no visit has been booked yet. A visit event is titled');
      console.log('"Property Visit - <address>" and is created by the tracker, not by hand.');
    }
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

    /*
     * PASS 1 — ask WHATSAPP what already exists, before doing anything else.
     *
     * WhatsApp is the authority on which groups exist, never the state file. The state file said both
     * groups existed at a moment when they had just been deleted by hand; a run that trusted it would
     * have skipped the warm-up, walked into the picker with unresolvable numbers, and produced two
     * groups of nobody. So existence is established here, live, and the rest of the run follows from
     * that answer.
     *
     * A group that exists but never got its note is given it here — that is what brings a group
     * created before note-posting worked back into line, without anyone deleting and rebuilding it.
     */
    const needCreating = [];
    for (const plan of create) {
      console.log(`\n--- ${plan.name}`);
      if (!(await groupExists(page, selectors, plan.name))) {
        console.log('    not on WhatsApp yet');
        needCreating.push(plan);
        continue;
      }

      console.log('    already exists on WhatsApp — recording it, not creating another');
      state.groups[plan.eventId] = {
        ...(state.groups[plan.eventId] || {}),
        name: plan.name,
        foundExisting: true,
        at: new Date().toISOString()
      };
      await writeState(state);

      if (config.whatsappPostNote) {
        const opened = await openGroupByName(page, selectors, plan.name);
        if (!opened.opened) {
          console.log(`    could not open it to post the note: ${opened.reason}`);
        } else {
          // Recorded BEFORE typing: an unverifiable attempt must not become a repeat.
          state.groups[plan.eventId].noteAttemptedAt = new Date().toISOString();
          await writeState(state);
          state.groups[plan.eventId].notePosted = await maybePostNote(page, selectors, plan);
          await writeState(state);
        }
      }
    }

    if (!needCreating.length) {
      console.log('\nEvery group already existed — no group was created this run.');
    }

    /*
     * PASS 2 — make the numbers findable, but only if a group is actually being built.
     *
     * WhatsApp's group picker only searches saved contacts and numbers you already have a chat with.
     * A perfectly valid team number that is neither returns no results, and the group silently comes
     * out short. Resolving each number first through wa.me puts a chat in the list so the picker can
     * find it — and tells us definitively which numbers have no WhatsApp account at all.
     *
     * A note-only run has no picker to fill, so it skips this: opening four chats is visible in four
     * other people's WhatsApp, and doing it for nothing is not free.
     */
    const everyNumber = [...new Set(needCreating.flatMap((p) => p.participants.map((x) => x.number)))];

    /*
     * ...and only for numbers not already warmed up. This is the slow part of the whole run by a wide
     * margin: each number means navigating to wa.me, which RELOADS WhatsApp Web from scratch and makes
     * it re-sync its message store. Four numbers is minutes, and it was being paid on every single run.
     *
     * Once a number has a chat in the list it stays there, so warming it a second time achieves
     * nothing. The cache is self-correcting: if the picker later fails to find a number, that number is
     * dropped from the cache below so the next run warms it again.
     */
    state.warmed = state.warmed || {};
    const cold = REWARM ? everyNumber : everyNumber.filter((n) => !state.warmed[n]);
    const alreadyWarm = everyNumber.length - cold.length;

    if (alreadyWarm) {
      console.log(`\n${alreadyWarm} number(s) already have a chat in the list — skipping their warm-up` +
        ' (this is the slow part; --rewarm forces it).');
    }
    if (cold.length) {
      console.log(`\nMaking ${cold.length} number(s) findable in the group picker...`);
      console.log('  Each one reloads WhatsApp Web, which takes a while. This only happens once per number.');
      const reach = await warmUpNumbers(page, cold, selectors);
      if (reach.onWhatsApp.length) console.log(`  on WhatsApp: ${reach.onWhatsApp.join(', ')}`);
      if (reach.notOnWhatsApp.length) {
        console.log(`  NO WhatsApp account: ${reach.notOnWhatsApp.join(', ')}`);
        console.log('  Those cannot be added by anyone, automation or not. Check the digits, or the');
        console.log('  person genuinely does not use WhatsApp on that number.');
      }
      for (const n of reach.onWhatsApp) state.warmed[n] = new Date().toISOString();
      await writeState(state);
    }

    // PASS 3 — create what is missing, and post its note.
    for (const plan of needCreating) {
      console.log(`\n--- ${plan.name}`);

      const report = await createGroup(page, selectors, {
        name: plan.name,
        participants: plan.participants,
        apply: APPLY
      });
      for (const line of report.steps) console.log(`    ${line}`);
      if (report.notFound.length) {
        console.log(`    NOT FOUND IN THE PICKER (skipped): ${report.notFound.join(', ')}`);
        /*
         * Forget these, so the next run warms them up again rather than trusting a cache that has just
         * been proved wrong. Without this, one number that dropped out of the chat list would be
         * skipped forever and every future group would quietly come out a member short.
         */
        for (const n of report.notFound) delete state.warmed[n];
        await writeState(state);
        console.log('    (their warm-up was cleared — the next run will resolve them again)');
      }
      if (report.created) {
        state.groups[plan.eventId] = {
          name: plan.name,
          participants: report.added,
          at: new Date().toISOString()
        };
        await writeState(state);
        console.log('    recorded');
        state.groups[plan.eventId].noteAttemptedAt = new Date().toISOString();
        await writeState(state);
        const noteWent = await maybePostNote(page, selectors, plan);
        state.groups[plan.eventId].notePosted = noteWent;
        await writeState(state);
        if (!noteWent) {
          console.log('    the note is NOT confirmed in the group. It will NOT be retried —');
          console.log('    check the group and post it by hand if it is missing.');
        }
        await notifyChat(
          `WhatsApp group created — ${plan.name}` +
          `\n${plan.startLocal} · ${report.added.length} member(s) added` +
          (noteWent ? '\nInspection note posted.' : '\nThe note did NOT go out — it needs posting by hand.'),
          { kind: noteWent ? 'ok' : 'warn' }
        );
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
 * Post the inspection note into the group, which must already be the conversation on screen.
 *
 * Returns true when the note is in the group — including when it was already there from an earlier
 * run, because the caller records "this event needs nothing more", not "keys were pressed".
 *
 * On unless WHATSAPP_POST_NOTE=false. The note carries the facts REI holds and leaves the rest as
 * visible blanks, because REI has no fields for motivation, occupancy, condition, known issues or any
 * of the PropertyRadar figures.
 */
async function maybePostNote(page, selectors, plan) {
  if (!config.whatsappPostNote) {
    console.log('    note not posted (WHATSAPP_POST_NOTE=false)');
    return false;
  }

  const from = (label) => fieldFromDescription(plan.rawDescription, label);
  const block = (heading) => blockFromDescription(plan.rawDescription, heading);
  /*
   * Everything is read from the calendar description's LABELLED LINES.
   *
   * The description is now a summary written by the calendar module — the same parsers, run once, upstream
   * — rather than REI's notes pasted in. So there is nothing to re-parse here, and the work is no longer
   * done twice from the same text. block('Notes') is kept only as a fallback for events written before
   * this change.
   */
  const note = buildInspectionNote({
    propertyAddress: plan.address,
    sellerName: from('Seller'),
    phone: from('Phone'),
    reiLink: reiLinkFromDescription(plan.rawDescription),
    leadSource: from('Lead Source'),
    contactStage: from('Contact Stage'),
    assignedOwner: from('Assigned Owner'),

    leaveOffice: from('Leave Office'),
    driveTime: from('Drive Time'),
    mapsLink: from('Maps'),

    estimatedValue: from('Estimated Value'),
    assessedValue: from('Assessed Value'),
    openLoansBalance: from('Estimated Open Loans Balance'),
    estimatedEquity: from('Estimated Equity'),
    purchaseDate: from('Purchase Date'),
    occupancy: from('Occupancy'),
    vestedOwner: from('Vested Owner'),

    motivationLevel: from('Motivation Level'),
    reasonForSelling: from('Reason for Selling'),
    propertyCondition: from('Property Condition'),
    knownIssues: from('Known Issues'),
    timeline: from('Timeline'),
    priceExpectation: from('Price Expectation'),
    callSummary: from('Call Summary'),
    nextStep: from('Next Step'),

    // Events written before the description became a summary still carry the raw blocks.
    notes: block('Notes'),
    nextAction: from('Next Action')
  }, { appointmentText: plan.startLocal, includeSellerWarning: plan.sellerIncluded });

  /*
   * Hard stop. The note names "Estimated Equity", "Motivation Level" and so on even when the values
   * are blank, and a seller reading those headings learns what is being assessed about them. If a
   * seller is in the group, it does not go out — regardless of the config flag.
   */
  if (plan.sellerIncluded) {
    const sensitive = containsSellerSensitive(note);
    if (sensitive.length) {
      console.log(`    NOTE NOT POSTED — the seller is in this group and the note covers: ${sensitive.join(', ')}`);
      console.log('    Either set WHATSAPP_INCLUDE_SELLER=false, or post a shortened note by hand.');
      return false;
    }
  }

  const posted = await postGroupNote(page, selectors, {
    groupName: plan.name,
    text: note,
    apply: APPLY
  });
  console.log(`    note: ${posted.reason}`);
  return posted.posted;
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
  /*
   * The task is only closed once the briefing is actually IN the group.
   *
   * A group with no note is not a handover — whoever opens it learns nothing about the property. And
   * because an unconfirmed note is never retried, leaving the task open is the only thing left that
   * makes that visible to a person. So the interlock is: calendar event + group + note.
   */
  const done = plans.filter((p) => {
    const entry = state.groups[p.eventId];
    if (!entry) return false;
    if (config.whatsappPostNote && !entry.notePosted) {
      console.log(`\n--- ${p.name}\n    NOT closing the REI task: the note is not confirmed in the group.`);
      return false;
    }
    return true;
  });
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
      const contactUrl = reiLinkFromDescription(plan.rawDescription);
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

      const entry = state.groups[plan.eventId];
      entry.reiTaskAttempts = (entry.reiTaskAttempts || 0) + 1;

      const result = await completeTask(page, selectors, task);
      entry.reiTaskClosed = Boolean(result.confirmed);
      await writeState(state);

      console.log(result.confirmed
        ? `    task marked complete (${result.clicked})`
        : `    clicked ${result.clicked || 'nothing'} but could not confirm — check REI by hand. Row now: ${result.rowText}`);
      if (!result.confirmed && entry.reiTaskAttempts >= MAX_TASK_ATTEMPTS) {
        console.log(`    ${entry.reiTaskAttempts} attempts — giving up on this task. Close it in REI by hand.`);
        console.log('    Nothing else about this visit is affected; the group and the note are done.');
      }
      await notifyChat(
        result.confirmed
          ? `REI task marked complete — ${plan.name}\nThe visit is on the calendar and the group exists, so the task is closed.`
          : `REI task may NOT be complete — ${plan.name}\nClicked ${result.clicked || 'nothing'} but could not confirm. Check REI by hand.`,
        { kind: result.confirmed ? 'ok' : 'warn' }
      );
    }
  } finally {
    await rei.close();
  }
}

/*
 * A second run must not start while one is in flight. Playwright's persistent profile is locked by
 * the running instance, so an overlapping launch cannot open WhatsApp at all — and on a schedule
 * that would look like a random failure rather than two runs colliding. Its own named lock, separate
 * from the REI scrape's, so the two schedules never block each other.
 */
const release = await acquireLock('whatsapp');
if (!release) {
  console.log('Another WhatsApp run is still going — exiting so the two do not collide.');
  process.exit(0);
}
try {
  await main();
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  await release();
  process.exit(1);
}
await release();
