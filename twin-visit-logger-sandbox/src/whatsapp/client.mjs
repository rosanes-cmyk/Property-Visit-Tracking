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
 *   - postGroupNote is the ONLY function that sends anything, and only into a conversation whose
 *     header it has confirmed matches the group name. Nothing else touches the composer.
 *   - Nothing happens unless apply is true. The default path opens, looks, and reports.
 *   - A participant is only clicked when the contact row confirms the number we searched for.
 *   - No selector that could match a send/delete/leave control is ever used (assertSafe).
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.mjs';
import { plausibleTitle, titlesMatch, noteAlreadyPresent } from './post-gate.mjs';

export const WHATSAPP_URL = 'https://web.whatsapp.com/';

/** Anything that could send or delete. Asserted against every selector before it is used. */
/*
 * `remove` and `dismiss` joined this list when admin promotion was added.
 *
 * The member menu that holds "Make group admin" also holds "Remove <name> from group" and, once
 * promoted, "Dismiss as admin" — sitting directly under the item we want. A selector that drifted by
 * one row would quietly throw a colleague out of the group instead of promoting them, and the run
 * would report success because a click landed.
 */
const FORBIDDEN = /send|delete|clear|block|report|exit|leave|logout|log out|remove|dismiss/i;

export async function launchWhatsApp({ userDataDir, headless = false, timezone = 'America/Los_Angeles' }) {
  await fs.mkdir(userDataDir, { recursive: true });
  /*
   * `channel: 'chrome'` drives the Chrome that is INSTALLED on this PC rather than Playwright's own
   * Chromium, and it is off unless WHATSAPP_USE_SYSTEM_CHROME says otherwise.
   *
   * It exists because WhatsApp Web served this automation a blank page and redirected it to
   * `?post_logout=1` with no QR, while the same number in an incognito window on the same machine got a QR
   * instantly. Playwright's bundled Chromium is not the same build as Chrome — no proprietary media codecs
   * — and WhatsApp Web refuses builds it does not recognise, which fits what was seen exactly.
   *
   * Worth testing. NOT a safety measure: if it links, the risk is identical to the one that has already
   * cost three numbers, because what Meta objects to is a program driving WhatsApp Web at all. Anyone
   * turning this on should read src/config.mjs where that is spelled out.
   */
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(config.whatsappUseSystemChrome ? { channel: 'chrome' } : {}),
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
  // A generous per-candidate wait on purpose: this is the first thing touched after a navigation, and
  // the default 1.5s is shorter than WhatsApp takes to repaint its header.
  const search = await openSearch(page, selectors);
  if (!search.locator) {
    throw new Error(
      'Could not find the search box, even after a reload.\n' +
      'Run: node scripts/whatsapp-doctor.mjs   — it reports the page state and which selectors resolve.'
    );
  }

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

/*
 * Empty the search box and leave it usable.
 *
 * This used to press Escape, which collapses WhatsApp's search UI entirely — the box stops being
 * visible. groupExists ran, found the group, tidied up with Escape, and the very next step failed with
 * "could not find the search box" on a page where it had just worked. Clearing the value is enough.
 */
async function clearSearch(page, box) {
  await box.fill('').catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * The search box, reopening it if something collapsed it.
 *
 * Three attempts, escalating, because failing this fails the whole run: as it is, then after an Escape
 * to dismiss whatever drawer is covering the pane, then after a reload. A reload costs a few seconds and
 * is certain, which beats reporting a missing search box on a logged-in session that has one.
 */
async function openSearch(page, selectors) {
  let hit = await firstVisible(page, selectors.searchBox || [], { perCandidateMs: 6000 });
  if (hit.locator) return hit;

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  hit = await firstVisible(page, selectors.searchBox || [], { perCandidateMs: 6000 });
  if (hit.locator) return hit;

  await page.goto(WHATSAPP_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitForChatList(page, selectors);
  return await firstVisible(page, selectors.searchBox || [], { perCandidateMs: 8000 });
}

/**
 * Make a number findable in the group picker, without saving it as a contact.
 *
 * WhatsApp's "New group" participant search only looks at SAVED CONTACTS and numbers you already
 * have a chat with. A correct, active number that is neither returns no results — which is why three
 * real team numbers came back as "NOT ON WHATSAPP" when they were nothing of the sort.
 *
 * Opening wa.me/<number> makes WhatsApp resolve the number and put a chat in the list, after which
 * the picker finds it. No message is sent: the URL carries no text parameter, the composer is never
 * typed into, and there is no send function in this module.
 *
 * Returns { onWhatsApp: [...], notOnWhatsApp: [...] } — this is also a reliable way to tell the two
 * apart, because WhatsApp says so explicitly for a number that has no account.
 */
export async function waitForChatList(page, selectors, timeout = 45000) {
  const joined = (selectors.chatList || []).map(assertSafe).join(', ');
  if (!joined) return;
  await page.waitForSelector(joined, { timeout }).catch(() => {});
  await page.waitForTimeout(1200);   // the list appears a moment before the header controls do
}

export async function warmUpNumbers(page, numbers, selectors = {}) {
  const onWhatsApp = [];
  const notOnWhatsApp = [];

  for (const number of numbers) {
    const digits = String(number).replace(/\D/g, '');
    if (!digits) continue;

    await page.goto(`${WHATSAPP_URL}send?phone=${digits}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3500);

    // WhatsApp is explicit when a number has no account: a modal saying the number is invalid or
    // not on WhatsApp. Anything else means it resolved and a chat now exists.
    const rejected = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
      return /phone number shared via url is invalid|isn'?t on WhatsApp|is not on WhatsApp|invalid (phone )?number/i.test(text);
    }).catch(() => false);

    if (rejected) {
      notOnWhatsApp.push(number);
      // Dismiss the modal so the next iteration starts from a clean page.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    } else {
      onWhatsApp.push(number);
    }
  }

  // Back to the chat list — and WAIT for it. A fixed pause here was not enough: the next step looked
  // for the search box while WhatsApp was still repainting after the navigation, and failed with
  // "Could not find the search box" on a page that was simply not ready yet.
  await page.goto(WHATSAPP_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitForChatList(page, selectors);
  return { onWhatsApp, notOnWhatsApp };
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

  const menu = await firstVisible(page, selectors.newChatButton || [], { perCandidateMs: 8000 });
  if (!menu.locator) throw new Error('Could not find the "New chat" button. Run: npm run whatsapp:doctor');
  await menu.locator.click();
  await page.waitForTimeout(600);
  step('opened New chat');

  const newGroup = await firstVisible(page, selectors.newGroupButton || [], { perCandidateMs: 8000 });
  if (!newGroup.locator) throw new Error('Could not find "New group". Run: npm run whatsapp:doctor');
  await newGroup.locator.click();
  await page.waitForTimeout(800);
  step('opened New group');

  const picker = await firstVisible(page, selectors.participantSearch || [], { perCandidateMs: 8000 });
  if (!picker.locator) throw new Error('Could not find the participant search box. Run: npm run whatsapp:doctor');

  for (const person of participants) {
    /*
     * NEVER Ctrl+A + Backspace here. In WhatsApp's picker the already-selected participants sit in
     * the same input as chips, so select-all-then-delete removes the person added on the previous
     * pass. That is why a run reporting "resolved 4/4" produced a group with one member: each number
     * deleted the one before it and only the last survived.
     *
     * fill('') clears the input's VALUE only and leaves the chips alone — safe now that the field is
     * confirmed to be a real <input type="text"> rather than a contenteditable.
     */
    await picker.locator.click().catch(() => {});
    await picker.locator.fill('').catch(() => {});
    await picker.locator.type(person.number, { delay: 40 }).catch(async () => {
      await page.keyboard.type(person.number, { delay: 40 });
    });
    await page.waitForTimeout(1600);

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
    await page.waitForTimeout(600);
  }
  step(`resolved ${report.added.length}/${participants.length} participant(s)`);

  // Read back how many the UI actually shows as selected. "resolved 4/4" described clicks, not
  // members — and a group of one was reported as a complete success because of it.
  if (apply) {
    const selected = await page.evaluate(() => {
      const drawer = document.querySelector("[data-testid='new-group-drawer-participants']")
        || document.querySelector("[data-testid='drawer-left']");
      if (!drawer) return null;
      // Chips carry a remove control; count those rather than guess at a class name.
      const chips = drawer.querySelectorAll("[data-testid*='chip' i], [aria-label*='Remove' i], button[aria-label*='remove' i]");
      return chips.length || null;
    }).catch(() => null);

    report.selectedInUi = selected;
    if (selected !== null && selected < report.added.length) {
      step(`WARNING: WhatsApp shows only ${selected} selected, not ${report.added.length} — ` +
           'check the group afterwards');
    } else if (selected !== null) {
      step(`WhatsApp shows ${selected} selected`);
    }
  }

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

/**
 * Read the title of the conversation currently open, or '' if none is.
 *
 * Scoped to `#main` — WhatsApp's conversation panel — for a reason that cost a whole run: an
 * unscoped `header span[title]` can match the LEFT pane's header, so it reported a title while no
 * conversation was open at all. `#main` exists only when a conversation is open, which makes its
 * absence the answer rather than a false positive.
 *
 * The header reads "<subject>\n<participant list>", so only the first line is the title.
 *
 * The RENDERED TEXT is read before the title attribute, and WhatsApp's own furniture is filtered out,
 * because the header's title attribute says "click here for group info" — reading that first is what
 * made a run refuse to post into two correctly-created groups.
 */
export async function readConversationTitle(page, selectors) {
  for (const candidate of selectors.conversationTitle || []) {
    assertSafe(candidate);
    const el = page.locator(candidate).first();
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = plausibleTitle((await el.innerText().catch(() => '')) || '');
    if (text) return text;
    const attr = plausibleTitle((await el.getAttribute('title').catch(() => '')) || '');
    if (attr) return attr;
  }
  return '';
}

/** Wait until the named conversation is the one on screen. Returns the title it settled on. */
export async function waitForConversation(page, selectors, name, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  // WhatsApp opens a freshly created group by itself, but it takes a moment and the header paints
  // after the message panel does. Polling beats one fixed pause, which is what made the first
  // note-posting attempt read an empty header and refuse.
  for (;;) {
    last = await readConversationTitle(page, selectors);
    if (titlesMatch(last, name)) return last;
    if (Date.now() >= deadline) return last;
    await page.waitForTimeout(700);
  }
}

/**
 * Open an existing group by exact subject. Search, click the row that matches, confirm the header.
 *
 * Used to repair a group that was created before note posting worked: it can be opened and given its
 * note without anyone deleting and rebuilding it.
 */
export async function openGroupByName(page, selectors, name) {
  const search = await openSearch(page, selectors);
  if (!search.locator) {
    return { opened: false, reason: 'could not find the search box, even after a reload' };
  }

  await search.locator.click();
  await search.locator.fill(name).catch(async () => { await page.keyboard.type(name); });
  await page.waitForTimeout(1400);

  const rows = page.locator((selectors.searchResultTitles || []).join(', ') || "[role='listitem'] span[title]");
  const count = await rows.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const attr = (await row.getAttribute('title').catch(() => '')) || '';
    const text = ((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (attr.trim() !== name && text !== name) continue;
    await row.click().catch(() => {});
    const header = await waitForConversation(page, selectors, name);
    return titlesMatch(header, name)
      ? { opened: true, reason: 'opened', header }
      : { opened: false, reason: `clicked the row but the header reads "${header || '(nothing)'}"` };
  }
  await clearSearch(page, search.locator);
  return { opened: false, reason: 'no chat with that exact name in the search results' };
}

/**
 * Make the one other member of a seeded group an admin, so they can add the rest of the team.
 *
 * Why this exists: a group created by the automation has "Add other members" switched OFF, so the
 * colleague it seeds is a plain member and cannot add Juan. Promoting them is two or three clicks;
 * flipping the group permission instead needs a settings screen and leaves the group looser for
 * everyone. Admin is the smaller change and it is the one the client asked for.
 *
 * Three refusals, because this is the second thing in the project that changes state on WhatsApp:
 *
 *   1. The open conversation's header must match the group name. Same rule as postGroupNote — a
 *      settings panel acted on while the wrong chat is open acts on the wrong group.
 *   2. There must be EXACTLY ONE other participant. In seed mode that is the whole population of the
 *      group, so one is the only correct answer; anything else means this is not a freshly seeded
 *      group and we are looking at the wrong thing. Guessing which of several people to promote from
 *      a phone number we cannot see on screen — WhatsApp shows saved contact NAMES — is how the wrong
 *      person gets rights.
 *   3. The menu item is matched on its TEXT, anchored, and must be exactly "make group admin". Its
 *      neighbours in that menu are "Remove from group" and "Dismiss as admin", one row away.
 */
export async function promoteToAdmin(page, selectors, { groupName, apply = false }) {
  const report = { promoted: false, alreadyAdmin: false, reason: '', steps: [] };
  const step = (s) => { report.steps.push(s); };

  const header = await waitForConversation(page, selectors, groupName);
  if (!titlesMatch(header, groupName)) {
    report.reason = `the open chat reads "${header || '(nothing)'}", not "${groupName}" — refusing to touch its members`;
    return report;
  }
  step(`conversation confirmed: ${header}`);

  // Open group info. The header title is the reliable way in; the ⋮ menu differs between builds.
  const infoOpened = await firstVisible(page, selectors.groupInfoOpen || [
    "#main header [role='button'][title]",
    '#main header span[title]',
    '#main header'
  ], { perCandidateMs: 2500 });
  if (!infoOpened) {
    report.reason = 'could not open group info from the conversation header';
    return report;
  }
  await infoOpened.click().catch(() => {});
  await page.waitForTimeout(1500);
  step('group info opened');

  /*
   * The participant list, minus ourselves. "You" is how WhatsApp Web labels the account it is signed
   * in as, and it is always in the list because we created the group.
   */
  const rows = page.locator((selectors.groupParticipantRows || [
    "[data-testid='group-info-participants'] [role='listitem']",
    "section [role='listitem']",
    "[role='listitem']"
  ]).join(', '));
  const total = await rows.count().catch(() => 0);
  const others = [];
  for (let i = 0; i < total; i += 1) {
    const text = ((await rows.nth(i).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!text || /^you\b/i.test(text)) continue;
    others.push({ index: i, text });
  }
  step(`participants found: ${others.length} besides You`);

  if (others.length !== 1) {
    report.reason = others.length === 0
      ? 'no other participant is in this group — nobody to promote'
      : `${others.length} other participants — this is not a freshly seeded group, refusing to guess`;
    return report;
  }

  const member = others[0];
  if (/group admin/i.test(member.text)) {
    report.alreadyAdmin = true;
    report.promoted = true;
    report.reason = `${member.text} is already an admin`;
    return report;
  }

  if (!apply) {
    report.reason = `DRY RUN — would promote "${member.text}" to group admin`;
    return report;
  }

  await rows.nth(member.index).click().catch(() => {});
  await page.waitForTimeout(1000);

  /*
   * Anchored, exact, case-insensitive. WhatsApp words it "Make group admin"; some builds say
   * "Make admin". Both are accepted, and nothing else is — a menu item that merely CONTAINS the word
   * admin includes "Dismiss as admin".
   */
  const item = page.locator("[role='menuitem'], [role='button'], li, div[role='row']")
    .filter({ hasText: /^make (group )?admin$/i }).first();
  if (!(await item.count().catch(() => 0))) {
    report.reason = 'the member menu opened but held no "Make group admin" item';
    return report;
  }
  const label = ((await item.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  assertSafe(label);                       // refuses Remove / Dismiss / Delete / Exit, whatever matched
  await item.click();
  await page.waitForTimeout(1500);
  step(`clicked "${label}"`);

  /*
   * Verified, not assumed. A click that lands on a closing menu does nothing and would otherwise be
   * reported as a promotion, leaving a colleague who still cannot add anybody and a Chat message
   * telling them to.
   */
  const after = ((await rows.nth(member.index).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  report.promoted = /group admin/i.test(after);
  report.reason = report.promoted
    ? `${member.text} is now a group admin`
    : `clicked "${label}" but the row still reads "${after}" — not confirmed`;
  return report;
}

/**
 * Everything visible in the open conversation. Used to spot a note already posted.
 *
 * innerText ALONE is not enough: WhatsApp renders every emoji as an <img>, and innerText skips an
 * image's alt text. A note beginning "🏠 PROPERTY INSPECTION" therefore reads as " PROPERTY
 * INSPECTION" on screen, so a marker containing the emoji could never match — which is how the same
 * note got posted three times, two minutes apart. The alt text is folded in as well so this stays
 * correct even if a marker gains an emoji again later.
 */
async function conversationText(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('#main');
    if (!main) return '';
    const alts = [...main.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt') || '');
    return `${main.innerText || ''}\n${alts.join(' ')}`;
  }).catch(() => '');
}

/**
 * Post ONE message into a group.
 *
 * This is the only place in the project that sends anything, and it is deliberately hard to misuse:
 *
 *   1. It WAITS for the open conversation's header to match the group name it was given, then checks
 *      it. If the header says anything else — a seller's 1:1 chat left open by the warm-up, another
 *      group, nothing at all — it refuses. Typing into whatever happens to be focused and pressing
 *      Enter is how automation messages the wrong person.
 *   2. It refuses if the group already contains the note, so re-running never posts twice.
 *   3. The composer is looked up INSIDE `#main`, so even a stale selector cannot resolve to the
 *      search box or to another panel's text field.
 *   4. It sends once. There is no retry, because a retry that misfires sends twice.
 */
export async function postGroupNote(page, selectors, { groupName, text, apply = false }) {
  const report = { posted: false, alreadyThere: false, reason: '' };

  // --- 1. Is the right conversation actually open? ---
  const header = await waitForConversation(page, selectors, groupName);
  if (!header) {
    report.reason = 'no conversation is open (nothing matched #main header) — refusing to type anywhere';
    return report;
  }
  if (!titlesMatch(header, groupName)) {
    report.reason = `the open conversation is "${header}", not "${groupName}" — refusing to post`;
    return report;
  }

  // --- 2. Is the note already in there? ---
  if (noteAlreadyPresent(await conversationText(page))) {
    report.alreadyThere = true;
    report.posted = true;         // the desired end state holds, which is what the caller records
    report.reason = 'the note is already in this group — not posting a second one';
    return report;
  }

  // --- 3. Find the composer ---
  const composer = await firstVisible(page, selectors.messageBox || [], { perCandidateMs: 6000 });
  if (!composer.locator) {
    report.reason = 'could not find the message box inside the open chat — nothing was posted. ' +
      'Run: node scripts\\whatsapp-doctor.mjs --open "' + groupName + '"';
    return report;
  }

  if (!apply) {
    report.reason = 'dry run — would have posted the note';
    return report;
  }

  // --- 4. Type and send, once ---
  await composer.locator.click();
  /*
   * insertText puts a whole line in with ONE event. keyboard.type sends a key event per character, and
   * WhatsApp does work between them — it fetched a link preview for the REI URL mid-note and the
   * remaining keystrokes landed in the wrong order, producing "Rei Blackbook Liintment:" and
   * "11:00 AMnk:" in a message that went to a real group. A single insert cannot interleave.
   *
   * Shift+Enter for the line breaks, so a multi-line note does not send itself line by line.
   */
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) await page.keyboard.press('Shift+Enter');
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
  // A moment for the link preview to settle before Enter, so it cannot swallow the send.
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  // Read it back. "posted" should mean the message is in the chat, not that keys were pressed.
  const landed = noteAlreadyPresent(await conversationText(page));
  report.posted = landed;
  report.reason = landed ? 'posted' : 'typed it, but the message did not appear in the chat — check the window';
  return report;
}

/** Do these two strings contain the same phone number? Last 10 digits, so formatting cannot lie. */
export function sameDigits(haystack, number) {
  const want = String(number).replace(/\D/g, '').slice(-10);
  if (want.length < 10) return false;
  const found = String(haystack).replace(/\D/g, '');
  return found.includes(want);
}
