import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import { assertAuthenticated } from './browser.mjs';
// readTasks is READ-ONLY — it lists task rows and clicks nothing. completeTask, the one REI write this
// project can make, is deliberately not imported here.
import { readTasks, openPanel } from './tasks.mjs';
import { readNotesTab } from './notes-tab.mjs';
import { expandTruncatedText } from './expand.mjs';
import { taskMatchesVisit } from './task-gate.mjs';
import { cancellationEvidence, deadLeadTags } from './cancel-signal.mjs';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

async function loadSelectorConfig() {
  const raw = await fs.readFile(config.reiSelectorConfig, 'utf8');
  return JSON.parse(raw);
}

/**
 * The REI contact id, used as the identity key for both row and calendar-event matching.
 *
 * Only a real REI contact URL yields an id. The previous version took the last path-ish segment of
 * ANY url, so every SendGrid tracking link ("/ls/click") collapsed to the id "click" — meaning
 * unrelated contacts shared one identity and overwrote each other's calendar event (which is how a
 * calendar entry ended up showing a different property's address). Anything else now hashes to a
 * value unique to that url, so distinct records can never collide.
 */
function extractRecordId(url) {
  const text = String(url || '');
  const contactMatch = text.match(/reiblackbook\.com\/contacts\/(\d+)/i);
  if (contactMatch) return contactMatch[1];
  try {
    const parsed = new URL(text);
    const queryId =
      parsed.searchParams.get('contactId') ||
      parsed.searchParams.get('taskId') ||
      parsed.searchParams.get('id');
    if (queryId && /^\d+$/.test(queryId)) return queryId;
  } catch {
    // Not a parseable url — fall through to the hash.
  }
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function firstRegex(text, regex) {
  const match = String(text || '').match(regex);
  return normalize(match?.[0] || '');
}

// Parse a date/time string (Pacific). Accepts year-full and year-less month/slash formats.
function parseDateTimeString(text) {
  const t = normalize(text)
    .replace(/\b(?:PST|PDT|Pacific Time|PT)\b/gi, '')
    .replace(/\bUNITED STATES\b/gi, '')
    .trim();
  if (!t) return '';
  const formats = [
    'MMMM d, yyyy h:mm a', 'MMM d, yyyy h:mm a',
    'M/d/yyyy h:mm a', 'MM/dd/yyyy h:mm a', 'M/d/yy h:mm a',
    'M/d/yyyy, h:mm a', 'MM/dd/yyyy, h:mm a',
    "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", 'yyyy-MM-dd h:mm a',
    // Year-less variants ("Jul 28 10:00 AM"); Luxon fills in the current year.
    'MMMM d h:mm a', 'MMM d h:mm a', 'M/d h:mm a'
  ];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(t, format, { zone: config.calendarTimezone, locale: 'en-US' });
    if (parsed.isValid) return parsed.toISO();
  }
  const iso = DateTime.fromISO(t, { zone: config.calendarTimezone });
  return iso.isValid ? iso.toISO() : '';
}

/**
 * REI BlackBook renders each field as a leaf `[data-testid="list-item"]` whose text is the label
 * glued directly to its value, e.g. "Property Address26845 Willow Terrace, ...". Collect those leaf
 * strings once; values are then pulled by matching the label as a prefix.
 */
async function extractListItemPairs(page) {
  return page.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const leaves = [...document.querySelectorAll('[data-testid="list-item"]')]
      .filter((el) => !el.querySelector('[data-testid="list-item"]'));
    return leaves.map((el) => norm(el.textContent)).filter(Boolean);
  });
}

