import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config } from '../src/config.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';

/*
 * Logging in takes the same lock as the scrapes.
 *
 * It opens the same persistent Chromium profile, so a manual login landing on top of a scheduled run
 * is exactly the collision that was logging REI out — and it is the likeliest one to happen, because
 * somebody only runs this WHEN the session has already broken.
 *
 * It WAITS for that lock rather than refusing, which is the whole point and was the one place the
 * waiting version never got wired in. On the office PC the scheduled jobs run often enough that a
 * person double-clicking this file loses the race almost every time: the client hit "A scheduled REI
 * run is active" three times in a row, ten minutes apart, with two bookings stuck on the board. Being
 * told to come back later, repeatedly, by the tool whose whole job is to fix the thing that is broken
 * is not a guard — it is a wall. The collision it was protecting against is still prevented; the only
 * change is that we queue instead of giving up.
 *
 * Fifteen minutes because a bucket sweep over forty leads legitimately takes that long, and a person
 * who has just watched two visits sit unprocessed for six hours should not be sent away at minute
 * twelve. The countdown prints, so a wait is never mistaken for a hang.
 */
const releaseLogin = await acquireLockWaiting('run', {
  timeoutMs: 15 * 60 * 1000,
  onWait: (secondsLeft) => {
    console.log(`   A scheduled REI run is using the browser. Waiting for it to finish — ` +
      `${Math.ceil(secondsLeft / 60)} min left before giving up. Leave this window open.`);
  }
});
if (!releaseLogin) {
  console.error('A scheduled REI run has held the browser for 15 minutes, which is longer than any');
  console.error('run should take. Something is stuck. Run scripts\\status.cmd and send what it says.');
  process.exit(1);
}
process.on('exit', () => { releaseLogin(); });

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
  /*
   * timeout: 0 — NO limit, and this was a real bug rather than a precaution.
   *
   * waitForEvent takes Playwright's default timeout, which fired at 45 seconds while the client was still
   * completing MFA. The race then lost to its own clock and the script crashed mid-login with a
   * TimeoutError, in the middle of the one step that inherently takes minutes: read a code off a phone,
   * type it, wait for a dashboard to load. Nothing about logging in belongs on a 45-second budget.
   */
  context.waitForEvent('close', { timeout: 0 })
]).catch((error) => {
  /*
   * Even if the wait fails, say the true thing about the session. Chromium writes a persistent profile to
   * disk CONTINUOUSLY, not on close, so a login completed before the error is already saved — and telling
   * somebody their login was lost when it was not sends them round the loop a second time for nothing.
   */
  console.warn(`\nStopped waiting: ${error.message}`);
  console.warn('If you finished logging in, the session IS saved — the profile is written to disk as you');
  console.warn('go, not at the end. Run the re-check and see; log in again only if it still redirects.');
});

await context.close().catch(() => {});
console.log('REI sandbox profile saved. Do not commit browser-data/.');
