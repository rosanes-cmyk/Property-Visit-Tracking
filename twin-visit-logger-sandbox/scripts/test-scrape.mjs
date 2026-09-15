// Standalone scrape test: open one REI link in the saved sandbox browser and print the extracted
// fields as JSON. Needs ONLY the REI login (npm run login:rei) — no Gmail / Sheets / Calendar auth.
// Usage:  node scripts/test-scrape.mjs "https://my.reiblackbook.com/contacts/XXXXXXXX"
import { launchReiContext } from '../src/rei/browser.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';

const url = process.argv[2];
if (!url || !/^https?:\/\//i.test(url)) {
  console.error('Usage: node scripts/test-scrape.mjs "https://my.reiblackbook.com/contacts/..."');
  process.exit(1);
}

/*
 * THE RUN LOCK, because two Chromiums on one profile is what signs REI out.
 *
 * From the client's own logs/rei-session.log, three OPEN lines on the same profile:
 *
 *   15:07:05  pid 7520    OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   15:13:31  pid 126140  OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   15:45:07  pid 139868  OPEN  ...\browser-data\rei-fresh  reiCookies=0
 *
 * Two processes in the profile at once, and half an hour later the cookie jar is empty. Chromium does not
 * merge concurrent access: whichever instance closes last writes ITS in-memory state over the other's. Both
 * closed cleanly - every CLOSE and EXIT in that log is clean - so nothing looked wrong at the time, and the
 * next run simply arrived logged out.
 *
 * Every SCHEDULED job already took the lock. This script did not, and neither did five of its siblings -
 * all of them hand-run tools, one of which the re-check's own output tells the reader to run. So the way to
 * lose the REI session was to follow the instructions on screen while a sweep happened to be working.
 *
 * It WAITS rather than exiting: this is only ever run by hand, and losing the race to a timer helps nobody.
 */
const releaseRei = await acquireLockWaiting('run', {
  onWait: (left) => console.log(`  REI is busy - waiting, up to ${Math.ceil(left / 60)} more minute(s)`)
});
if (!releaseRei) {
  console.log('REI is still busy after the wait. Nothing was opened; try again in a few minutes.');
  process.exit(1);
}
/* Released on the way out however this ends, so a crash here cannot block every later run. */
process.on('exit', () => { releaseRei(); });

const context = await launchReiContext({ headless: false });
try {
  const result = await scrapeReiVisit(context, url, {});
  console.log('\n===== EXTRACTED FROM REI =====');
  console.log(JSON.stringify(result, null, 2));
  console.log('==============================\n');
  const missing = ['sellerName', 'propertyAddress', 'appointmentStartIso', 'assignedOwner']
    .filter((k) => !result[k]);
  console.log(missing.length ? `Missing critical fields: ${missing.join(', ')}` : 'All critical fields captured.');
} finally {
  await context.close().catch(() => {});
}
