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

/*
 * Only these panel names may ever be clicked.
 *
 * An allowlist, not a denylist. Opening a panel means clicking something on a page this project treats as
 * read-only, so the set is fixed here in code and a label from the config that is not on it is ignored.
 * CLAUDE.md permits exactly this — "open only safe navigation tabs such as Notes, Tasks/Appointments,
 * Property, and Activity/Timeline" — and nothing else is reachable through this function.
 */
const OPENABLE = /^(tasks?|appointments?|notes?|activity|timeline|history|property|properties)$/i;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Open a panel on the contact page by its visible name, so its contents render. Read-only otherwise.
 *
 * Returns { opened, how } — `how` is reported by the caller, because "we looked and found nothing" and
 * "we never managed to look" need to be told apart downstream.
 *
 * Why this exists: nothing opened the Tasks panel. `tabs` has sat in rei-selectors.json unused since the
 * config was written, so readTasks only ever saw whatever renders on the default contact view. That is how
 * two real leads reported "0 booked-appointment tasks" while a third reported four — and all four of that
 * third one's "tasks" were NOTES whose text happened to contain the phrase. No real REI task row had ever
 * actually been read, and an empty result was being reported as "REI holds no appointment".
 */
export async function openPanel(page, labels = [], { timeout = 4000 } = {}) {
  for (const label of labels) {
    const name = String(label).trim();
    if (!OPENABLE.test(name)) continue;
    const exact = new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i');
    /*
     * FOUR roles, not two — and a text fallback after them.
     *
     * This reported "no Tasks / Appointments tab or accordion could be found on the page" for every lead, for
     * weeks, and I read that as REI calling the tab something else. It does not: the client's screenshot of
     * David Jackowitz shows the strip as About · Chat · Activities · Notes · Tasks · Files · Workflows ·
     * Properties. The label was right all along and I asked for it four times.
     *
     * What was wrong is the ROLE. getByRole('tab') needs role="tab", and getByRole('button') needs a <button>
     * or role="button". A tab strip built from anchors has role "link", and one built from plain <div>s has no
     * role at all — and REI's class names are scrambled (css-0), so there is no class to fall back on either.
     * Either shape is invisible to the two roles this tried.
     */
    for (const role of ['tab', 'button', 'link', 'menuitem']) {
      const target = page.getByRole(role, { name: exact }).first();
      if (!(await target.count().catch(() => 0))) continue;
      if ((await target.getAttribute('aria-expanded').catch(() => null)) === 'true') {
        return { opened: true, how: `${role} "${name}" was already open` };
      }
      await target.click({ timeout }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return { opened: true, how: `clicked ${role} "${name}"` };
    }

    /*
     * Last resort: an element whose ENTIRE text is the label, whatever it is made of.
     *
     * Still safe, and for the same reason expand.mjs is: `name` has already passed the OPENABLE allowlist —
     * tasks, appointments, notes, activity, timeline, property — so this cannot reach Delete or Send however
     * the page is built. The text is anchored at both ends, so "Tasks (3)" or "Task settings" will not match.
     *
     * .last() rather than .first() because nesting puts the outer wrapper first in DOM order; the deepest
     * element whose whole text is "Tasks" is the one a person would actually click.
     */
    const byText = page.locator('a, button, li, span, div, p, h1, h2, h3, h4, [role]').filter({ hasText: exact }).last();
    if (await byText.count().catch(() => 0)) {
      await byText.click({ timeout }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return { opened: true, how: `clicked an element whose text is exactly "${name}"` };
    }
  }
  return { opened: false, how: `no ${labels.join(' / ')} tab, link or accordion could be found on the page` };
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
