/**
 * Check which WhatsApp Web selectors actually work on YOUR build.
 *
 *   node scripts/whatsapp-doctor.mjs
 *
 * WhatsApp Web's markup is obfuscated and changes often, so the selectors shipped in
 * config/whatsapp-selectors.json are candidates, not facts. This opens your logged-in session,
 * tries each one, and prints which resolved — plus what it can discover on its own for the ones
 * that did not.
 *
 * Read-only. It opens menus and closes them with Escape. It creates nothing and sends nothing.
 */
import fs from 'node:fs/promises';
import { launchWhatsApp, firstVisible, WHATSAPP_URL } from '../src/whatsapp/client.mjs';
import { config } from '../src/config.mjs';

const selectors = JSON.parse(await fs.readFile(config.whatsappSelectorConfig, 'utf8'));
const context = await launchWhatsApp({
  userDataDir: config.whatsappUserDataDir,
  headless: false,
  timezone: config.calendarTimezone
});
const page = context.pages()[0] || (await context.newPage());

/*
 * Deliberately does NOT abort on a failed login check. Telling the user "the chat list was not
 * found" and quitting is useless: that message cannot distinguish "you are not logged in" from
 * "the shipped selectors are wrong", and distinguishing those two is the entire job of this script.
 * So it reports the page state either way and keeps going.
 */
await page.goto(WHATSAPP_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(4000);   // WhatsApp Web paints its shell before the chat list arrives

const state = await page.evaluate(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const qr = [...document.querySelectorAll('canvas')].filter(visible).length > 0;
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
  return {
    url: location.href,
    title: document.title,
    qrCanvas: qr,
    mentionsLinkDevice: /link(ing)? (a )?device|scan the QR|Steps to log in/i.test(text),
    firstText: text.slice(0, 220)
  };
});

console.log(`URL:   ${state.url}`);
console.log(`Title: ${state.title}\n`);

if (state.qrCanvas || state.mentionsLinkDevice) {
  console.log('NOT LOGGED IN — WhatsApp Web is still showing the QR / link-device screen.');
  console.log('  Run:  node scripts\\whatsapp-login.mjs');
  console.log('  Scan the code, WAIT until your real chats appear in the window, and only then');
  console.log('  press Enter. Pressing Enter before the chats load saves an empty session.\n');
} else {
  console.log('Looks logged in (no QR on screen). Checking selectors...\n');
}
console.log(`Page starts with: "${state.firstText}"\n`);

// Groups reachable from the main screen without opening anything.
const ONSCREEN = ['chatList', 'searchBox', 'newChatButton'];
// These only exist once the New group flow is open.
const IN_FLOW = ['newGroupButton', 'participantSearch', 'nextButton'];
/*
 * Two controls cannot be checked here and their absence is NOT a fault: WhatsApp only renders the
 * Next arrow and the create/confirm button once a participant has been selected, and selecting one
 * would mean touching a real contact. Reporting them as MISSING sent the last run chasing a
 * non-problem, so they are labelled instead.
 */
const ONLY_AFTER_SELECTING = new Set(['nextButton', 'createGroupButton']);

const results = {};
for (const key of ONSCREEN) {
  const hit = await firstVisible(page, selectors[key] || []);
  results[key] = hit.selector;
  console.log(`${hit.selector ? 'OK      ' : 'MISSING '} ${key}${hit.selector ? `  ->  ${hit.selector}` : ''}`);
}

if (results.newChatButton) {
  await page.locator(results.newChatButton).first().click().catch(() => {});
  await page.waitForTimeout(800);
  for (const key of IN_FLOW) {
    const hit = await firstVisible(page, selectors[key] || []);
    results[key] = hit.selector;
    const label = hit.selector ? 'OK      ' : (ONLY_AFTER_SELECTING.has(key) ? 'n/a here' : 'MISSING ');
    console.log(`${label} ${key}${hit.selector ? `  ->  ${hit.selector}` : ''}` +
      (!hit.selector && ONLY_AFTER_SELECTING.has(key)
        ? '   (only appears after a participant is picked — not a fault)' : ''));
    if (key === 'newGroupButton' && hit.selector) {
      await hit.locator.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
}

// For anything still missing, list what IS on screen so a working selector can be picked by hand.
const missing = Object.keys(results).filter((k) => !results[k] && !ONLY_AFTER_SELECTING.has(k));
if (missing.length) {
  console.log(`\n${missing.length} selector(s) not found: ${missing.join(', ')}`);
  console.log('Everything identifiable that IS on screen right now — paste this back and the');
  console.log('selectors can be corrected from it:\n');
  const found = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid],[aria-label],[data-icon],[title]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const attr = ['data-testid', 'aria-label', 'data-icon', 'title'].find((a) => el.getAttribute(a));
      if (!attr) continue;
      out.push({
        selector: `[${attr}='${el.getAttribute(attr)}']`,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50)
      });
    }
    return out.slice(0, 60);
  });
  for (const f of found) console.log(`  ${f.selector}${f.text ? `   "${f.text}"` : ''}`);
}

await page.keyboard.press('Escape').catch(() => {});
await page.keyboard.press('Escape').catch(() => {});

if (!missing.length) {
  console.log('\nEvery selector that can be checked at this stage resolved.');
  console.log('The Next arrow and the create button are only reachable mid-flow, so they are');
  console.log('exercised for real on the first run with --yes.');
}
console.log('\nNothing was created or sent.');
await context.close();
