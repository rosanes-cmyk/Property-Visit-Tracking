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
import { launchWhatsApp, assertLoggedIn, firstVisible, WHATSAPP_URL } from '../src/whatsapp/client.mjs';
import { config } from '../src/config.mjs';

const selectors = JSON.parse(await fs.readFile(config.whatsappSelectorConfig, 'utf8'));
const context = await launchWhatsApp({
  userDataDir: config.whatsappUserDataDir,
  headless: false,
  timezone: config.calendarTimezone
});
const page = context.pages()[0] || (await context.newPage());

try {
  await assertLoggedIn(page, selectors);
  console.log('Logged in.\n');
} catch (error) {
  console.error(error.message);
  await context.close();
  process.exit(1);
}

// Groups reachable from the main screen without opening anything.
const ONSCREEN = ['chatList', 'searchBox', 'newChatButton'];
// These only exist once the New group flow is open.
const IN_FLOW = ['newGroupButton', 'participantSearch', 'nextButton'];

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
    console.log(`${hit.selector ? 'OK      ' : 'MISSING '} ${key}${hit.selector ? `  ->  ${hit.selector}` : ''}`);
    if (key === 'newGroupButton' && hit.selector) {
      await hit.locator.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
}

// For anything still missing, list what IS on screen so a working selector can be picked by hand.
const missing = Object.keys(results).filter((k) => !results[k]);
if (missing.length) {
  console.log(`\n${missing.length} selector(s) not found: ${missing.join(', ')}`);
  console.log('Candidates visible on screen right now:\n');
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

console.log('\nPaste any corrected selectors into config/whatsapp-selectors.json and re-run.');
console.log('Nothing was created or sent.');
await context.close();
