/**
 * The one write this project makes to REI BlackBook: marking a booked-appointment task complete,
 * after the visit has been confirmed on Juan's calendar and in a WhatsApp group.
 *
 * Everything else about REI stays read-only. The rule in CLAUDE.md is narrowed, not dropped:
 * complete a task, nothing more. No editing a contact, no changing a stage, no deleting anything,
 * no messaging a seller.
 *
 * SELECTORS HERE ARE UNCONFIRMED. REI's markup is scrambled (css-0 class names) and this was written
 * without a live session to check against. Run `npm run rei:task-doctor -- "<contact url>"` first: it
 * reports which selectors resolve and what the task rows actually look like, changing nothing.
 */
import { assertCompletionSelector, samePhone } from './task-gate.mjs';

const BOOKED = /booked\s*appointment/i;

/** Pull "Booked appointment | (650) 771-7814 | August 05, 2026 2:00 PM" apart. */
export function parseTaskTitle(title, { timezone = 'America/Los_Angeles' } = {}) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!BOOKED.test(text)) return null;

  const phone = (text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [])[0] || '';

  // Strip a trailing "Due: ..." REI sometimes glues on, then look for the date.
  const withoutDue = text.replace(/\bDue:.*$/i, '').trim();
  const dateMatch = withoutDue.match(
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})|(\d{1,2}\/\d{1,2}\/\d{4})/i
  );
  let date = '';
  if (dateMatch) {
    const parsed = new Date(dateMatch[0].replace(',', ''));
    if (!Number.isNaN(parsed.getTime())) {
      date = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(parsed);
    }
  }
  return { title: text, phone, date };
}

/**
 * Read the tasks visible on a contact page. Read-only.
 * Returns [{ index, title, phone, date, complete }].
 */
export async function readTasks(page, selectors, { timezone } = {}) {
  const rowSelectors = (selectors?.tasks?.taskRows || []).map(assertCompletionSelector);
  const out = [];

  for (const selector of rowSelectors) {
    const rows = page.locator(selector);
    const count = await rows.count().catch(() => 0);
    if (!count) continue;

    for (let index = 0; index < count; index += 1) {
      const text = ((await rows.nth(index).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const parsed = parseTaskTitle(text, { timezone });
      if (!parsed) continue;
      out.push({
        index,
        selector,
        ...parsed,
        // REI marks a finished task with a strikethrough or a "Completed" label; both are checked.
        complete: /\bcompleted?\b/i.test(text)
      });
    }
    if (out.length) break;
  }
  return out;
}

/** The task for this visit, or null. Phone AND date must agree — see task-gate.mjs. */
export function pickTaskForVisit(tasks, visit) {
  return tasks.find((t) => samePhone(t.phone, visit.phone) && t.date && t.date === visit.date) || null;
}

/**
 * Mark one task complete. Only ever called after the gate has approved.
 *
 * Scoped to the matched row: the control is looked for INSIDE that row, so a page-level "Complete"
 * button belonging to a different task can never be the one that gets clicked.
 */
export async function completeTask(page, selectors, task) {
  const candidates = (selectors?.tasks?.completeControl || []).map(assertCompletionSelector);
  const row = page.locator(task.selector).nth(task.index);

  /*
   * HOVER FIRST. REI reveals the tick on hover — the button is in the DOM but hidden until the pointer is
   * over the row. Six candidate selectors were checked with isVisible() and every one of them was
   * correctly reported as not visible, so the run concluded there was no completion control at all. The
   * control was there the whole time; nothing had put the mouse on the row.
   */
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.hover().catch(() => {});
  await page.waitForTimeout(600);

  for (const candidate of candidates) {
    const control = row.locator(candidate).first();
    // count(), not isVisible(): presence is what tells us the selector is right. Whether it has finished
    // fading in is a timing question, and one the hover above has already answered.
    if (!(await control.count().catch(() => 0))) continue;

    // Hover the control itself so its own reveal transition completes, then click it for real. A forced
    // click is the fallback for the case where the fade has not finished.
    await control.hover().catch(() => {});
    await page.waitForTimeout(300);
    await control.click({ timeout: 5000 }).catch(async () => {
      await control.click({ force: true, timeout: 5000 }).catch(() => {});
    });
    await page.waitForTimeout(2000);

    /*
     * Confirming is harder than it looks: REI may move a completed task out of "Upcoming Tasks"
     * altogether, in which case the row text is gone rather than changed. Treat a row that has
     * DISAPPEARED as success too — but only after having clicked, never as a default.
     */
    const stillThere = await row.count().catch(() => 0);
    const after = stillThere
      ? ((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
      : '';
    const completed = !stillThere || /\bcompleted?\b/i.test(after) || !/booked appointment/i.test(after);

    return {
      clicked: candidate,
      confirmed: completed,
      rowText: stillThere ? after.slice(0, 160) : 'the task row is no longer in Upcoming Tasks'
    };
  }
  return { clicked: '', confirmed: false, rowText: 'no completion control found inside the task row' };
}
