import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { launchReiContext } from '../src/rei/browser.mjs';

const targetUrl = process.argv[2];
if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
  console.error('Usage: npm run inspect:rei -- "https://app.reiblackbook.com/..."');
  process.exit(1);
}

const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

const inspection = await page.evaluate(() => {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const safeAttributes = (element) => {
    const result = {};
    for (const name of ['id', 'class', 'name', 'type', 'role', 'aria-label', 'data-testid', 'data-test']) {
      const value = element.getAttribute(name);
      if (value) result[name] = value;
    }
    return result;
  };

  const elements = [...document.querySelectorAll(
    'label, dt, th, h1, h2, h3, [data-testid], [data-test], input, textarea, select, a[href^="tel:"], a[href^="mailto:"]'
  )].slice(0, 2500);

  return elements.map((element) => ({
    tag: element.tagName.toLowerCase(),
    attributes: safeAttributes(element),
    text: norm(
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? element.value
        : element.textContent
    ).slice(0, 500)
  })).filter((item) => item.text || Object.keys(item.attributes).length);
});

await fs.mkdir(path.resolve('./debug'), { recursive: true });
const stamp = DateTime.now().toFormat('yyyyLLdd-HHmmss');
const base = path.resolve('./debug', `${stamp}-rei-inspection`);
await page.screenshot({ path: `${base}.png`, fullPage: true });
await fs.writeFile(`${base}.html`, await page.content(), 'utf8');
await fs.writeFile(`${base}.json`, JSON.stringify({ url: page.url(), inspection }, null, 2), 'utf8');

console.log(`Inspection saved locally:\n${base}.png\n${base}.html\n${base}.json`);
console.log('Give Claude Code the local JSON/HTML paths and ask it to update config/rei-selectors.json only.');
await context.close();
