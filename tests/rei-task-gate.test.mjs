/**
 * REI task-completion gate.
 *
 *   node tests/rei-task-gate.test.mjs
 *
 * This is the only write this project makes to REI, and the automation will never undo it. The gate
 * decides when that write is allowed, so the tests below are mostly about it REFUSING: every path
 * that could clear a task for a visit that is not actually booked, or clear the wrong task.
 *
 * Functions are imported from the shipped module, so they cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  samePhone, taskMatchesVisit, shouldCompleteTask, assertCompletionSelector
} from '../twin-visit-logger-sandbox/src/rei/task-gate.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== Phone matching ===');
check('same number, different formatting', samePhone('(650) 771-7814', '+1 650 771 7814'), true);
check('different number', samePhone('(650) 771-7814', '(650) 771-7815'), false);
check('a partial never matches', samePhone('7814', '(650) 771-7814'), false);
check('empty never matches', samePhone('', ''), false);

console.log('\n=== A task belongs to a visit only if phone AND date agree ===');
const visit = { phone: '(650) 771-7814', date: '2026-08-05' };
check('same phone and date', taskMatchesVisit({ phone: '6507717814', date: '2026-08-05' }, visit), true);
check('same seller, DIFFERENT date -> not this visit',
  taskMatchesVisit({ phone: '6507717814', date: '2026-09-01' }, visit), false);
check('same date, different seller', taskMatchesVisit({ phone: '4155550100', date: '2026-08-05' }, visit), false);
check('task with no date', taskMatchesVisit({ phone: '6507717814', date: '' }, visit), false);
check('no task', taskMatchesVisit(null, visit), false);

console.log('\n=== The gate refuses unless everything is verified ===');
const task = { phone: '6507717814', date: '2026-08-05' };
const ready = { enabled: true, apply: true, task, visit, groupVerified: true, calendarVerified: true };

check('everything verified -> complete', shouldCompleteTask(ready).complete, true);
check('...with the reason recorded', shouldCompleteTask(ready).reason,
  'calendar verified and the WhatsApp group confirmed');

const why = (overrides) => shouldCompleteTask({ ...ready, ...overrides }).reason;
const allowed = (overrides) => shouldCompleteTask({ ...ready, ...overrides }).complete;

console.log('\n--- refusals ---');
check('switched off', allowed({ enabled: false }), false);
check('...says so', why({ enabled: false }), 'REI task completion is switched off (REI_COMPLETE_TASKS)');
check('no handover at all -> task stays open', allowed({ groupVerified: false }), false);
check('...says so', why({ groupVerified: false }),
  'no handover confirmed — no WhatsApp group, Chat briefing or dashboard row — leaving the task open');

console.log('\n--- the Chat briefing counts as the handover ---');
/*
 * WhatsApp is out: the client's number is restricted. A rule that insists on a group can never be
 * satisfied, so the task would stay open forever — not caution, a broken feature. The client's wording:
 * "completing the task once added in the calendar, sending the notif the gc, and got task appointment,
 * and then complete task."
 *
 * The Chat briefing carries the same content to the same team, and this project can PROVE it posted,
 * because notifyChat reports whether the webhook accepted it. That proof is the whole basis for
 * accepting it — "the briefing feature is switched on" would not be.
 */
check('a posted Chat briefing is enough',
  allowed({ groupVerified: false, briefingPosted: true }), true);
check('...and the reason names it, not the group',
  why({ groupVerified: false, briefingPosted: true }),
  'calendar verified and the Chat briefing confirmed');
check('a group alone is still enough',
  allowed({ groupVerified: true, briefingPosted: false }), true);
check('both is fine and reads as the group',
  why({ groupVerified: true, briefingPosted: true }),
  'calendar verified and the WhatsApp group confirmed');
/* The calendar is not optional just because the briefing went out. */
check('briefing without a calendar event still refuses',
  allowed({ groupVerified: false, briefingPosted: true, calendarVerified: false }), false);
/* And a briefing cannot rescue a task that does not match this visit. */
check('briefing does not excuse a mismatched task',
  allowed({ groupVerified: false, briefingPosted: true, task: { phone: '6507717814', date: '2026-09-09' } }),
  false);
check('no calendar event -> task stays open', allowed({ calendarVerified: false }), false);
check('...says so', why({ calendarVerified: false }),
  "calendar event not verified on Juan's calendar — leaving the task open");
check('neither verified', allowed({ groupVerified: false, calendarVerified: false }), false);
check('no task found', allowed({ task: null }), false);
check('already complete is not re-completed', allowed({ alreadyComplete: true }), false);
check('wrong task (different date) is never completed',
  allowed({ task: { phone: '6507717814', date: '2026-12-25' } }), false);
check('dry run never writes', allowed({ apply: false }), false);
check('...and says it would have', why({ apply: false }), 'dry run — would complete the task');
check('a call with no arguments at all refuses', shouldCompleteTask().complete, false);

console.log('\n=== Order of refusals: the off switch wins over everything ===');
check('off + unverified + no task -> reports being off',
  why({ enabled: false, groupVerified: false, task: null }),
  'REI task completion is switched off (REI_COMPLETE_TASKS)');

