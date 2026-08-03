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

/*
 * Dump what IS inside the row.
 *
 * Reporting "no match" for six candidates says the guesses were wrong and nothing about what is right.
 * Every WhatsApp selector in this project was resolved by dumping real markup and reading the answer off
 * it, and a run has now failed with "no completion control found inside the task row" — so the same
 * approach applies here. This prints the row's own HTML and every identifiable element in it.
 */
if (tasks.length) {
  const row = page.locator(tasks[0].selector).nth(tasks[0].index);

  console.log('\n=== Everything identifiable INSIDE the first task row ===');
  const inside = await row.evaluate((el) => {
    const out = [];
    for (const node of el.querySelectorAll('*')) {
      const attrs = ['data-testid', 'data-test', 'aria-label', 'role', 'title', 'type', 'name', 'id'];
      const found = attrs.filter((a) => node.getAttribute(a)).map((a) => `${a}='${node.getAttribute(a)}'`);
      const clickable = ['BUTTON', 'INPUT', 'A', 'SVG'].includes(node.tagName)
        || node.getAttribute('role') || node.onclick || (node.className || '').toString().includes('btn');
      if (!found.length && !clickable) continue;
      const box = node.getBoundingClientRect();
      out.push({
        tag: node.tagName.toLowerCase(),
        attrs: found.join(' '),
        cls: String(node.className || '').slice(0, 60),
        text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        visible: box.width > 0 && box.height > 0
      });
    }
    return out.slice(0, 40);
  }).catch(() => []);

  for (const el of inside) {
    console.log(`  ${el.visible ? 'visible' : 'hidden '} <${el.tag}> ${el.attrs}` +
      `${el.cls ? `  class="${el.cls}"` : ''}${el.text ? `  "${el.text}"` : ''}`);
  }
  if (!inside.length) console.log('  Nothing with an identifying attribute. The row markup below is the only lead.');

  console.log('\n=== The task row markup (first 2500 chars) ===');
  const html = await row.evaluate((el) => el.outerHTML.replace(/\s+/g, ' ')).catch(() => '');
  console.log(html.slice(0, 2500) || '  (could not read the row HTML)');
  console.log('\nPaste the two sections above back and the completeControl selector can be corrected');
  console.log('from real markup instead of guessed at a third time.');
}

console.log('\nNothing was clicked. Put any corrections into the "tasks" block of config/rei-selectors.json.');
await context.close();
