import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import { assertAuthenticated } from './browser.mjs';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (values) => [...new Set(values.map(normalize).filter(Boolean))];

async function loadSelectorConfig() {
  const raw = await fs.readFile(config.reiSelectorConfig, 'utf8');
  return JSON.parse(raw);
}

async function firstTextFromSelectors(page, selectors = []) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.count())) continue;
      const value = await locator.evaluate((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          return element.value;
        }
        if (element instanceof HTMLAnchorElement) {
          if (element.href.startsWith('mailto:')) return element.href.replace(/^mailto:/i, '');
          if (element.href.startsWith('tel:')) return element.href.replace(/^tel:/i, '');
        }
        return element.textContent || '';
      });
      const cleaned = normalize(value);
      if (cleaned) return cleaned;
    } catch {
      // Candidate selectors are intentionally best-effort.
    }
  }
  return '';
}

async function valueByLabels(page, labels = []) {
  if (!labels.length) return '';
  return page.evaluate((wantedLabels) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const lower = (value) => norm(value).toLowerCase().replace(/:$/, '');
    const wanted = wantedLabels.map(lower);
    const candidates = [
      ...document.querySelectorAll('label, dt, th, [class*="label"], [data-testid*="label"], [data-test*="label"]')
    ];

    const textOf = (element) => {
      if (!element) return '';
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return norm(element.value);
      }
      if (element instanceof HTMLAnchorElement) {
        if (element.href.startsWith('mailto:')) return element.href.replace(/^mailto:/i, '');
        if (element.href.startsWith('tel:')) return element.href.replace(/^tel:/i, '');
      }
      return norm(element.textContent);
    };

    for (const candidate of candidates) {
      const candidateLabel = lower(candidate.textContent);
      if (!wanted.some((label) => candidateLabel === label || candidateLabel.includes(label))) continue;

      const forId = candidate.getAttribute('for');
      if (forId) {
        const target = document.getElementById(forId);
        const value = textOf(target);
        if (value && lower(value) !== candidateLabel) return value;
      }

      const sibling = candidate.nextElementSibling;
      const siblingValue = textOf(sibling);
      if (siblingValue && lower(siblingValue) !== candidateLabel) return siblingValue;

      const parent = candidate.parentElement;
      if (parent) {
        const children = [...parent.children].filter((child) => child !== candidate);
        for (const child of children) {
          const value = textOf(child);
          if (value && lower(value) !== candidateLabel) return value;
        }
      }
    }
    return '';
  }, labels);
}

async function clickTab(page, names = []) {
  for (const name of names) {
    const candidates = [
      page.getByRole('tab', { name, exact: false }).first(),
      page.getByRole('button', { name, exact: false }).first(),
      page.getByRole('link', { name, exact: false }).first(),
      page.getByText(name, { exact: true }).first()
    ];
    for (const locator of candidates) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.click().catch(() => {});
        await page.waitForTimeout(750);
        return true;
      }
    }
  }
  return false;
}

async function collectTexts(page, selectors = [], limit = 30) {
  const values = [];
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = Math.min(await locator.count(), limit);
      for (let index = 0; index < count; index += 1) {
        const text = normalize(await locator.nth(index).textContent().catch(() => ''));
        if (text) values.push(text);
      }
    } catch {
      // Keep trying alternative candidate selectors.
    }
  }
  return unique(values).slice(0, limit);
}

