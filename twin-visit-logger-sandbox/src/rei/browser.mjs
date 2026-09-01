import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.mjs';
import { noteReiSessionOpen, noteReiAuthResult } from './session-log.mjs';

export class ReiSessionExpiredError extends Error {
  constructor(message = 'REI BlackBook session is not authenticated.') {
    super(message);
    this.name = 'ReiSessionExpiredError';
    this.retryable = true;
  }
}

export async function launchReiContext({ headless = config.reiHeadless } = {}) {
  await fs.mkdir(config.reiUserDataDir, { recursive: true });
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
  await noteReiSessionOpen(context, config.reiUserDataDir);
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
