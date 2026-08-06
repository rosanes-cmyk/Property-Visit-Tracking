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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

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
  /*
   * Built from the components, NOT via new Date().
   *
   * "August 01, 2026 1:30 PM" was coming out as 2026-07-31 — a day early. new Date("August 01 2026") builds
   * midnight in the MACHINE's timezone, and Intl then re-rendered it in Pacific; on any machine east of
   * Pacific that lands on the previous day. It happened to look right on a Pacific machine, which is the worst
   * version of this bug: correct where it was tried and silently wrong anywhere else, including a scheduled
   * task on a box somebody set to UTC.
   *
   * And the date is not cosmetic here. pickTaskForVisit matches a task to a visit on phone AND date, so a
   * one-day shift means no task ever matches, which the run reports as "REI has no open task for this visit" —
   * a confident wrong answer about whether somebody's visit happened.
   *
   * A written date carries no timezone. "August 01, 2026" is the 1st wherever it is read, so nothing is
   * converted: the numbers are simply reassembled.
   */
  let date = '';
  if (dateMatch) {
    const named = dateMatch[0].match(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i);
    const slashed = dateMatch[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (named) {
      const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
      if (month) date = `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`;
    } else if (slashed) {
      date = `${slashed[3]}-${slashed[1].padStart(2, '0')}-${slashed[2].padStart(2, '0')}`;
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

  /*
   * "MY TASKS  ALL TASKS" — the panel opens filtered to the logged-in user.
   *
   * The doctor on Jahan Woodfork printed that toggle, alongside "These are your current assigned tasks."
   * Every booked appointment listed belonged to somebody else's lead — Amelia Middel, Maria Ramos, Karyn
   * Kambur — because the default view is whoever is logged in, not this contact.
   *
   * So a visit assigned to another member of the team is invisible until All Tasks is selected, and the
   * automation would conclude "REI has no open task for this visit" purely because Juan is not the assignee.
   * That is the wrong answer for the right-looking reason, which is the failure mode this whole feature keeps
   * producing.
   *
   * Clicking it is safe on the same grounds as everything else here: the text must be exactly "All Tasks",
   * anchored, and a filter reveals rows rather than changing anything.
   */
  const allTasks = page.getByText(/^\s*all\s+tasks\s*$/i).last();
  if (await allTasks.count().catch(() => 0)) {
    await allTasks.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

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

  /*
   * If no configured selector matched, find the rows by their own text.
   *
   * All five taskRows selectors reported "no match" on Jahan's page while the doctor printed five booked
   * appointments in plain sight. REI's rows are not list-items and not <li> — they are whatever this build of
   * the app renders — and guessing a sixth CSS selector is how the last three attempts went.
   *
   * The text is the stable thing: "Booked appointment | (650) 704-3064 | August 01, 2026 1:30 PM". That is
   * everything parseTaskTitle needs, and it does not depend on the markup at all.
   *
   * completable: false is deliberate. A text match gives no element that can be scoped for a click, so a task
   * found this way may be READ but never ticked off — completeTask refuses it outright rather than clicking
   * something it cannot prove is inside the right row.
   */
  if (!out.length) {
    /*
     * Read the page's own visible TEXT, line by line.
     *
     * getByText(BOOKED) was tried here first and also found nothing, which is the third mechanism to come back
     * empty on a page the doctor was simultaneously printing five appointments from. Whatever REI's markup does
     * — nesting, shadow roots, text split across spans — it defeats element matching.
     *
     * body.innerText does not care. It is exactly how the doctor found those five lines, so it is known to work
     * on this page rather than hoped to. One line per task, and parseTaskTitle already takes a line:
     *
     *   "Booked appointment | (650) 704-3064 | August 01, 2026 1:30 PM Amelia Middel JR"
     *
     * The trade is that there is no element handle, so these tasks are readable and never completable — which
     * completeTask enforces.
     */
    const body = ((await page.locator('body').innerText().catch(() => '')) || '');
    const seen = new Set();
    let index = 0;
    for (const raw of body.split('\n')) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text || !BOOKED.test(text) || seen.has(text)) continue;
      seen.add(text);
      const parsed = parseTaskTitle(text, { timezone });
      if (!parsed) continue;
      out.push({
        index: index++,
        selector: null,
        completable: false,
        ...parsed,
        complete: /\bcompleted?\b/i.test(text)
      });
    }
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
  /*
   * A task read by TEXT cannot be completed, and this refusal is not a limitation to work around.
   *
   * The text fallback in readTasks gives no element to scope a click to, and the whole safety argument for
   * this function is that the tick it clicks is provably INSIDE the matched row. Without that, a page-level
   * control belonging to a different task could be the one that gets clicked — on somebody's live CRM.
   */
  if (!task?.selector || task.completable === false) {
    return {
      clicked: null,
      confirmed: false,
      rowText: 'refused: this task was found by its text, so no row can be scoped for a click. '
        + 'Add a working taskRows selector to config/rei-selectors.json first.'
    };
  }
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