function extractRecordId(url) {
  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get('id') || parsed.searchParams.get('contactId') || parsed.searchParams.get('taskId');
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

function parseAppointmentDateTime(...candidates) {
  const formats = [
    'MMMM d, yyyy h:mm a',
    'MMM d, yyyy h:mm a',
    'M/d/yyyy h:mm a',
    'MM/dd/yyyy h:mm a',
    'M/d/yy h:mm a',
    'M/d/yyyy, h:mm a',
    'MM/dd/yyyy, h:mm a',
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm",
    // Year-less variants (e.g. "Jul 28 10:00 AM"); Luxon fills in the current year.
    'MMMM d h:mm a',
    'MMM d h:mm a',
    'M/d h:mm a'
  ];

  for (const candidate of candidates.flatMap((value) => [value]).filter(Boolean)) {
    const text = normalize(candidate)
      .replace(/\b(?:PST|PDT|Pacific Time|PT)\b/gi, '')
      .trim();
    const embedded = text.match(
      /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i
    );
    const slash = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
    const options = unique([embedded?.[0], slash?.[0], text]);

    for (const option of options) {
      for (const format of formats) {
        const parsed = DateTime.fromFormat(option, format, {
          zone: config.calendarTimezone,
          locale: 'en-US'
        });
        if (parsed.isValid) return parsed.toISO();
      }
      const iso = DateTime.fromISO(option, { zone: config.calendarTimezone });
      if (iso.isValid) return iso.toISO();
    }
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

async function extractField(page, selectorConfig, fieldName) {
  const direct = await firstTextFromSelectors(page, selectorConfig.fields?.[fieldName] || []);
  if (direct) return direct;
  return valueByLabels(page, selectorConfig.labels?.[fieldName] || []);
}

export async function scrapeReiVisit(context, reiLink, emailFallback = {}) {
  const selectorConfig = await loadSelectorConfig();
  const page = await context.newPage();
  try {
    await page.goto(reiLink, { waitUntil: 'domcontentloaded', timeout: config.reiPageTimeoutMs });
    await page.waitForTimeout(1500);
    await assertAuthenticated(page, selectorConfig.login || {});

    const visibleText = normalize(await page.locator('body').innerText().catch(() => ''));

    const core = {};
    for (const field of [
      'sellerName',
      'phone',
      'email',
      'propertyAddress',
      'appointmentDateTime',
      'assignedOwner',
      'taskTitle',
      'taskStatus',
      'contactStage',
      'leadSource',
      'nextAction'
    ]) {
      core[field] = await extractField(page, selectorConfig, field);
    }

    await clickTab(page, selectorConfig.tabs?.tasks || []);
    for (const field of ['appointmentDateTime', 'assignedOwner', 'taskTitle', 'taskStatus', 'nextAction']) {
      const tabValue = await extractField(page, selectorConfig, field);
      if (tabValue) core[field] = tabValue;
    }

    await clickTab(page, selectorConfig.tabs?.property || []);
    for (const field of ['propertyAddress', 'leadSource']) {
      const tabValue = await extractField(page, selectorConfig, field);
      if (tabValue) core[field] = tabValue;
    }
    const propertyDetails = await collectTexts(
      page,
      selectorConfig.collectionSelectors?.propertyDetails || [],
      20
    );

    await clickTab(page, selectorConfig.tabs?.notes || []);
    const notes = await collectTexts(page, selectorConfig.collectionSelectors?.notes || [], 30);

    await clickTab(page, selectorConfig.tabs?.activity || []);
    const activity = await collectTexts(page, selectorConfig.collectionSelectors?.activity || [], 30);

    const title = normalize(core.taskTitle || emailFallback.rawTitle || '');
    const appointmentStartIso = parseAppointmentDateTime(
      core.appointmentDateTime,
      title,
      emailFallback.appointmentStartIso
    );

    const phoneFallback = firstRegex(visibleText, /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    const emailPageFallback = firstRegex(visibleText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const addressFallback = firstRegex(
      visibleText,
      /\b\d{1,6}\s+[A-Za-z0-9.'#-]+(?:\s+[A-Za-z0-9.'#-]+){0,6},?\s+[A-Za-z .'-]+,?\s+CA\s+\d{5}(?:-\d{4})?\b/i
    );

    const result = {
      reiLink,
      reiRecordId: extractRecordId(reiLink),
      sellerName: normalize(core.sellerName || emailFallback.sellerName),
      phone: normalize(core.phone || phoneFallback),
      email: normalize(core.email || emailPageFallback),
      propertyAddress: normalize(core.propertyAddress || emailFallback.propertyAddress || addressFallback),
      appointmentStartIso,
      assignedOwner: normalize(core.assignedOwner || emailFallback.assignedOwner),
      taskTitle: title,
      taskStatus: normalize(core.taskStatus),
      contactStage: normalize(core.contactStage),
      propertyDetails: propertyDetails.join('\n'),
      notes: notes.join('\n\n'),
      latestActivity: activity.join('\n\n'),
      nextAction: normalize(core.nextAction),
      leadSource: normalize(core.leadSource),
      scrapedAt: DateTime.now().setZone(config.calendarTimezone).toISO(),
      sourceUrl: page.url(),
      warnings: [...(emailFallback.warnings || [])]
    };

    if (!result.sellerName) result.warnings.push('Seller name was not found.');
    if (!result.propertyAddress) result.warnings.push('Property address was not found.');
    if (!result.appointmentStartIso) result.warnings.push('Appointment date/time was not found or could not be parsed.');
    if (!result.assignedOwner) result.warnings.push('Assigned owner was not found.');

    await captureDebug(page, 'rei-success', { extracted: result });
    return result;
  } catch (error) {
    await captureDebug(page, 'rei-error', { error: { name: error.name, message: error.message } });
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}
