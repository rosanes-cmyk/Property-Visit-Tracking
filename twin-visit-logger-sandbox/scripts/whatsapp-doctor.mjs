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
import {
  launchWhatsApp, firstVisible, WHATSAPP_URL, openGroupByName, readConversationTitle
} from '../src/whatsapp/client.mjs';
import { titlesMatch } from '../src/whatsapp/post-gate.mjs';
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

/*
 * The URL is checked BEFORE the QR, because a logged-out page does not always show one.
 *
 * This tool reported "Looks logged in (no QR on screen)" on a page whose address was
 * `web.whatsapp.com/?post_logout=1&logout_reason=0` — WhatsApp's own words for "this session has been
 * ended". The three missing selectors underneath followed from exactly that: no chat list because there was
 * no session. Read together it looked like a selector problem on a working login, and the honest reading was
 * the opposite and far more serious — the account had terminated an automated session within minutes, on a
 * number that had already been restricted once.
 *
 * A diagnostic that reports the wrong state is worse than no diagnostic: it sends somebody to fix selectors
 * while the real answer is to stop.
 */
var loggedOut = /post_logout=1|logout_reason=/i.test(String(state.url || ''));
if (loggedOut) {
  console.log('LOGGED OUT — the page address says so: post_logout=1.');
  console.log('  WhatsApp ENDED this session. That is not a selector problem and not something to retry');
  console.log('  blindly: on a number that has been restricted before, a session terminated shortly after');
  console.log('  linking is the same pattern that lost the previous three.');
  console.log('\n  Check your phone: WhatsApp > Settings > Linked devices. If the device is not listed,');
  console.log('  WhatsApp removed it rather than you.');
  console.log('\n  Before linking again, be sure you want to: set WHATSAPP_ENABLED=false to stop the');
  console.log('  scheduled runs trying. The visit briefing reaches Google Chat either way.\n');
} else if (state.qrCanvas || state.mentionsLinkDevice) {
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
/*
 * The editable field in the participant picker has no testid, aria-label or title, so it never
 * appears in the listing above — which is exactly why the first two rounds of guesses missed it.
 * Dump the container's markup so it can be identified from real HTML instead of guessed at again.
 */
const inputAreaHtml = await page.evaluate(() => {
  const box = document.querySelector("[data-testid='new-group-drawer-participants'] [data-testid='inputarea']")
    || document.querySelector("[data-testid='inputarea']");
  if (!box) return null;
  return box.outerHTML.replace(/\s+/g, ' ').slice(0, 900);
});
if (inputAreaHtml) {
  console.log('\n=== Inside the participant input container ===');
  console.log(inputAreaHtml);
  console.log('\n(The client clicks this container and types with the keyboard, so it does not need');
  console.log('a selector for the inner element. This is here only for diagnosis.)');
}

/*
 * The conversation header and the message box only exist while a chat is OPEN, so they cannot be
 * checked from the main screen — which is why they stayed unconfirmed while every other selector was
 * verified, and why the first note-posting run had nothing to type into.
 *
 * Opening a chat is a visible act (it marks the chat read), so it happens only when asked for:
 *
 *   node scripts/whatsapp-doctor.mjs --open "1390 Estudillo Ave, San Leandro, CA 94577"
 *
 * It opens, reads, and reports. It does not type and it does not send.
 */
const openIndex = process.argv.indexOf('--open');
const openName = openIndex >= 0 ? process.argv[openIndex + 1] : '';

if (!openName) {
  console.log('\nconversationTitle / messageBox were NOT checked — they only exist while a chat is open.');
  console.log('To check them against a group you already have:');
  console.log('  node scripts\\whatsapp-doctor.mjs --open "Full Group Name"');
} else {
  console.log(`\n=== Opening "${openName}" to check the posting selectors (read-only) ===`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const opened = await openGroupByName(page, selectors, openName);
  console.log(opened.opened ? `OK       opened it — header reads "${opened.header}"` : `FAILED   ${opened.reason}`);

  if (opened.opened) {
    for (const key of ['conversationTitle', 'messageBox']) {
      const hit = await firstVisible(page, selectors[key] || [], { perCandidateMs: 4000 });
      console.log(`${hit.selector ? 'OK      ' : 'MISSING '} ${key}${hit.selector ? `  ->  ${hit.selector}` : ''}`);
    }
    const title = await readConversationTitle(page, selectors);
    console.log(`\nTitle read back: "${title}"`);
    console.log(`Matches the name you asked for: ${titlesMatch(title, openName) ? 'YES' : 'NO'}`);

    // If the composer was not found, dump the footer so a real selector can be read off actual markup
    // instead of guessed at for a third time.
    const footerHtml = await page.evaluate(() => {
      const footer = document.querySelector('#main footer');
      return footer ? footer.outerHTML.replace(/\s+/g, ' ').slice(0, 1200) : null;
    }).catch(() => null);
    if (footerHtml) {
      console.log('\n=== #main footer markup (the composer lives in here) ===');
      console.log(footerHtml);
    } else {
      console.log('\nNo #main footer on the page — either no chat is open, or this build has moved it.');
    }
  }
}

console.log('\nNothing was created, typed or sent.');
await context.close();
