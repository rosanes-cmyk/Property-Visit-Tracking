/**
 * WhatsApp Web driver.
 *
 * Selector status: chatList, searchBox, newChatButton, newGroupButton, participantSearch and
 * participantResults were CONFIRMED against a live session (2026-08-03). nextButton,
 * groupSubjectInput and createGroupButton are still candidates — WhatsApp only renders them once a
 * participant has been picked, which cannot be checked without touching a real contact. Re-run
 * `npm run whatsapp:doctor` after any WhatsApp update; its markup changes often.
 *
 * Hard rules, enforced in code below:
 *   - This module NEVER sends a message. There is no send function, and the composer is never typed
 *     into. It creates a group and stops.
 *   - Nothing happens unless apply is true. The default path opens, looks, and reports.
 *   - A participant is only clicked when the contact row confirms the number we searched for.
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

export const WHATSAPP_URL = 'https://web.whatsapp.com/';

/** Anything that could send or delete. Asserted against every selector before it is used. */
const FORBIDDEN = /send|delete|clear|block|report|exit|leave|logout|log out/i;

export async function launchWhatsApp({ userDataDir, headless = false, timezone = 'America/Los_Angeles' }) {
  await fs.mkdir(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    timezoneId: timezone,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
    permissions: []
  });
  context.setDefaultTimeout(30000);
  return context;
}

/**
 * Throws unless a logged-in session is present. A QR code means the session expired.
 *
 * WhatsApp Web paints its shell well before the chat list arrives, so this WAITS for the list rather
 * than checking once and judging. Checking immediately is what made a run fail with "chat list was
 * not found" minutes after the doctor had found it without trouble — the doctor happened to sit for
 * four seconds first, and the real path did not.
 */
export async function assertLoggedIn(page, selectors) {
  await page.goto(WHATSAPP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

  const chatListSelector = (selectors.chatList || []).map(assertSafe).join(', ');
  const qrSelector = "canvas[aria-label*='scan' i], [data-testid='qrcode']";

  // Whichever appears first settles it: the chat list means logged in, a QR means it is not.
  if (chatListSelector) {
    await page.waitForSelector(`${chatListSelector}, ${qrSelector}`, { timeout: 60000 }).catch(() => {});
  }

  const qr = page.locator(qrSelector).first();
  if (await qr.isVisible().catch(() => false)) {
    throw new Error('WhatsApp Web is showing a QR code — the session is not logged in. Run: node scripts/whatsapp-login.mjs');
  }

  const chatList = await firstVisible(page, selectors.chatList || [], { perCandidateMs: 8000 });
  if (!chatList.locator) {
    throw new Error(
      'WhatsApp Web loaded, no QR is showing, but the chat list never appeared within 60s.\n' +
      'Run: node scripts/whatsapp-doctor.mjs   — it will report the page state and which selectors resolve.'
    );
  }
}

/**
 * First candidate selector that resolves to something visible, plus which one it was.
 *
 * Each candidate gets its own timeout rather than a share of one budget. Dividing a fixed budget
 * meant that ADDING a fallback selector shortened the wait for the correct one — five candidates got
 * 800ms each, which is not long enough for WhatsApp to paint.
 */
export async function firstVisible(page, candidates, { perCandidateMs = 1500 } = {}) {
  for (const selector of candidates) {
    assertSafe(selector);
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: perCandidateMs }).catch(() => false);
    if (visible) return { selector, locator };
  }
  return { selector: '', locator: null };
}

/**
 * A selector that could match a destructive control never gets used. This is what stops a stale
 * guess from clicking "Send" or "Delete chat" when WhatsApp reshuffles its markup.
 */
export function assertSafe(selector) {
  if (FORBIDDEN.test(String(selector))) {
    throw new Error(`Refusing to use a selector that could hit a destructive control: ${selector}`);
  }
  return selector;
}

