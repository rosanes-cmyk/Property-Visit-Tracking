/**
 * See what the booked-appointment tasks on a REI contact actually look like — and whether the
 * completion selectors resolve — before anything is ever clicked.
 *
 *   node scripts/rei-task-doctor.mjs "https://my.reiblackbook.com/contacts/20528181"
 *
 * Strictly read-only. It opens the contact, reads the task rows, and reports. It clicks nothing.
 */
import fs from 'node:fs/promises';
import { launchReiContext, assertAuthenticated } from '../src/rei/browser.mjs';
import { readTasks } from '../src/rei/tasks.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
if (!url) {
  console.error('Usage: node scripts/rei-task-doctor.mjs "https://my.reiblackbook.com/contacts/20528181"');
  process.exit(1);
}

const selectors = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await assertAuthenticated(page, selectors.login || {});
await page.waitForSelector("a[href^='tel:'], a[href^='mailto:']", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3000);

console.log('\n=== Which task-row selector resolves ===');
for (const selector of selectors.tasks?.taskRows || []) {
  const count = await page.locator(selector).count().catch(() => 0);
  console.log(`${count ? 'OK      ' : 'no match'} ${selector}${count ? `  (${count} row(s))` : ''}`);
}

const tasks = await readTasks(page, selectors, { timezone: config.calendarTimezone });
console.log(`\n=== ${tasks.length} booked-appointment task(s) parsed ===`);
for (const task of tasks) {
  console.log(`  phone=${task.phone || '(none)'}  date=${task.date || '(none)'}  complete=${task.complete}`);
  console.log(`    "${task.title.slice(0, 110)}"`);
  if (!task.phone) console.log('    WARNING: no phone parsed — this task can never be matched to a visit');
  if (!task.date) console.log('    WARNING: no date parsed — this task can never be matched to a visit');
}
if (!tasks.length) {
  console.log('  None. Either this contact has no booked-appointment task, or every taskRows');
  console.log('  selector missed. Check the row count above before changing the parser.');
}

console.log('\n=== Is a completion control reachable inside a task row? ===');
if (tasks.length) {
  const row = page.locator(tasks[0].selector).nth(tasks[0].index);
  for (const candidate of selectors.tasks?.completeControl || []) {
    const visible = await row.locator(candidate).first().isVisible().catch(() => false);
    console.log(`${visible ? 'OK      ' : 'no match'} ${candidate}`);
  }
} else {
  console.log('  Skipped — no task row to look inside.');
}

console.log('\nNothing was clicked. Put any corrections into the "tasks" block of config/rei-selectors.json.');
await context.close();
