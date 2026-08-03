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
check('...with the reason recorded', shouldCompleteTask(ready).reason, 'group and calendar both verified');

const why = (overrides) => shouldCompleteTask({ ...ready, ...overrides }).reason;
const allowed = (overrides) => shouldCompleteTask({ ...ready, ...overrides }).complete;

console.log('\n--- refusals ---');
check('switched off', allowed({ enabled: false }), false);
check('...says so', why({ enabled: false }), 'REI task completion is switched off (REI_COMPLETE_TASKS)');
check('no group -> task stays open', allowed({ groupVerified: false }), false);
check('...says so', why({ groupVerified: false }), 'WhatsApp group not verified — leaving the task open');
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

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