/**
 * The value for a label, whether REI glues it to the label or puts it in the next element.
 *
 * The glued form is the one this was written for — "Property Address3125 Alexis Pl, Castro Valley, CA" in a
 * single leaf — and it works on most contacts. Bryan Dodge's did not: his address was plainly on screen in
 * the client's screenshot while the scrape reported "REI has no Property Address on that contact", every two
 * minutes for a day. I guessed twice at why (a missing field in REI, then the ?activeTab=chat in the link)
 * and was wrong both times.
 *
 * What is left, and what this handles, is the OTHER rendering: label and value as two separate leaves, which
 * is what a longer value wrapping onto two lines produces. In that shape `startsWith` matches the label leaf,
 * `slice` returns nothing, and the loop moves on having seen the answer and discarded it.
 *
 * The lookahead is deliberately narrow, because a wrong value here is far worse than none — it would send
 * somebody to the wrong house. It fires ONLY when the leaf is exactly the label with nothing after it, and it
 * refuses a next leaf that looks like another field's label (a capitalised phrase with no digits and no
 * comma), so "Mailing Address" followed by "Amount Offer" cannot be read as an address.
 */
function valueForLabel(pairs, labels = []) {
  const looksLikeALabel = (t) => /^[A-Z][A-Za-z ()\/]{2,28}$/.test(t) && !/\d/.test(t) && !t.includes(',');
  for (const label of labels) {
    const lower = String(label).toLowerCase();
    for (let i = 0; i < pairs.length; i++) {
      const text = pairs[i];
      if (!text.toLowerCase().startsWith(lower)) continue;
      const glued = normalize(text.slice(label.length));
      if (glued && glued !== '-') return glued;
      /* Label alone: the value is the next leaf, if that leaf is a value rather than the next label. */
      if (normalize(text).toLowerCase() === lower) {
        const next = normalize(pairs[i + 1] || '');
        if (next && next !== '-' && !looksLikeALabel(next)) return next;
      }
    }
  }
  return '';
}

// Long-form leaf items (the Notes accordion holds call summaries etc.) — anything that is not a
// short "LabelValue" pair.
function longTextItems(pairs, minLength = 60, limit = 20) {
  return [...new Set(pairs.filter((text) => text.length >= minLength))].slice(0, limit);
}

/**
 * Find a contact's page URL by searching REI for a phone number, then reading the first
 * /contacts/<numeric-id> result link. Used when the email has no usable direct link (REI
 * truncates task titles), so the phone number in the title becomes the lookup key.
 */
async function findContactUrlByPhone(page, phone) {
  const digits = String(phone).replace(/\D/g, '');
  const attempts = [...new Set([String(phone).trim(), digits].filter(Boolean))];
  await page.goto('https://my.reiblackbook.com/contacts', { waitUntil: 'domcontentloaded', timeout: config.reiPageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: config.reiPageTimeoutMs }).catch(() => {});
  const searchSel = 'input[type="search"], input[placeholder*="Search By Name" i], input[placeholder*="Search" i]';
  /*
   * Say WHY the search box never appeared, instead of pasting Playwright's call log at the team.
   *
   * What reached Google Chat when this failed on a real booking:
   *
   *   A booking could not be logged: page.waitForSelector: Timeout 20000ms exceeded.
   *   Call log: - waiting for locator('input[type="search"], input[placeholder*="Search by Name" i], ...
   *
   * Nobody reading that can act on it. The overwhelmingly likely cause is that REI has signed this profile
   * out — the contacts page then renders a login form, which has no search box, and the wait times out on a
   * page that is working exactly as designed. The URL says so, and the URL was never looked at. That is the
   * same mistake whatsapp-doctor made: concluding from the absence of one element while ignoring the address
   * bar, which was saying plainly what had happened.
   *
   * The 20 seconds was its own small bug: everything else on this page is given config.reiPageTimeoutMs
   * (45s by default), so a slow-but-fine REI could fail here alone and be reported as an error.
   */
  try {
    await page.waitForSelector(searchSel, { timeout: config.reiPageTimeoutMs });
  } catch (error) {
    const url = page.url();
    if (/log[-_]?in|sign[-_]?in|\/auth|session|password/i.test(url)) {
      throw new Error(`REI is showing a login page (${url}), so there was no contact list to search. `
        + 'Run scripts\\login-rei.cmd on this PC, sign in, and the booking will be picked up on the next run.');
    }
    throw new Error(`REI's contacts page never showed its search box (waited `
      + `${Math.round(config.reiPageTimeoutMs / 1000)}s, still at ${url}). `
      + 'Usually this is a signed-out session — run scripts\\login-rei.cmd and check. '
      + 'If you are signed in and it still fails, REI has changed that page and the selector needs updating.');
  }
  const box = page.locator(searchSel).first();
  for (const term of attempts) {
    await box.click().catch(() => {});
    await box.fill('').catch(() => {});
    await box.type(term, { delay: 30 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(3500);
    const href = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a[href*="/contacts/"]')]
        .find((a) => /\/contacts\/\d+/.test(a.getAttribute('href') || ''));
      return link ? link.getAttribute('href') : '';
    });
    if (href) return new URL(href, 'https://my.reiblackbook.com').href;
  }
  return '';
}

