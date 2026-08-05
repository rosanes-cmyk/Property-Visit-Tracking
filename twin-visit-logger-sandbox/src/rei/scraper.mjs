import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import { assertAuthenticated } from './browser.mjs';
// readTasks is READ-ONLY — it lists task rows and clicks nothing. completeTask, the one REI write this
// project can make, is deliberately not imported here.
import { readTasks } from './tasks.mjs';
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

function valueForLabel(pairs, labels = []) {
  for (const label of labels) {
    const lower = String(label).toLowerCase();
    for (const text of pairs) {
      if (text.toLowerCase().startsWith(lower)) {
        const value = normalize(text.slice(label.length));
        if (value && value !== '-') return value;
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
  await page.waitForSelector(searchSel, { timeout: 20000 });
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

export async function scrapeReiVisit(context, reiLink, emailFallback = {}) {
  const selectorConfig = await loadSelectorConfig();
  const L = selectorConfig.listItemLabels || {};
  const page = await context.newPage();
  try {
    // Decide which contact page to open: a direct REI contact URL if we have one, otherwise
    // locate it by searching REI for the phone number carried in the task title.
    let targetUrl = /reiblackbook\.com\/contacts\/\d+/i.test(String(reiLink || '')) ? reiLink : '';
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

    const effectiveLink = /reiblackbook\.com\/contacts\/\d+/i.test(page.url()) ? page.url() : targetUrl;
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
    const nextAction = valueForLabel(pairs, L.nextAction || ['Next Step']);
    const callDisposition = valueForLabel(pairs, L.callDisposition || ['Call Disposition']);
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

    const notes = longTextItems(pairs);

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
    if (!cancelled) {
      try {
        const apptDay = appointmentStartIso
          ? DateTime.fromISO(appointmentStartIso, { zone: config.calendarTimezone }).toFormat('yyyy-MM-dd')
          : '';
        const thisVisit = { phone: normalize(phone || phoneFallback || emailFallback.phone || ''), date: apptDay };
        const tasks = await readTasks(page, selectorConfig, { timezone: config.calendarTimezone });
        const mine = tasks.find((t) => taskMatchesVisit(t, thisVisit));
        if (mine && mine.complete) {
          visitTaskState = 'complete';
          visitTaskReason = 'REI shows the booked-appointment task ticked off';
        } else if (mine) {
          visitTaskState = 'open';
          visitTaskReason = 'REI shows the booked-appointment task still open';
        } else if (!tasks.length) {
          visitTaskState = 'unknown';
          visitTaskReason = 'no booked-appointment task rows could be read on the contact page';
        } else {
          visitTaskState = 'unknown';
          visitTaskReason = `${tasks.length} booked-appointment task(s) on the contact, none matching this ` +
            `visit on phone AND date${apptDay ? ` (${apptDay})` : ' (no appointment date to match on)'}`;
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
      cancelPhrase: cancelEvidence.phrase,
      deadLeadTags: deadTags,
      contactStage: normalize(contactStage),
      propertyDetails: normalize(amountOffer ? `Amount Offer: ${amountOffer}` : ''),
      notes: notes.join('\n\n'),
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
