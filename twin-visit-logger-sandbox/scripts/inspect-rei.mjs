import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { launchReiContext } from '../src/rei/browser.mjs';

const targetUrl = process.argv[2];
if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
  console.error('Usage: npm run inspect:rei -- "https://my.reiblackbook.com/contacts/..."');
  process.exit(1);
}

const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());

// REI BlackBook is a heavy single-page app: the shell renders instantly but the real fields stream
// in afterwards. Wait for the network to settle AND for a real contact value (a tel:/mailto: link)
// to appear, so we snapshot the loaded page instead of the skeleton loaders.
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page
  .waitForSelector('a[href^="tel:"], a[href^="mailto:"]', { timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(4000); // let remaining React panels paint

const inspection = await page.evaluate(() => {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const safeAttributes = (element) => {
    const result = {};
    for (const name of ['id', 'name', 'type', 'role', 'aria-label', 'data-testid', 'data-test', 'href']) {
      const value = element.getAttribute(name);
      if (value) result[name] = name === 'href' ? value.slice(0, 120) : value;
    }
    const className = typeof element.className === 'string' ? element.className : '';
    if (className) result.class = className.slice(0, 120);
    return result;
  };

  // Own text = the element's direct text, excluding descendants — best signal for a value node.
  const ownText = (element) => {
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return norm(text);
  };

  const selector = [
    'label', 'dt', 'dd', 'th', 'td',
    'h1', 'h2', 'h3', 'h4',
    '[data-testid]', '[data-test]', '[aria-label]',
    'a[href^="tel:"]', 'a[href^="mailto:"]',
    'input', 'textarea', 'select',
    "[class*='label']", "[class*='value']", "[class*='field']",
    "[class*='name']", "[class*='address']", "[class*='phone']",
    "[class*='email']", "[class*='stage']", "[class*='source']",
    "[class*='status']", "[class*='task']", "[class*='note']",
    "[class*='activity']", "[class*='detail']"
  ].join(', ');

  const elements = [...document.querySelectorAll(selector)].slice(0, 4000);

  const items = elements.map((element) => {
    const isFormField =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement;
    return {
      tag: element.tagName.toLowerCase(),
      attributes: safeAttributes(element),
      own: isFormField ? norm(element.value) : ownText(element),
      text: norm(isFormField ? element.value : element.textContent).slice(0, 300)
    };
  }).filter((item) => item.text || item.own || Object.keys(item.attributes).length > 1);

  return {
    title: document.title,
    bodyText: norm(document.body?.innerText || '').slice(0, 20000),
    elementCount: elements.length,
    items
  };
});

await fs.mkdir(path.resolve('./debug'), { recursive: true });
const stamp = DateTime.now().toFormat('yyyyLLdd-HHmmss');
const base = path.resolve('./debug', `${stamp}-rei-inspection`);
await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
await fs.writeFile(`${base}.html`, await page.content().catch(() => ''), 'utf8');
await fs.writeFile(`${base}.json`, JSON.stringify({ url: page.url(), ...inspection }, null, 2), 'utf8');

console.log(`Inspection saved locally:\n${base}.png\n${base}.html\n${base}.json`);
console.log(`Captured ${inspection.items.length} element(s). If this is still near zero, the page`);
console.log('was not logged in or not loaded — check the browser window, then re-run.');
console.log('Send Claude Code the JSON file to map config/rei-selectors.json.');
await context.close();