async function captureDebug(page, prefix, extra = {}) {
  if (!config.debugCapture) return;
  await fs.mkdir(path.resolve('./debug'), { recursive: true });
  const stamp = DateTime.now().toFormat('yyyyLLdd-HHmmss');
  const base = path.resolve('./debug', `${stamp}-${prefix}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${base}.html`, await page.content().catch(() => ''), 'utf8').catch(() => {});
  await fs.writeFile(`${base}.json`, JSON.stringify({ url: page.url(), ...extra }, null, 2), 'utf8').catch(() => {});
}

/**
 * The plain contact page, with any tab or query string stripped off.
 *
 * A pasted REI link often carries the tab the person happened to be on:
 *
 *   https://my.reiblackbook.com/contacts/16379118?activeTab=chat
 *
 * Opened as-is, REI renders the CHAT tab, and the About panel — the one holding Property Address, Lead
 * Stage, Amount Offer and the appointment fields — is not on the page at all. The scrape then honestly
 * reports "REI has no Property Address on that contact" about a contact whose address is right there under
 * the About tab. Bryan Dodge's read `3125 Alexis Pl, Castro Valley, CA, 94546` the whole time, and the row
 * stayed parked for twenty-five hours.
 *
 * It was invisible because every other lead worked: those links have no activeTab, so they open on About and
 * scrape correctly. One pasted link with one query parameter is the whole difference.
 *
 * Only ever narrows to `/contacts/<id>`, and returns the input untouched when it does not match that shape —
 * a link this does not recognise must be followed as given rather than rewritten into something else.
 */
export function contactPageUrl(link) {
  const m = /(https?:\/\/[^/]*reiblackbook\.com\/contacts\/\d+)/i.exec(String(link || ''));
  return m ? m[1] : String(link || '');
}