console.log('\n=== Destructive selectors are rejected outright ===');
check('a complete control is fine', assertCompletionSelector("[data-testid='task-complete']"),
  "[data-testid='task-complete']");
check('"done" is fine', assertCompletionSelector("button:has-text('Mark done')"), "button:has-text('Mark done')");
for (const bad of [
  "[data-testid='task-delete']",
  "button:has-text('Delete')",
  "[aria-label='Remove task']",
  "[title='Archive']",
  "button:has-text('Cancel appointment')",
  "[data-testid='discard']"
]) {
  let threw = false;
  try { assertCompletionSelector(bad); } catch { threw = true; }
  check(`refused: ${bad}`, threw, true);
}


console.log('\n=== The intake is now where the task gets completed ===');
/*
 * It used to live only in the WhatsApp watcher, which is switched off — so with WhatsApp out, the write
 * had no path to run at all and REI_COMPLETE_TASKS=true would have done nothing at all, silently.
 *
 * These pin the shape of that call rather than the browser work: the three conditions the client named,
 * each taken from something re-checked rather than remembered.
 */
const PROC = fs.readFileSync(
  path.resolve('twin-visit-logger-sandbox/src/services/process.mjs'), 'utf8');

check('the intake can complete a task', /shouldCompleteTask\(\{/.test(PROC), true);
check('...only when REI_COMPLETE_TASKS is on',
  /if \(config\.reiCompleteTasks && !config\.dryRun\) \{/.test(PROC), true);
/*
 * `posted` is notifyChat's return value — whether the webhook ACCEPTED the message. Passing `true`, or
 * config.chatVisitBriefing, would mean a silently failed webhook still cleared the task, and the open
 * task is the only thing that would have made anyone notice.
 */
/*
 * The handover proof is now the DASHBOARD ROW, not the posted message, because the client wanted the
 * closure reported in the same Chat message: "i need the template that will notify in the gc about
 * booked and the task is completed." To report it, it has to have already happened.
 *
 * The row is a fair substitute and arguably the better one: it is what the team works from and what the
 * 11am/3pm cards are built from, and unlike a chat message it does not scroll away. The condition was
 * never "a message was sent" — it was "the booking is recorded somewhere a person will see it".
 */
check('the handover proof is the row the sheet write reported',
  /rowWritten: Boolean\(written\)/.test(PROC), true);
/* And the closure must happen BEFORE the message, or it cannot be in it. */
check('the task is closed before the Chat message is composed',
  PROC.indexOf('shouldCompleteTask({') < PROC.indexOf('await notifyChat('), true);
check('the outcome becomes a line in that message',
  /taskLine = /.test(PROC) && /taskLine,/.test(PROC), true);
check('...a tick when confirmed', /✅ REI task closed —/.test(PROC), true);
check('...a warning when not', /⚠️ REI task still open —/.test(PROC), true);
/*
 * An unconfirmed click reads as a warning, never a tick. completeTask re-reads the row; a tick nobody
 * can trust is worse than a warning, because it stops anybody going to look.
 */
check('an unconfirmed click is not reported as closed',
  /the click was not confirmed/.test(PROC), true);
/* And with REI_COMPLETE_TASKS off the line is absent, rather than claiming anything either way. */
check('no task line at all when the feature is off', /\.filter\(Boolean\)\.join/.test(PROC), true);
/*
 * Closing the task is not a briefing feature. Tying it to CHAT_VISIT_BRIEFING would mean switching the
 * briefing off silently stops REI being kept tidy.
 */
check('completion is outside the briefing gate',
  PROC.indexOf('if (config.reiCompleteTasks && !config.dryRun)')
    < PROC.indexOf('if (!config.dryRun && config.chatVisitBriefing)'), true);
check('the calendar condition is the event id Google returned',
  /calendarVerified: Boolean\(calendarEventId\)/.test(PROC), true);
/*
 * A dry run never reaches the completion at all now — the whole block is behind !config.dryRun — so
 * `apply: true` inside it is correct rather than lax. Asserting the outer guard is the real check.
 */
check('a dry run never reaches the completion',
  /if \(config\.reiCompleteTasks && !config\.dryRun\)/.test(PROC), true);
check('...and a dry run is still refused by the gate itself',
  shouldCompleteTask({ ...ready, apply: false }).complete, false);
check('an already-complete task is not re-clicked',
  /alreadyComplete: Boolean\(task\?\.complete\)/.test(PROC), true);
check('the task is matched on this visit, not just found',
  /pickTaskForVisit\(tasks, visitKey\)/.test(PROC), true);

/*
 * And it must never cost the delivery. By the time this runs the row, the calendar event and the
 * briefing have all landed; a REI page that will not load is a loose end, not a reason to fail the email
 * and re-process it.
 */
check('a failure here is caught, not fatal', /catch \(taskError\)/.test(PROC), true);
check('...and says the task stays open', /it stays open/.test(PROC), true);
check('the completion page is always closed', /await page\.close\(\)\.catch/.test(PROC), true);

/* The gate runs BEFORE any click. Reversing those two would complete first and ask afterwards. */
check('the gate is consulted before the click',
  PROC.indexOf('shouldCompleteTask({') < PROC.indexOf('await completeTask('), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
