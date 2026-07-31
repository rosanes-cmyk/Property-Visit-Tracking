/**
 * ProfitDial "from number" widget: discovery, reading, and verification.
 *
 * Why this exists: the outbound caller-ID picker is a custom React widget, so hand-written selectors
 * are guesses. Everything here is built to *find* the widget on the live page and report which
 * selector actually worked, so config/rei-selectors.json can be filled in with confirmed values
 * instead of guesses.
 *
 * SAFETY — this module is read/verify only by design:
 *   - It never clicks a call, text, send, or delete control. `clickFromNumber` refuses to click
 *     anything whose text is not a phone number, so a mis-resolved selector cannot dial or send.
 *   - Opening a dropdown and pressing Escape is the only page interaction the default path performs.
 *   - Changing the selected number is a settings change, so it is gated behind an explicit
 *     `apply: true` and is never called by the polling automation.
 */
// Deliberately imports nothing but fs: the matching helpers below are unit-tested offline, and
// pulling in config.mjs here would make that impossible (it hard-requires SPREADSHEET_ID).
import fs from 'node:fs/promises';

/** Digits only. "+1 (510) 916-3995" -> "15109163995" */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Digit-for-digit comparison on the last 10 digits, so a country code on either side does not
 * cause a false mismatch. Anything shorter than 10 digits is not a US number and never matches —
 * that keeps a stray "3995" or an empty string from passing as a match.
 */
export function sameNumber(a, b) {
  const left = digitsOf(a);
  const right = digitsOf(b);
  if (left.length < 10 || right.length < 10) return false;
  return left.slice(-10) === right.slice(-10);
}

/** True when the text looks like a phone number and nothing else meaningful. */
export function looksLikePhone(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (digitsOf(value).length < 10 || digitsOf(value).length > 15) return false;
  // Allow digits, spaces, and the usual separators only. "Call (510) 916-3995 now" is rejected.
  return /^[+()\-.\s\d]+$/.test(value);
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** @param selectorPath path to rei-selectors.json (callers pass config.reiSelectorConfig). */
export async function loadChatSelectors(selectorPath) {
  const parsed = JSON.parse(await fs.readFile(selectorPath, 'utf8'));
  const chat = parsed.chat || {};
  return {
    expectedFromNumber: chat.expectedFromNumber || '',
    profitDialSelect: chat.profitDialSelect || [],
    profitDialOptions: chat.profitDialOptions || [],
    profitDialSelectedValue: chat.profitDialSelectedValue || []
  };
}

/**
 * Return the first candidate selector that resolves to a visible element, plus that selector, so
 * callers can report WHICH guess was right.
 */
async function firstVisible(page, selectors, { mustLookLikePhone = false } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    if (mustLookLikePhone) {
      const text = normalize(await locator.innerText().catch(() => ''));
      if (!looksLikePhone(text)) continue;
    }
    return { selector, locator };
  }
  return { selector: '', locator: null };
}

/**
 * Scan the live DOM for anything that could be the from-number picker. This is what removes the
 * need for `playwright codegen`: it reports concrete, paste-ready selectors for every element that
 * both looks interactive and shows a phone number.
 */
