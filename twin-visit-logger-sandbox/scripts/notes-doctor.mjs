/**
 * What REI's Notes TAB actually looks like to the scraper.
 *
 *   node scripts/notes-doctor.mjs "https://my.reiblackbook.com/contacts/20284479"
 *
 * Why this exists rather than another guess: the Notes-tab reader shipped, the scraper called it, and it
 * returned nothing — for all three contacts, silently, because the reader only logged when it found
 * something. The parser is built from screenshots, and a screenshot does not tell you where the page puts
 * its line breaks. "Note by Theavil Marie" may reach innerText as one line or as two, and the boundary the
 * parser looks for depends on which.
 *
 * So this prints the raw text and what the parser made of it, side by side. One run answers it.
 *
 * READ ONLY. It opens the contact, clicks the Notes tab, clicks safe "Show More" expanders, and reads. It
 * writes nothing to REI and nothing to the sheet. The note text goes to debug/ (gitignored) because it
 * holds seller names, addresses and phone numbers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchReiContext, assertAuthenticated } from '../src/rei/browser.mjs';
import { openPanel } from '../src/rei/tasks.mjs';
import { expandTruncatedText } from '../src/rei/expand.mjs';
import { parseNotesPanel } from '../src/rei/notes-tab.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
const LINES = (() => {
  const i = process.argv.indexOf('--lines');
  const n = i >= 0 ? Number.parseInt(process.argv[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(n) ? n : 60;
})();

if (!url) {
  console.log('Give me a REI contact URL:');
  console.log('  node scripts/notes-doctor.mjs "https://my.reiblackbook.com/contacts/20284479"');
  process.exit(1);
}

/* Always waits: this is only ever run by hand, and losing the race to a scheduled run helps nobody. */
const release = await acquireLockWaiting('run', {
  onWait: (left) => console.log(`  REI is busy — retrying, up to ${Math.ceil(left / 60)} more minute(s)`)
});
if (!release) {
  console.log('REI is still busy after the wait. Check data\\run.lock and try again.');
  process.exit(1);
}

try {
  const context = await launchReiContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.reiPageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: config.reiPageTimeoutMs }).catch(() => {});
  await page.waitForTimeout(2500);
  await assertAuthenticated(page, {});

  const before = (await page.locator('body').innerText().catch(() => '')).length;
  console.log(`\nContact page text: ${before} characters\n`);

  console.log('--- opening the Notes tab ---');
  const opened = await openPanel(page, ['Notes']);
  console.log(`  ${opened.opened ? opened.how : 'NOT OPENED: ' + opened.how}`);
  if (!opened.opened) {
    console.log('\n  That is the whole problem: nothing clicked the tab. Everything below is the About page.');
  }

  const expanded = await expandTruncatedText(page);
  console.log(`  expanders clicked: ${expanded.clicked}${expanded.capped ? ' (hit the cap)' : ''}`);

  const body = await page.locator('body').innerText().catch(() => '');
  console.log(`  page text now: ${body.length} characters\n`);

  /*
   * The two questions, in order. If the boundary count is 0 the parser never starts, and the raw lines below
   * show what the header really looks like.
   */
  const lines = body.split('\n').map((l) => l.trim());
  const heads = lines.filter((l) => /^Note(\s+updated)?\s+by\b/i.test(l)).length;
  const bareNote = lines.filter((l) => /^Note$/i.test(l)).length;
  const stamps = lines.filter((l) => /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{4},\s*\d{1,2}:\d{2}\s*(AM|PM)$/i.test(l)).length;
  console.log('--- what the parser looks for ---');
  console.log(`  lines matching "Note by X" / "Note updated by X" : ${heads}`);
  console.log(`  lines that are just "Note" (header split in two)  : ${bareNote}`);
  console.log(`  lines matching "Aug 06 2026, 4:37 PM"             : ${stamps}`);

  const parsed = parseNotesPanel(body);
  console.log(`\n--- the parser found ${parsed.length} note(s) ---`);
  parsed.slice(0, 5).forEach((n, i) => {
    console.log(`  ${i + 1}. [${n.at || 'no date'}] by ${n.author}`);
    console.log(`     ${n.body.slice(0, 160)}${n.body.length > 160 ? '…' : ''}`);
  });

  console.log(`\n--- the first ${LINES} non-empty lines of the page, exactly as read ---`);
  lines.filter(Boolean).slice(0, LINES).forEach((l, i) => {
    console.log(`  ${String(i + 1).padStart(3)} | ${l.slice(0, 150)}`);
  });

  const dir = path.resolve('./debug');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `notes-tab-${(url.match(/contacts\/(\d+)/) || [])[1] || 'page'}.txt`);
  await fs.writeFile(file, body, 'utf8');
  console.log(`\nFull page text written to ${file}`);
  console.log('That file holds seller details — it is gitignored. Send me the printout above, not the file.');

  if (process.argv.includes('--keepopen')) {
    console.log('\n--keepopen: leaving the browser up. Close it yourself when done.');
  } else {
    await context.close();
  }
} finally {
  await release();
}
