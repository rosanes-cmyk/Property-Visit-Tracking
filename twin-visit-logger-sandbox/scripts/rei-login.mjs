import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config } from '../src/config.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';

// Keep the sandbox browser OPEN until the user is logged in. The window must never close on its
// own: navigation errors are caught, and if there is no interactive terminal we simply wait for
// the user to close the browser window (the persistent profile is saved to disk either way).
const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());

try {
  await page.goto(config.reiLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (error) {
  console.warn(`Could not auto-open ${config.reiLoginUrl}: ${error.message}`);
  console.warn('Type your REI BlackBook login URL into the browser address bar manually.');
}

console.log('\n==> Log into REI BlackBook in the opened window and finish MFA.');
console.log('==> When the REI dashboard is fully loaded, press Enter here — OR just close the');
console.log('    browser window — to save the session. The window will NOT close on its own.\n');

function waitForEnter() {
  // No interactive terminal (e.g. launched in a way that gives no TTY): never resolve on Enter,
  // so the race below only ends when the user closes the browser window.
  if (!input.isTTY) return new Promise(() => {});
  const rl = readline.createInterface({ input, output });
  return rl.question('Press Enter after REI is fully logged in...').finally(() => rl.close());
}

await Promise.race([
  waitForEnter(),
  context.waitForEvent('close')
]);

await context.close().catch(() => {});
console.log('REI sandbox profile saved. Do not commit browser-data/.');