export async function discoverFromNumberCandidates(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const digits = (value) => norm(value).replace(/\D+/g, '');
    const phoneish = (value) => {
      const text = norm(value);
      const count = digits(text).length;
      return count >= 10 && count <= 15 && /^[+()\-.\s\d]+$/.test(text);
    };

    // A CSS path a human can paste. Prefer a test id, then a stable id, then role + aria-label.
    const describe = (element) => {
      const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
      if (testId) return `[data-testid='${testId}']`;
      const id = element.getAttribute('id');
      if (id && !/^[0-9]/.test(id) && !/\d{4,}/.test(id)) return `#${id}`;
      const role = element.getAttribute('role');
      const aria = element.getAttribute('aria-label');
      if (role && aria) return `[role='${role}'][aria-label='${aria}']`;
      if (role) return `[role='${role}']`;
      const name = element.getAttribute('name');
      if (name) return `${element.tagName.toLowerCase()}[name='${name}']`;
      const cls = (typeof element.className === 'string' ? element.className : '')
        .split(/\s+/)
        .filter((c) => c && !/^css-/.test(c))
        .slice(0, 2);
      if (cls.length) return `${element.tagName.toLowerCase()}.${cls.join('.')}`;
      return element.tagName.toLowerCase();
    };

    const interactive = [
      ...document.querySelectorAll(
        "select, [role='combobox'], [role='listbox'], [role='button'], button, [aria-haspopup], [class*='select' i], [class*='dropdown' i], [class*='fromNumber' i], [class*='from-number' i]"
      )
    ].slice(0, 3000);

    const seen = new Set();
    const candidates = [];
    for (const element of interactive) {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const text = norm(element.innerText || element.value || '');
      const aria = norm(element.getAttribute('aria-label') || '');
      const relevant = phoneish(text) || /from\s*number|caller\s*id|profit\s*dial/i.test(`${text} ${aria}`);
      if (!relevant) continue;
      const selector = describe(element);
      const key = `${selector}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        selector,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        ariaLabel: aria,
        testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || '',
        text: text.slice(0, 120),
        showsPhone: phoneish(text),
        visible
      });
    }
    return candidates;
  });
}

/** Read the number currently shown as selected, without opening anything. */
export async function readSelectedFromNumber(page, chat) {
  const hit = await firstVisible(page, chat.profitDialSelectedValue, { mustLookLikePhone: true });
  if (hit.locator) {
    return { shown: normalize(await hit.locator.innerText().catch(() => '')), selector: hit.selector };
  }
  // Fall back to a native <select>, whose selected text is not rendered as a child element.
  for (const selector of chat.profitDialSelect) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag !== 'select') continue;
    const shown = await locator
      .evaluate((el) => (el.selectedOptions?.[0]?.textContent || '').trim())
      .catch(() => '');
    if (looksLikePhone(shown)) return { shown: normalize(shown), selector };
  }
  return { shown: '', selector: '' };
}

/** Open the picker and list the offered numbers, then close it again with Escape. */
export async function listFromNumbers(page, chat) {
  const trigger = await firstVisible(page, chat.profitDialSelect);
  if (!trigger.locator) return { options: [], triggerSelector: '', optionSelector: '' };

  await trigger.locator.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  let optionSelector = '';
  let options = [];
  for (const selector of chat.profitDialOptions) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const texts = (await locator.allInnerTexts().catch(() => [])).map(normalize).filter(Boolean);
    const phones = texts.filter(looksLikePhone);
    if (!phones.length) continue;
    optionSelector = selector;
    options = texts;
    break;
  }

  await page.keyboard.press('Escape').catch(() => {});
  return { options, triggerSelector: trigger.selector, optionSelector };
}

/**
 * Report whether the widget is already on `wanted`. Read-only: it opens the dropdown to enumerate
 * options and closes it again, and changes nothing.
 */
export async function verifyFromNumber(page, chat, wanted = chat.expectedFromNumber) {
  const selected = await readSelectedFromNumber(page, chat);
  const listed = await listFromNumbers(page, chat);
  const match = listed.options.find((text) => sameNumber(text, wanted)) || '';
  return {
    wanted,
    shown: selected.shown,
    matches: sameNumber(selected.shown, wanted),
    availableMatch: match,
    options: listed.options,
    resolved: {
      profitDialSelect: listed.triggerSelector,
      profitDialOptions: listed.optionSelector,
      profitDialSelectedValue: selected.selector
    }
  };
}

/**
 * Change the selected from-number. Gated: does nothing unless `apply` is true.
 *
 * The click target is filtered through looksLikePhone(), so if a selector resolves to the wrong
 * part of the UI this refuses to act rather than pressing an unknown button.
 */
export async function selectFromNumber(page, chat, wanted = chat.expectedFromNumber, { apply = false } = {}) {
  const before = await verifyFromNumber(page, chat, wanted);
  if (before.matches) return { ...before, changed: false, reason: 'already selected' };
  if (!apply) return { ...before, changed: false, reason: 'read-only (pass apply:true to change it)' };
  if (!before.availableMatch) {
    return { ...before, changed: false, reason: `no offered number matches ${wanted}` };
  }

  const trigger = await firstVisible(page, chat.profitDialSelect);
  if (!trigger.locator) return { ...before, changed: false, reason: 'from-number picker not found' };
  await trigger.locator.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  const optionSelector = before.resolved.profitDialOptions;
  if (!optionSelector) {
    await page.keyboard.press('Escape').catch(() => {});
    return { ...before, changed: false, reason: 'option list not found' };
  }

  const options = page.locator(optionSelector);
  const count = await options.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const text = normalize(await option.innerText().catch(() => ''));
    if (!sameNumber(text, wanted)) continue;
    if (!looksLikePhone(text)) continue; // refuse to click anything that is not purely a number
    await option.click({ timeout: 5000 });
    await page.waitForTimeout(600);
    const after = await readSelectedFromNumber(page, chat);
    return {
      ...before,
      shown: after.shown,
      matches: sameNumber(after.shown, wanted),
      changed: sameNumber(after.shown, wanted),
      reason: sameNumber(after.shown, wanted) ? 'selected' : 'clicked but the widget still shows something else'
    };
  }

  await page.keyboard.press('Escape').catch(() => {});
  return { ...before, changed: false, reason: 'no clickable option matched' };
}
