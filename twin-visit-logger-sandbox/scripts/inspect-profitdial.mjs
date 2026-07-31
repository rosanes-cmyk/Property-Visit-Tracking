/**
 * Find and verify the ProfitDial "from number" picker on the live REI page.
 *
 * This is the alternative to `npx playwright codegen` — it opens the page in your existing logged-in
 * sandbox profile, hunts for the widget, and prints paste-ready selectors plus which of the current
 * candidates in config/rei-selectors.json actually resolved.
 *
 *   node scripts/inspect-profitdial.mjs "https://my.reiblackbook.com/contacts/123456"
 *   node scripts/inspect-profitdial.mjs "URL" --number "(510) 916-3995"
 *   node scripts/inspect-profitdial.mjs "URL" --set        <- ACTUALLY selects the number
 *
 * Without --set this changes nothing: it opens the dropdown to read the options and closes it again.
 * It never touches a call, text, or send control.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { launchReiContext, assertAuthenticated } from '../src/rei/browser.mjs';
import {
  loadChatSelectors,
  discoverFromNumberCandidates,
  verifyFromNumber,
  selectFromNumber
} from '../src/rei/profitdial.mjs';
import { config } from '../src/config.mjs';

const args = process.argv.slice(2);
const targetUrl = args.find((a) => /^https?:\/\//i.test(a));
const APPLY = args.includes('--set');
const numberFlag = args.indexOf('--number');
const wantedArg = numberFlag >= 0 ? args[numberFlag + 1] : '';

if (!targetUrl) {
  console.error('Usage: node scripts/inspect-profitdial.mjs "https://my.reiblackbook.com/contacts/123456" [--number "(510) 916-3995"] [--set]');
  process.exit(1);
}

const selectorConfig = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
const chat = await loadChatSelectors(config.reiSelectorConfig);
const wanted = wantedArg || chat.expectedFromNumber;
if (!wanted) {
  console.error('No target number. Set chat.expectedFromNumber in config/rei-selectors.json or pass --number.');
  process.exit(1);
}

const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());

await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await assertAuthenticated(page, selectorConfig.login || {});
await page.waitForSelector('a[href^="tel:"], a[href^="mailto:"]', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3000);

console.log(`\nTarget number: ${wanted}`);
console.log(`Mode: ${APPLY ? 'SET (will change the selected number)' : 'READ-ONLY (nothing will be changed)'}\n`);

/* ---------- 1. What the configured candidates resolve to ---------- */
const result = APPLY
  ? await selectFromNumber(page, chat, wanted, { apply: true })
  : await verifyFromNumber(page, chat, wanted);

const label = (key) => (result.resolved[key] ? `CONFIRMED  ${key}: ${result.resolved[key]}` : `NOT FOUND  ${key}`);
console.log('=== Configured candidates ===');
console.log(label('profitDialSelect'));
console.log(label('profitDialOptions'));
console.log(label('profitDialSelectedValue'));

console.log('\n=== Result ===');
console.log(`currently shown : ${result.shown || '(nothing readable)'}`);
console.log(`digit match     : ${result.matches ? 'YES' : 'NO'}`);
if (result.options.length) {
  console.log('offered numbers :');
  for (const option of result.options) console.log(`  - ${option}`);
} else {
  console.log('offered numbers : (none read — the dropdown did not open, or the option selector is wrong)');
}
if (APPLY) console.log(`change          : ${result.changed ? 'APPLIED' : 'not applied'} — ${result.reason}`);

/* ---------- 2. Independent discovery, so a wrong guess is not a dead end ---------- */
const candidates = await discoverFromNumberCandidates(page);
console.log(`\n=== Discovered ${candidates.length} candidate element(s) on this page ===`);
if (!candidates.length) {
  console.log('None. The ProfitDial widget is probably not open on this page — open the chat/text panel');
  console.log('in the browser window that just launched, then re-run this script.');
}
for (const candidate of candidates.slice(0, 40)) {
  const flags = [candidate.showsPhone ? 'shows-phone' : '', candidate.visible ? '' : 'hidden']
    .filter(Boolean)
    .join(' ');
  console.log(`  ${candidate.selector}`);
  console.log(`      tag=${candidate.tag} role=${candidate.role || '-'} testid=${candidate.testId || '-'} ${flags}`);
  if (candidate.text) console.log(`      text: ${candidate.text}`);
}

/* ---------- 3. Save the evidence ---------- */
await fs.mkdir(path.resolve('./debug'), { recursive: true });
const base = path.resolve('./debug', `${DateTime.now().toFormat('yyyyLLdd-HHmmss')}-profitdial`);
await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
await fs.writeFile(`${base}.json`, JSON.stringify({ url: page.url(), wanted, result, candidates }, null, 2), 'utf8');

console.log(`\nSaved: ${base}.json and ${base}.png`);
console.log('These files can contain seller information — keep them local, do not upload them publicly.');
console.log('\nNext: copy any CONFIRMED / discovered selector above into the "chat" block of');
console.log('config/rei-selectors.json, replacing the guesses, then re-run to see all three CONFIRMED.');

await context.close();
