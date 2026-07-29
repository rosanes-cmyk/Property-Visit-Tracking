import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from '../config.mjs';

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
  return context;
}

export async function assertAuthenticated(page, loginConfig) {
  const currentUrl = page.url().toLowerCase();
  if ((loginConfig.urlFragments || []).some((fragment) => currentUrl.includes(String(fragment).toLowerCase()))) {
    throw new ReiSessionExpiredError(`REI redirected to a login page: ${page.url()}`);
  }
  for (const selector of loginConfig.passwordSelectors || []) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) {
      throw new ReiSessionExpiredError('REI login form is visible. Run npm run login:rei.');
    }
  }
}
