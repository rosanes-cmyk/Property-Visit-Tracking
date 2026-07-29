import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import { assertAuthenticated } from './browser.mjs';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

async function loadSelectorConfig() {
  const raw = await fs.readFile(config.reiSelectorConfig, 'utf8');
  return JSON.parse(raw);
}

function extractRecordId(url) {
  try {
    const parsed = new URL(url);
    const queryId =
      parsed.searchParams.get('id') ||
      parsed.searchParams.get('contactId') ||
      parsed.searchParams.get('taskId');
    if (queryId) return queryId;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const candidate = [...segments].reverse().find((segment) => /^[A-Za-z0-9_-]{5,}$/.test(segment));
    return candidate || crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  } catch {
    return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  }
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

    // Appointment = date-part of "Appointment Date" (its clock value is a created-timestamp
    // artifact) + the separate "Appointment Time" field.
    const apptDateOnly =
      (apptDateRaw.match(/[A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4}/) || [])[0] ||
      (apptDateRaw.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || [])[0] ||
      '';
    const apptCombined = [apptDateOnly, apptTime].filter(Boolean).join(' ');
    const appointmentStartIso =
      parseDateTimeString(apptCombined) ||
      parseDateTimeString(apptDateRaw) ||
      parseDateTimeString(emailFallback.appointmentStartIso || '') ||
      normalize(emailFallback.appointmentStartIso || '');

    const notes = longTextItems(pairs);

    // Cancellation is signalled by the notification (subject/title) or a "Canceled Appointment"
    // tag on the contact. We do NOT infer it from lead stage alone.
    const cancelText = `${emailFallback.rawTitle || ''} ${visibleText}`.toLowerCase();
    const cancelled = /cancel(?:l)?ed appointment/.test(cancelText) || /\bcancelled appointment\b/.test(cancelText);
    const taskStatus = cancelled ? 'Cancelled' : '';

    const phoneFallback = firstRegex(visibleText, /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    const emailPageFallback = firstRegex(visibleText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

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
      contactStage: normalize(contactStage),
      propertyDetails: normalize(amountOffer ? `Amount Offer: ${amountOffer}` : ''),
      notes: notes.join('\n\n'),
      latestActivity: '',
      nextAction: normalize(nextAction),
      leadSource: normalize(leadSource),
      scrapedAt: DateTime.now().setZone(config.calendarTimezone).toISO(),
      sourceUrl: page.url(),
      warnings: [...(emailFallback.warnings || [])]
    };

    if (!result.sellerName) result.warnings.push('Seller name was not found.');
    if (!result.propertyAddress) result.warnings.push('Property address was not found.');
    if (!result.appointmentStartIso) result.warnings.push('Appointment date/time was not found or could not be parsed.');
    if (!result.assignedOwner) result.warnings.push('Assigned owner was not found.');

    await captureDebug(page, cancelled ? 'rei-cancelled' : 'rei-success', { extracted: result, pairCount: pairs.length });
    return result;
  } catch (error) {
    await captureDebug(page, 'rei-error', { error: { name: error.name, message: error.message } });
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}