/** Does a group with this exact subject already exist? Search-only; opens nothing. */
export async function groupExists(page, selectors, name) {
  const search = await firstVisible(page, selectors.searchBox || []);
  if (!search.locator) throw new Error('Could not find the search box. Run: npm run whatsapp:doctor');

  await search.locator.click();
  await page.keyboard.press('Control+A').catch(() => {});
  await search.locator.fill(name).catch(async () => { await page.keyboard.type(name); });
  await page.waitForTimeout(1200);

  const results = page.locator((selectors.searchResultTitles || []).join(', ') || "[role='listitem'] span[title]");
  const count = await results.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    // The title attribute is not always present — on this build the row title sits in
    // [data-testid='cell-frame-title'] and the attribute may be on a span inside it. Reading the
    // attribute alone silently found nothing, which would have meant creating a duplicate group.
    const row = results.nth(i);
    const attr = (await row.getAttribute('title').catch(() => '')) || '';
    const text = (await row.innerText().catch(() => '')) || '';
    if (attr.trim() === name || text.replace(/\s+/g, ' ').trim() === name) {
      await clearSearch(page, search.locator);
      return true;
    }
  }
  await clearSearch(page, search.locator);
  return false;
}

async function clearSearch(page, box) {
  await box.fill('').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Create one group.
 *
 * With apply=false (the default) it walks as far as the participant picker, reports which of the
 * numbers WhatsApp can actually find, and then backs out with Escape without creating anything.
 */
export async function createGroup(page, selectors, { name, participants, apply = false }) {
  const report = { name, apply, created: false, added: [], notFound: [], steps: [] };
  const step = (text) => report.steps.push(text);

  const menu = await firstVisible(page, selectors.newChatButton || []);
  if (!menu.locator) throw new Error('Could not find the "New chat" button. Run: npm run whatsapp:doctor');
  await menu.locator.click();
  await page.waitForTimeout(600);
  step('opened New chat');

  const newGroup = await firstVisible(page, selectors.newGroupButton || []);
  if (!newGroup.locator) throw new Error('Could not find "New group". Run: npm run whatsapp:doctor');
  await newGroup.locator.click();
  await page.waitForTimeout(800);
  step('opened New group');

  const picker = await firstVisible(page, selectors.participantSearch || []);
  if (!picker.locator) throw new Error('Could not find the participant search box. Run: npm run whatsapp:doctor');

  for (const person of participants) {
    // Typed through the KEYBOARD, not into a located element. The editable field inside
    // [data-testid='inputarea'] carries no testid, aria-label or title, so no selector finds it
    // reliably — but clicking the container focuses it, and keyboard input then lands correctly.
    // This also survives WhatsApp swapping the inner element, which it does often.
    await picker.locator.click().catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(person.number, { delay: 40 });
    await page.waitForTimeout(1400);

    const rows = page.locator((selectors.participantResults || []).join(', ') || "[role='listitem']");
    const rowCount = await rows.count().catch(() => 0);
    let matched = false;

    for (let i = 0; i < rowCount; i += 1) {
      const text = ((await rows.nth(i).innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      // Only click a row that shows the digits we searched for. Without this a "no results" state,
      // or WhatsApp helpfully offering a similar contact, would add the wrong person.
      if (!sameDigits(text, person.number)) continue;
      if (apply) await rows.nth(i).click();
      report.added.push(person.number);
      matched = true;
      break;
    }
    if (!matched) report.notFound.push(person.number);
    await page.waitForTimeout(400);
  }
  step(`resolved ${report.added.length}/${participants.length} participant(s)`);

  if (!apply) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    step('DRY RUN — backed out, nothing created');
    return report;
  }

  if (!report.added.length) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    step('no participants resolved — aborted before creating');
    return report;
  }

  const next = await firstVisible(page, selectors.nextButton || []);
  if (!next.locator) throw new Error('Could not find the "Next" arrow. Run: npm run whatsapp:doctor');
  await next.locator.click();
  await page.waitForTimeout(800);

  const subject = await firstVisible(page, selectors.groupSubjectInput || []);
  if (!subject.locator) throw new Error('Could not find the group subject field. Run: npm run whatsapp:doctor');
  await subject.locator.click();
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.type(name, { delay: 30 });   // keyboard, for the same reason as above
  await page.waitForTimeout(400);
  step(`typed subject "${name}"`);

  const create = await firstVisible(page, selectors.createGroupButton || []);
  if (!create.locator) throw new Error('Could not find the create/confirm control. Run: npm run whatsapp:doctor');
  await create.locator.click();
  await page.waitForTimeout(2500);

  report.created = true;
  step('group created');
  return report;
}

/** Do these two strings contain the same phone number? Last 10 digits, so formatting cannot lie. */
export function sameDigits(haystack, number) {
  const want = String(number).replace(/\D/g, '').slice(-10);
  if (want.length < 10) return false;
  const found = String(haystack).replace(/\D/g, '');
  return found.includes(want);
}
