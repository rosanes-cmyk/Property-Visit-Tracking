/**
 * Print exactly what scrapeReiVisit extracts from one REI contact. Read-only.
 *
 *   node scripts/scrape-dump.mjs "https://my.reiblackbook.com/contacts/20525007"
 *
 * Why this exists: rei-fields.mjs proves a label/value pair is ON the page, and recheck-rei.mjs reports
 * what reached the sheet. When those two disagree there is no way to see which step lost the value, and
 * I have now guessed wrong about that three times in a row — the label list, then the wrong config block,
 * then the extraction. rei-fields showed "Appointment Assigned To Juan" sitting on Amelia Middel's page
 * while the run filled no owner, and reasoning about it from the source did not settle it.
 *
 * So this calls the REAL scraper — the same function the scheduled task calls — and prints its output
 * verbatim. No inference, no reimplementation that could differ from production.
 */
import { launchReiContext } from '../src/rei/browser.mjs';
import { acquireLockWaiting } from '../src/utils/lock.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { reiFieldsFromScrape, diffFromRei, RECHECKABLE, FILL_IF_BLANK } from '../src/rei/recheck.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
if (!url) {
  console.error('Usage: node scripts/scrape-dump.mjs "https://my.reiblackbook.com/contacts/20525007"');
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

const context = await launchReiContext();
let scraped;
try {
  scraped = await scrapeReiVisit(context, url);
} finally {
  await context.close();
}

console.log('\n===== WHAT THE SCRAPER GOT =====\n');
// Every field, blanks included and marked. A missing field is the finding here, so it must not be hidden.
for (const [key, value] of Object.entries(scraped)) {
  if (key === 'notes' || key === 'warnings') continue;
  const shown = value === '' || value === null || value === undefined
    ? '(BLANK)'
    : String(Array.isArray(value) ? value.join(', ') : value).replace(/\s+/g, ' ').slice(0, 100);
  console.log(`  ${key.padEnd(20)} ${shown}`);
}

if (scraped.warnings?.length) {
  console.log('\n===== WARNINGS =====');
  for (const w of scraped.warnings) console.log(`  - ${w}`);
}

/*
 * The three fields this was built to explain, called out rather than left in the list above. The owner is
 * the open question; the appointment pair is the one already understood.
 */
console.log('\n===== THE THREE IN QUESTION =====');
console.log(`  assignedOwner        ${scraped.assignedOwner || '(BLANK)  <-- REI shows "Appointment Assigned To Juan"'}`);
console.log(`  appointmentStartIso  ${scraped.appointmentStartIso || '(BLANK)'}`);
console.log(`  taskStatus           ${scraped.taskStatus || '(BLANK)'}`);
if (!scraped.appointmentStartIso) {
  /*
   * Expected, not a fault. REI's "Appointment Time" is "-" on this contact and the scraper deliberately
   * refuses the clock inside "Appointment Date" — that field has been observed holding a CREATION
   * timestamp (8:35 AM for a visit at 11:00 AM). Guessing the time would put Juan at the wrong hour, so a
   * blank here is the no-guessing rule working. The sheet keeps the date it already has.
   */
  console.log('    ^ expected when REI\'s "Appointment Time" is "-": the clock inside "Appointment Date"');
  console.log('      is refused on purpose (it has been seen holding a CREATION time, not the visit time).');
}

console.log('\n===== WHAT WOULD REACH THE SHEET =====');
const fields = reiFieldsFromScrape(scraped, { zone: config.calendarTimezone });
if (!Object.keys(fields).length) console.log('  nothing');
for (const [k, v] of Object.entries(fields)) console.log(`  ${k.padEnd(20)} ${v}`);

// Against a row with everything blank, so the output shows the maximum this contact could ever fill.
console.log('\n===== AGAINST AN EMPTY ROW =====');
const blank = Object.fromEntries([...RECHECKABLE, ...FILL_IF_BLANK, 'Current Stage'].map((f) => [f, '']));
const changes = diffFromRei(blank, fields);
if (!changes.length) console.log('  no changes — REI supplied nothing this row could use');
for (const c of changes) console.log(`  ${c.field.padEnd(20)} -> "${c.to}"${c.filledBlank ? '   (fill-if-blank)' : ''}`);

console.log('\nNothing was changed in REI or in the sheet.');
