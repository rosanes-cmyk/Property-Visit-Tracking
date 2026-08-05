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
import { scrapeReiVisit } from '../src/rei/scraper.mjs';
import { reiFieldsFromScrape, diffFromRei, RECHECKABLE, FILL_IF_BLANK } from '../src/rei/recheck.mjs';
import { config } from '../src/config.mjs';

const url = process.argv.find((a) => /^https?:\/\//i.test(a));
if (!url) {
  console.error('Usage: node scripts/scrape-dump.mjs "https://my.reiblackbook.com/contacts/20525007"');
  process.exit(1);
}

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
