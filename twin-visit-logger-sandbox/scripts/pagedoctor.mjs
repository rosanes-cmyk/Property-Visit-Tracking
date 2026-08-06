/**
 * Find out what a REI contact page really offers — every label worth clicking, and how much of a note
 * the scraper can actually see.
 *
 *   node scripts/pagedoctor.mjs "https://my.reiblackbook.com/contacts/20487447"
 *
 * Two questions have each cost this project several rounds of guessing, and both are answered here:
 *
 *  1. What is REI's "Show More" actually called? Rob Walker's gift reached the sheet with the basket's name
 *     and its order number and without the price, order date or delivery date — all three further down the
 *     same note. Expanding clamped text produced no click at all, which means the control is not worded like
 *     any of the phrases the expander allows.
 *
 *  2. What is the Tasks tab actually called? Three contacts, three failures to open it, which is why the
 *     automation still cannot say whether a visit happened.
 *
 * READ-ONLY by default: it lists labels and reports, and clicks nothing. Pass --expand to let it run the
 * same allowlisted expander the scraper uses, so the before/after note length shows whether it worked.
 *
 * The note text is written to debug/ (gitignored) because it contains seller names, addresses and phone
 * numbers. Nothing here is written to the sheet, the calendar, or REI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchReiContext, assertAuthenticated } from '../src/rei/browser.mjs';
import { expandTruncatedText, isSafeExpander } from '../src/rei/expand.mjs';
import { giftFromNotes } from '../src/rei/gift.mjs';
import { acquireLock } from '../src/utils/lock.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
const DO_EXPAND = process.argv.includes('--expand');
if (!url) {
  console.error('Usage: node scripts/pagedoctor.mjs "https://my.reiblackbook.com/contacts/20487447" [--expand]');
  process.exit(1);
}

/*
 * The same lock every other REI entry point takes. Two Chromium processes on one persistent profile corrupt
 * it, which is what was silently logging this account out of REI.
 */
const release = await acquireLock();
if (!release) {
  console.log('Another REI run is active — skipped, to avoid two browsers on one profile.');
  console.log('Pause the timers first:  schtasks /Change /TN "Twin Visit Logger REI Recheck" /DISABLE');
  process.exit(0);
}

