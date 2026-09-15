/**
 * List EVERY label/value pair on a REI contact page.
 *
 *   node scripts/rei-fields.mjs "https://my.reiblackbook.com/contacts/20473369"
 *
 * Read-only. Opens the contact, reads it, prints it. Clicks nothing, changes nothing.
 *
 * Why this exists: the scraper only captures the fields it has been told about. Adding new ones
 * (Estimated Value, Equity, Motivation Level, Occupancy, Condition, Known Issues) needs the EXACT
 * label text REI uses, and guessing at ten labels is how the last three rounds of selector work went.
 * This prints what is actually on the page so the mapping is copied, not invented.
 *
 * Send the output back and the labels get wired into config/rei-selectors.json.
 */
import fs from 'node:fs/promises';
import { launchReiContext, assertAuthenticated } from '../src/rei/browser.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
if (!url) {
  console.error('Usage: node scripts/rei-fields.mjs "https://my.reiblackbook.com/contacts/20473369"');
  process.exit(1);
}

const selectors = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
/*
 * THE RUN LOCK, because two Chromiums on one profile is what signs REI out.
 *
 * From the client's own logs/rei-session.log, three OPEN lines on the same profile:
 *
 *   15:07:05  pid 7520    OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   15:13:31  pid 126140  OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   15:45:07  pid 139868  OPEN  ...\browser-data\rei-fresh  reiCookies=0
 *
 * Two processes in the profile at once, and half an hour later the cookie jar is empty. Chromium does not
 * merge concurrent access: whichever instance closes last writes ITS in-memory state over the other's. Both
 * closed cleanly - every CLOSE and EXIT in that log is clean - so nothing looked wrong at the time, and the
 * next run simply arrived logged out.
 *
 * Every SCHEDULED job already took the lock. This script did not, and neither did five of its siblings -
 * all of them hand-run tools, one of which the re-check's own output tells the reader to run. So the way to
 * lose the REI session was to follow the instructions on screen while a sweep happened to be working.
 *
 * It WAITS rather than exiting: this is only ever run by hand, and losing the race to a timer helps nobody.
 */
const releaseRei = await acquireLockWaiting('run', {
  onWait: (left) => console.log(`  REI is busy - waiting, up to ${Math.ceil(left / 60)} more minute(s)`)
});
if (!releaseRei) {
  console.log('REI is still busy after the wait. Nothing was opened; try again in a few minutes.');
  process.exit(1);
}
/* Released on the way out however this ends, so a crash here cannot block every later run. */
process.on('exit', () => { releaseRei(); });

const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await assertAuthenticated(page, selectors.login || {});
await page.waitForSelector("a[href^='tel:'], a[href^='mailto:']", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);   // let the React panels finish painting

/*
 * REI renders each field as a leaf [data-testid="list-item"] whose text is the LABEL glued straight
 * onto the VALUE, with no separator — "Property Address2145 Capitol Ave". Splitting them reliably is
 * impossible from the text alone, so both the raw text and a best-effort split are printed.
 */
const pairs = await page.evaluate(() => {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const items = [...document.querySelectorAll('[data-testid="list-item"]')]
    .filter((el) => !el.querySelector('[data-testid="list-item"]'))    // leaves only
    .map((el) => norm(el.innerText))
    .filter(Boolean);
  return [...new Set(items)];
});

console.log(`\n===== ${pairs.length} FIELD(S) ON THIS CONTACT =====\n`);
for (const text of pairs) {
  // A label is usually Title Case words; the value starts at the first digit, $ or lowercase run.
  const split = text.match(/^([A-Z][A-Za-z()\/ ]{2,40}?)(?=[A-Z0-9$(]|$)(.*)$/);
  if (split && split[2]) {
    console.log(`  ${split[1].trim().padEnd(32)} = ${split[2].trim().slice(0, 90)}`);
  } else {
    console.log(`  ${text.slice(0, 120)}`);
  }
}

/* Long-form text lives outside list-items — notes, descriptions, condition write-ups. */
const blocks = await page.evaluate(() => {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('p, textarea, [class*="note" i], [data-testid*="note" i]')) {
    const t = norm(el.innerText || el.value);
    if (t.length > 60) out.push(t.slice(0, 300));
  }
  return [...new Set(out)].slice(0, 25);
});
if (blocks.length) {
  console.log(`\n===== ${blocks.length} LONGER TEXT BLOCK(S) (notes / descriptions) =====\n`);
  for (const b of blocks) console.log(`  - ${b}\n`);
}

console.log('Nothing was changed. Send this output back to have the fields mapped.');
await context.close();
