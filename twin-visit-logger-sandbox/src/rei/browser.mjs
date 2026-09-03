import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.mjs';
import { noteReiSessionOpen, noteReiAuthResult, readLastChromiumExit } from './session-log.mjs';
import { onShutdown } from '../utils/shutdown.mjs';

export class ReiSessionExpiredError extends Error {
  constructor(message = 'REI BlackBook session is not authenticated.') {
    super(message);
    this.name = 'ReiSessionExpiredError';
    this.retryable = true;
  }
}

export async function launchReiContext({ headless = config.reiHeadless } = {}) {
  await fs.mkdir(config.reiUserDataDir, { recursive: true });
  /*
   * Read BEFORE the launch, or it describes this run instead of the last one — Chromium stamps
   * exit_type="Crashed" as it starts and only rewrites it to "Normal" on a clean shutdown. See
   * readLastChromiumExit.
   */
  const lastExit = readLastChromiumExit(config.reiUserDataDir);
  const context = await chromium.launchPersistentContext(config.reiUserDataDir, {
    headless,
    timezoneId: config.calendarTimezone,
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: false
  });
  context.setDefaultTimeout(config.reiPageTimeoutMs);
  /*
   * Write down what the profile actually held when it opened, and whether this run closes cleanly.
   *
   * REI signs this machine out roughly daily and an evening of theorising produced nothing: a brand-new
   * profile lost the session as fast as the old one, and the account is not shared. The one hard clue was
   * Chromium reporting it "didn't shut down correctly", which is exactly the sort of thing that should be
   * recorded rather than remembered. See session-log.mjs for how to read the result.
   *
   * Awaited, but it cannot throw — a diagnostic must not be able to fail the run it is describing.
   */
  await noteReiSessionOpen(context, config.reiUserDataDir, lastExit);
  /*
   * AN INTERRUPTED RUN NOW CLOSES CHROMIUM INSTEAD OF LEAVING IT TO BE KILLED. This is the fix for REI
   * signing this machine out several times a day.
   *
   * Chromium keeps cookies in memory and writes them to the profile's `Cookies` database on a lazy timer
   * and, in full, on a graceful shutdown. A killed browser never does that last part, so the REI session
   * cookie on disk reverts to a value REI has already rotated past — and the next run lands on the login
   * page. Nothing errors; the sweep simply reads 0 of 20 leads with 20 login redirects.
   *
   * Order 10, ahead of the lock's 90: the browser must finish closing before the lock is released, or the
   * next run can open the same profile while this one is still writing to it.
   *
   * Deregistered when the context closes, so the normal path — every script closes its context in a
   * `finally` — does not leave a stale closer behind, and Ctrl+C after a clean close does nothing.
   */
  const drop = onShutdown(() => context.close().catch(() => {}),
    { order: 10, label: 'close the REI browser' });
  try { context.on('close', drop); } catch { /* older Playwright: the closer is harmless either way */ }
  return context;
}

export async function assertAuthenticated(page, loginConfig) {
  const currentUrl = page.url().toLowerCase();
  if ((loginConfig.urlFragments || []).some((fragment) => currentUrl.includes(String(fragment).toLowerCase()))) {
    // Recorded before throwing: a run that opened WITH cookies and still landed here means REI ended the
    // session at its end, which wants a different fix from cookies never being written to disk.
    noteReiAuthResult(false, page.url());
    throw new ReiSessionExpiredError(`REI redirected to a login page: ${page.url()}`);
  }
  for (const selector of loginConfig.passwordSelectors || []) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) {
      noteReiAuthResult(false, 'login form visible');
      throw new ReiSessionExpiredError('REI login form is visible. Run npm run login:rei.');
    }
  }
  noteReiAuthResult(true);
}