try {
  const selectors = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
  const context = await launchReiContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await assertAuthenticated(page, selectors.login || {});
  await page.waitForTimeout(3000);

  const bodyText = async () => (await page.locator('body').innerText().catch(() => '')) || '';

  /*
   * Every short label on the page, and the verdict the expander gives it.
   *
   * Short, because a disclosure toggle and a tab are both a couple of words. The verdict column is the point:
   * it shows at a glance whether anything at all would be clicked, and if the real control is sitting in this
   * list marked "no", its exact wording is now known.
   */
  console.log('=== Every short clickable label on this page ===');
  console.log('    (WOULD CLICK = the expander accepts it; everything else is left alone)\n');
  const labels = await page.$$eval(
    'button, a, span[role="button"], div[role="button"], [role="tab"], summary',
    (els) => [...new Set(els.map((el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ').trim()).filter((t) => t && t.length <= 40))]
  );
  let clickable = 0;
  for (const label of labels.sort()) {
    const safe = isSafeExpander(label);
    if (safe) clickable += 1;
    console.log(`  ${safe ? 'WOULD CLICK ' : '            '}"${label}"`);
  }
  console.log(`\n  ${labels.length} distinct label(s); ${clickable} the expander would click.`);
  if (!clickable) {
    console.log('  NONE. If a "Show more"-style control is visible in the browser window, its wording is');
    console.log('  in the list above under a different name — tell me which line it is.');
  }

  /*
   * Anything the page has CLAMPED with CSS rather than truncated in the text.
   *
   * A clamped element holds its full text in the DOM and only looks cut off, so innerText already has
   * everything and no click is needed. A truncated one does not. The two look identical on screen and need
   * opposite fixes, so this distinguishes them before any more guessing happens.
   */
  console.log('\n=== Text that is CUT OFF ON SCREEN but complete in the DOM ===');
  const clamped = await page.$$eval('*', (els) => els
    .filter((el) => {
      const s = getComputedStyle(el);
      return (s.webkitLineClamp && s.webkitLineClamp !== 'none')
        || (s.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 8 && (el.innerText || '').length > 120);
    })
    .slice(0, 10)
    .map((el) => ({ tag: el.tagName.toLowerCase(), chars: (el.innerText || '').length, shown: el.clientHeight, real: el.scrollHeight })));
  if (!clamped.length) console.log('  none — nothing on the page is merely visually clipped.');
  for (const c of clamped) {
    console.log(`  <${c.tag}> ${c.chars} chars, showing ${c.shown}px of ${c.real}px`);
  }
  if (clamped.length) {
    console.log('  These already yield their FULL text to the scraper. No click is needed for them.');
  }

  /*
   * innerText against textContent — the cheapest possible answer, tried before any click.
   *
   * The scraper reads innerText, which is what is RENDERED. If REI keeps the rest of a long note in the DOM
   * but hidden until "Show More" is pressed, textContent already holds it and no click is needed at all: the
   * fix is one line in the scraper rather than a clicking policy. If both are the same length, the hidden
   * half genuinely is not on the page and it has to be fetched by clicking.
   */
  console.log('\n=== Is the rest of the note already in the page, just hidden? ===');
  const inner = (await page.locator('body').innerText().catch(() => '')) || '';
  const content = (await page.locator('body').textContent().catch(() => '')) || '';
  console.log(`  innerText  (what the scraper reads): ${inner.length} chars`);
  console.log(`  textContent (including hidden text): ${content.length} chars`);
  const hiddenGift = giftFromNotes(content);
  console.log(`  a delivery date in the hidden text: ${hiddenGift.sentDate || 'no'}`);
  if (content.length > inner.length * 1.15 || (hiddenGift.sentDate && !giftFromNotes(inner).sentDate)) {
    console.log('  YES — the missing text is already in the DOM. No clicking required; the scraper should');
    console.log('  read textContent as well as innerText. Tell me this line appeared.');
  } else {
    console.log('  No — the hidden half is not in the page, so it has to be revealed by clicking.');
  }

  /* What the gift parser makes of the page as it stands, before anything is clicked. */
  const before = await bodyText();
  const giftBefore = giftFromNotes(before);
  console.log('\n=== What the gift parser sees right now ===');
  console.log(`  page text: ${before.length} chars`);
  console.log(`  status:       ${giftBefore.status || '(no gift found)'}`);
  console.log(`  sent date:    ${giftBefore.sentDate || 'MISSING'}`);
  console.log(`  reason:       ${giftBefore.reason || 'MISSING'}`);

  if (DO_EXPAND) {
    console.log('\n=== Running the expander ===');
    const result = await expandTruncatedText(page);
    console.log(`  clicked ${result.clicked}, skipped ${result.skipped}${result.capped ? ', hit the cap' : ''}`);
    const after = await bodyText();
    const giftAfter = giftFromNotes(after);
    console.log(`  page text: ${before.length} -> ${after.length} chars (${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length})`);
    console.log(`  sent date:    ${giftBefore.sentDate || 'MISSING'} -> ${giftAfter.sentDate || 'MISSING'}`);
    console.log(`  reason:       ${giftAfter.reason || 'MISSING'}`);
    if (after.length === before.length) {
      console.log('  No change. Either nothing was expandable, or the control is worded differently.');
    }
  } else {
    console.log('\n  Re-run with --expand to let it click and show the before/after.');
  }

  /*
   * The page text, saved so the exact wording can be read rather than guessed at.
   *
   * debug/ is gitignored: this file holds the seller's name, address and phone number and must not be
   * committed or pasted anywhere public.
   */
  const id = (url.match(/(\d+)\s*$/) || [])[1] || 'page';
  const out = path.resolve(`./debug/${id}-page-text.txt`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, await bodyText(), 'utf8');
  console.log(`\nFull page text saved to ${out}`);
  console.log('It contains seller contact details — read it locally, do not post it anywhere public.');
  console.log('\nThe browser is left open on purpose. Close it when you are done looking.');
} finally {
  await release();
}