export async function scrapeReiVisit(context, reiLink, emailFallback = {}) {
  const selectorConfig = await loadSelectorConfig();
  const L = selectorConfig.listItemLabels || {};
  const page = await context.newPage();
  try {
    // Decide which contact page to open: a direct REI contact URL if we have one, otherwise
    // locate it by searching REI for the phone number carried in the task title.
    /*
     * contactPageUrl, so a link carrying ?activeTab=chat opens the About panel rather than the chat log.
     * See the note on that function — this one parameter parked two real bookings for twenty-five hours.
     */
    let targetUrl = /reiblackbook\.com\/contacts\/\d+/i.test(String(reiLink || '')) ? contactPageUrl(reiLink) : '';
    if (!targetUrl && emailFallback.phone) {
      targetUrl = await findContactUrlByPhone(page, emailFallback.phone);
    }
    if (!targetUrl) {
      throw new Error('Could not locate the REI contact (no direct contact link and no phone match).');
    }

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.reiPageTimeoutMs });
    // REI is a single-page app; wait for the network to settle and the field list to render.
    await page.waitForLoadState('networkidle', { timeout: config.reiPageTimeoutMs }).catch(() => {});
    await page.waitForSelector('[data-testid="list-item"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await assertAuthenticated(page, selectorConfig.login || {});

    /* Stored without the tab too, so the next run and anybody clicking it from the board get the About panel. */
    const effectiveLink = /reiblackbook\.com\/contacts\/\d+/i.test(page.url())
      ? contactPageUrl(page.url()) : targetUrl;

    /*
     * Reveal the rest of any clamped note BEFORE reading the page.
     *
     * Rob Walker's gift arrived with its basket name and order number and without its price, order date or
     * delivery date — all three further down the same note, behind REI's "Show More". The parser was reading
     * exactly what it was given. Anything this project learns from a note is capped by how much of it is on
     * screen, so this runs on every scrape rather than only for gifts.
     */
    const expanded = await expandTruncatedText(page);
    if (expanded.clicked) {
      console.log(`   Expanded ${expanded.clicked} truncated note(s)${expanded.capped ? ' (hit the cap)' : ''}`);
    }

    const visibleText = normalize(await page.locator('body').innerText().catch(() => ''));
    const pairs = await extractListItemPairs(page);

    const sellerName = valueForLabel(pairs, L.sellerName || ['Name']);
    const phone = valueForLabel(pairs, L.phone || ['Phone (Mobile)', 'Phone (Home)', 'Phone']);
    const email = valueForLabel(pairs, L.email || ['Email']);
    const propertyAddress = valueForLabel(pairs, L.propertyAddress || ['Property Address']);
    const apptTime = valueForLabel(pairs, L.appointmentTime || ['Appointment Time']);
    const apptDateRaw = valueForLabel(pairs, L.appointmentDate || ['Appointment Date']);
    const assignedOwner = valueForLabel(pairs, L.assignedOwner || ['Appointment Assigned To', 'Sales Agent']);
    const leadSource = valueForLabel(pairs, L.leadSource || ['Source']);
    const contactStage = valueForLabel(pairs, L.contactStage || ['Lead Stage', 'Category']);
    /*
     * REI's TAGS, read from the same label/value pairs as everything else.
     *
     * The client: "there is a tag propery evaluated if the lead has been visit and note." A page dump
     * confirmed it — the contact carries a `Tag(s)` label whose value reads, on one real lead:
     *
     *     Follow up · Property Evaluated · THB Inquiry Call · Twin Home Buyer Web Inquiries
     *
     * Kept as ONE STRING rather than split into a list, on purpose. The page flattens the tags together
     * with no separator, so splitting would have to guess where "Follow up" ends and "Property Evaluated"
     * begins — and guessing wrong on a field that decides whether a visit counts as done is exactly the
     * kind of confident error this project keeps having to undo. Asking "does this contain the tag I care
     * about" needs no split and cannot be wrong in that way.
     *
     * Note what that same lead proves: `Follow up` and `Property Evaluated` are present AT ONCE. Tags are
     * added and never tidied, so a tag alone can never be enough to move a status — it is one half of a
     * pair, the other being a note dated after the visit.
     */
    const reiTags = valueForLabel(pairs, L.reiTags || ['Tag(s)', 'Tags']);
    const nextAction = valueForLabel(pairs, L.nextAction || ['Next Step']);
    const callDisposition = valueForLabel(pairs, L.callDisposition || ['Call Disposition']);
    /*
     * Follow-Up Reason, from the team's own CRM cheat sheet: "ONLY for Stage 2 — Follow Up. WHY is the lead
     * still active?" — PRICE, TIMING, DECISION, CONDITION, COMMUNICATION.
     *
     * It is one of the four fields that sheet says every lead must have, and the one that carries its most
     * important distinction: SOFT NO (keep in follow up) against HARD NO (move to lost). Nothing here read it.
     *
     * The label wordings are candidates. A label that matches nothing yields '', and '' never overwrites
     * anything, so guessing wrong here costs nothing — unlike guessing a VALUE, which is how a lead ends up in
     * the wrong section of the work queue.
     */
    const followUpReason = valueForLabel(pairs, L.followUpReason || ['Follow-Up Reason', 'Follow Up Reason']);
    const amountOffer = valueForLabel(pairs, L.amountOffer || ['Amount Offer']);

    /*
     * Appointment resolution — never guess, and never trust the clock inside "Appointment Date".
     * REI stores a CREATION timestamp there (observed: "Jul 27, 2026, 8:35 AM" for a visit that was
     * actually at 11:00 AM), so only its DATE part is usable. The real time lives in the separate
     * "Appointment Time" field. Priority:
     *   1. REI date + REI time            (both on the page — most authoritative)
     *   2. Title date + time              (typed deliberately for this booking)
     *   3. REI date + time from the title (page date, human-supplied time)
     * If none yields a full date AND time, leave it empty so the row is flagged for review.
     */
    const DATE_RE = /[A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/;
    const apptDateOnly = (apptDateRaw.match(DATE_RE) || [])[0] || '';

    // Many contacts have the Appointment Date/Time fields blank and carry the date only on the task
    // itself ("Due Date: Jul 29, 2026" in Upcoming Tasks). Use that as a date source of last resort.
    const dueDateItem = pairs.find((t) => /due date/i.test(t));
    const dueDateOnly = dueDateItem
      ? ((dueDateItem.split(/due date:?/i)[1] || '').match(DATE_RE) || [])[0] || ''
      : '';
    const titleIso = normalize(emailFallback.appointmentStartIso || '');
    const titleDt = titleIso ? DateTime.fromISO(titleIso, { zone: config.calendarTimezone }) : null;
    const titleTime = titleDt?.isValid ? titleDt.toFormat('h:mm a') : '';

    let appointmentStartIso = '';
    let appointmentSource = '';
    if (apptDateOnly && apptTime) {
      appointmentStartIso = parseDateTimeString(`${apptDateOnly} ${apptTime}`);
      appointmentSource = 'REI appointment fields';
    }
    if (!appointmentStartIso && titleDt?.isValid) {
      appointmentStartIso = titleDt.toISO();
      appointmentSource = 'task title';
    }
    if (!appointmentStartIso && apptDateOnly && titleTime) {
      appointmentStartIso = parseDateTimeString(`${apptDateOnly} ${titleTime}`);
      appointmentSource = 'REI date + title time';
    }
    // 4. REI "Appointment Time" with the task's Due Date as the date.
    if (!appointmentStartIso && dueDateOnly && apptTime) {
      appointmentStartIso = parseDateTimeString(`${dueDateOnly} ${apptTime}`);
      appointmentSource = 'task due date + REI appointment time';
    }
    // 5. Task Due Date with the time from the title.
    if (!appointmentStartIso && dueDateOnly && titleTime) {
      appointmentStartIso = parseDateTimeString(`${dueDateOnly} ${titleTime}`);
      appointmentSource = 'task due date + title time';
    }

    /*
     * The Notes TAB, then the contact page as a fallback.
     *
     * longTextItems reads what is on the contact page, and what is on the contact page is the right-hand
     * "Notes (29)" SIDEBAR — a preview of each note, cut off with "Show More". That is why Rob Walker's note
     * arrived with "...Show More" welded to its end, and why Marichu's newest note (an email received 8:50 AM
     * on Aug 7 asking whether we handle the deed transfer) and Jose's Aug 6 call summary were never seen at
     * all: both are on the tab, and nothing opened it. The client, from the screenshot: "it should be checked
     * in the notes tab, as you there already, and the codes didn't check."
     *
     * The page fallback stays. A contact whose Notes tab will not open must not silently lose the preview
     * text this has been reading all along.
     */
    const notesTab = await readNotesTab(page, { openPanel, expandTruncatedText });
    /*
     * Reported whether it worked or not.
     *
     * This logged only on success, and the first live run of it returned nothing for all three contacts and
     * said so nowhere — the output was indistinguishable from a run where the tab did not exist. "We looked
     * and found nothing" and "we never managed to look" are different faults with different fixes, and a
     * reader of the log has to be able to tell them apart.
     */
    console.log(notesTab.notes.length
      ? `   Read ${notesTab.notes.length} note(s) from the Notes tab (${notesTab.how})`
      : `   Notes tab gave nothing — ${notesTab.how}. Falling back to the contact page.`
        + ' Diagnose with: node scripts/notes-doctor.mjs "' + effectiveLink + '"');
    const notes = notesTab.notes.length ? notesTab.notes.map((n) => n.body) : longTextItems(pairs);

    // Cancellation is signalled by the notification (subject/title) or a "Canceled Appointment"
    // tag on the contact. We do NOT infer it from lead stage alone.
    /*
     * The phrase rules moved to cancel-signal.mjs, and widened, because of one lead and one word.
     *
     * Jose Anguiano's contact carried the note "Equity Percentage: 22% |cancelled booked appointment".
     * The old test required "cancelled appointment" to be ADJACENT, "booked" sat between them, and a
     * cancellation written in plain English on the page stayed invisible for five days while the tracker
     * showed the visit as still coming up. Now up to two words may intervene, hypotheticals are excluded,
     * and the matched sentence is carried out so a run can print the evidence it acted on.
     */
    const cancelText = `${emailFallback.rawTitle || ''} ${visibleText}`;
    const cancelEvidence = cancellationEvidence(cancelText);
    const cancelled = cancelEvidence.cancelled;
    const deadTags = deadLeadTags(cancelText);

    const phoneFallback = firstRegex(visibleText, /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    const emailPageFallback = firstRegex(visibleText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    /*
     * Did REI record this visit as DONE?
     *
     * Without this, taskStatus could only ever be 'Cancelled' or blank, so the re-check had no way to
     * learn that a visit had happened. That is the client's actual complaint: "Jose Anguiano · OVERDUE
     * — visit was 2026-08-01 and is still marked Scheduled". Somebody could tick the appointment task
     * complete in REI and a re-check would still report "REI agrees with the sheet", because the only
     * question it knew how to ask was whether the visit had been cancelled.
     *
     * Two guards, because writing 'Completed' onto the wrong lead would move it out of Upcoming Visit
     * and tell the team a visit happened that did not:
     *
     *   1. readTasks is scoped to the configured task ROWS and parseTaskTitle only parses rows titled
     *      "Booked appointment". A page-wide /completed/ regex would fire on any completed task on the
     *      contact — a call, an email, a mailer.
     *   2. taskMatchesVisit requires the task's phone AND date to match this appointment. A seller with
     *      two properties has two tasks, and the completed one may be the other property's.
     *
     * A cancellation still wins: an appointment cannot be both called off and carried out, and the
     * cancelled signal comes from the notification itself, which is the more direct evidence.
     */
    let visitTaskState = 'not-checked';
    let visitTaskReason = 'the appointment was already cancelled, so the task was not consulted';
    let taskPanel = { opened: false, how: 'not attempted' };
    if (!cancelled) {
      try {
        const apptDay = appointmentStartIso
          ? DateTime.fromISO(appointmentStartIso, { zone: config.calendarTimezone }).toFormat('yyyy-MM-dd')
          : '';
        const thisVisit = { phone: normalize(phone || phoneFallback || emailFallback.phone || ''), date: apptDay };
        /*
         * Open the Tasks panel FIRST, or there is nothing to read.
         *
         * Without this, readTasks saw only the default contact view. Two real leads therefore reported
         * "0 booked-appointment tasks" and were described as having no appointment in REI at all — a
         * conclusion drawn from a panel that had never been opened.
         */
        taskPanel = await openPanel(page, selectorConfig.tabs?.tasks || ['Tasks', 'Appointments']);
        const tasks = await readTasks(page, selectorConfig, { timezone: config.calendarTimezone });
        const mine = tasks.find((t) => taskMatchesVisit(t, thisVisit));
        if (mine && mine.complete) {
          visitTaskState = 'complete';
          visitTaskReason = 'REI shows the booked-appointment task ticked off';
        } else if (mine) {
          visitTaskState = 'open';
          visitTaskReason = 'REI shows the booked-appointment task still open';
        } else if (!tasks.length) {
          /*
           * 'none' means we LOOKED and there is nothing. 'unknown' means we never managed to look.
           *
           * Both used to be 'unknown', which was safe but cost real information: appointmentGoneFromRei needs
           * to know that the task list was genuinely read and genuinely empty before it will believe REI has
           * let go of an appointment. Reading "we could not look" as "there is nothing there" is exactly the
           * confident wrong answer that rule is guarded against.
           */
          visitTaskState = taskPanel.opened ? 'none' : 'unknown';
          // These two are NOT the same finding, and conflating them is what produced a confident,
          // wrong "REI holds no appointment for this contact any more".
          visitTaskReason = taskPanel.opened
            ? `the Tasks panel was opened (${taskPanel.how}) and holds no booked-appointment task`
            : `REI's tasks were never read — ${taskPanel.how}`;
        } else {
          visitTaskState = 'unknown';
          /*
           * "on the contact" was wrong, and misleadingly so.
           *
           * The doctor on Jahan Woodfork showed what the Tasks panel really is: "MY TASKS  ALL TASKS", "These
           * are your current assigned tasks", and five booked appointments belonging to OTHER leads — Amelia
           * Middel, Maria Ramos, Karyn Kambur. It is the logged-in user's task list, not this contact's. So a
           * message reading "5 booked-appointment task(s) on the contact" invites somebody to open the lead
           * expecting five appointments and find none.
           *
           * The phone-AND-date match is what makes a global list usable, and it was already required.
           */
          visitTaskReason = `${tasks.length} booked-appointment task(s) in REI's task list (it lists the whole `
            + "team's tasks, not just this contact's), none matching this "
            + `visit on phone AND date${apptDay ? ` (${apptDay})` : ' (no appointment date to match on)'}`;
        }
      } catch (error) {
        visitTaskState = 'unknown';
        visitTaskReason = `reading the task list failed: ${error.message}`;
      }
    }

    /*
     * 'unknown' is NOT 'open', and it must not be reported as though the question was answered.
     *
     * This is the same mistake the run summary already had to be corrected for once: "no change in REI"
     * read like a clean bill of health when it could equally have meant the page returned nothing. Here
     * the stakes are the same. There are two distinct reasons the matching task can be absent —
     *
     *   - REI MOVES a completed task out of the panel, so 'gone' can mean 'done'. completeTask's own
     *     confirmation logic treats a vanished row as evidence of completion.
     *   - or the panel simply did not render, or this appointment never had a task at all.
     *
     * Absent therefore cannot be treated as complete: doing so would stamp 'Completed' on every lead
     * whose task panel failed to load. It equally cannot be reported as 'still open'. So it stays
     * unknown, nothing is written, and the run SAYS the question went unanswered — which is the only
     * version a person can act on, by opening REI or running rei-task-doctor.
     */
    const taskStatus = cancelled ? 'Cancelled' : visitTaskState === 'complete' ? 'Completed' : '';

    const result = {
      reiLink: effectiveLink,
      reiRecordId: extractRecordId(effectiveLink),
      sellerName: normalize(sellerName || emailFallback.sellerName),
      phone: normalize(phone || phoneFallback),
      email: normalize(email || emailPageFallback),
      propertyAddress: normalize(propertyAddress || emailFallback.propertyAddress),
      appointmentStartIso,
      assignedOwner: normalize(assignedOwner || emailFallback.assignedOwner),
      taskTitle: normalize(emailFallback.rawTitle || ''),
      taskStatus,
      visitTaskState,
      visitTaskReason,
      // The sentence that caused a Cancelled status, so a write from free text is never silent.
      // Whether the Tasks panel was actually opened. An empty task list only means "no appointment"
      // when this is true; otherwise it means we never looked in the right place.
      taskPanelOpened: taskPanel.opened,
      taskPanelHow: taskPanel.how,
      cancelPhrase: cancelEvidence.phrase,
      deadLeadTags: deadTags,
      contactStage: normalize(contactStage),
      reiTags: normalize(reiTags),
      propertyDetails: normalize(amountOffer ? `Amount Offer: ${amountOffer}` : ''),
      // Exposed separately as well: propertyDetails is a display string, and re-parsing a sentence to
      // recover a number the scraper already had is how rounding and currency bugs get in.
      amountOffer: normalize(amountOffer),
      /*
       * Both of these were being READ and then discarded — callDisposition since the config was written.
       * "Call Disposition: what happened last?" is one of the four core fields on the client's cheat sheet, and
       * it was reaching this function and going no further.
       */
      callDisposition: normalize(callDisposition),
      followUpReason: normalize(followUpReason),
      notes: notes.join('\n\n'),
      /*
       * Where the notes came from, because the two sources are not equal quality.
       *
       * 'tab' is the Notes tab — full text. 'page' is the right-hand sidebar preview, which REI truncates by
       * design. Both are useful for spotting a cancellation, but only one should be allowed to overwrite a
       * cell that already holds the good version.
       */
      notesSource: notesTab.notes.length ? 'tab' : 'page',
      latestActivity: '',
      nextAction: normalize(nextAction),
      leadSource: normalize(leadSource),
      scrapedAt: DateTime.now().setZone(config.calendarTimezone).toISO(),
      sourceUrl: page.url(),
      appointmentSource,
      warnings: [...(emailFallback.warnings || [])]
    };

    if (!result.sellerName) result.warnings.push('Seller name was not found.');
    if (!result.propertyAddress) result.warnings.push('Property address was not found.');
    if (!result.appointmentStartIso) {
      // Say exactly which pieces were found so the gap is obvious (usually a missing TIME).
      const seen = [
        `REI Appointment Date: ${apptDateRaw || '(blank)'}`,
        `REI Appointment Time: ${apptTime || '(blank)'}`,
        `task Due Date: ${dueDateOnly || '(blank)'}`,
        `title date/time: ${titleDt?.isValid ? titleDt.toFormat('MMM d, yyyy h:mm a') : '(none)'}`
      ].join(' | ');
      result.warnings.push(
        'No complete appointment date AND time. Fill "Appointment Date" + "Appointment Time" on the ' +
        `REI contact, or put the date and time in the task title. Found: ${seen}`
      );
    }
    if (!result.assignedOwner) result.warnings.push('Assigned owner was not found.');
    // Surface a REI-vs-title disagreement instead of silently preferring one.
    if (appointmentSource === 'REI appointment fields' && titleDt?.isValid) {
      const chosen = DateTime.fromISO(result.appointmentStartIso, { zone: config.calendarTimezone });
      if (chosen.isValid && Math.abs(chosen.diff(titleDt, 'minutes').minutes) > 1) {
        result.warnings.push(
          `Appointment differs between REI (${chosen.toFormat('MMM d, yyyy h:mm a')}) and the task ` +
          `title (${titleDt.toFormat('MMM d, yyyy h:mm a')}). Used the REI page value.`
        );
      }
    }

    await captureDebug(page, cancelled ? 'rei-cancelled' : 'rei-success', { extracted: result, pairCount: pairs.length });
    return result;
  } catch (error) {
    await captureDebug(page, 'rei-error', { error: { name: error.name, message: error.message } });
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}
