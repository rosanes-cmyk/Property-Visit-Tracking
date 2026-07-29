// Standalone scrape test: open one REI link in the saved sandbox browser and print the extracted
// fields as JSON. Needs ONLY the REI login (npm run login:rei) — no Gmail / Sheets / Calendar auth.
// Usage:  node scripts/test-scrape.mjs "https://my.reiblackbook.com/contacts/XXXXXXXX"
import { launchReiContext } from '../src/rei/browser.mjs';
import { scrapeReiVisit } from '../src/rei/scraper.mjs';

const url = process.argv[2];
if (!url || !/^https?:\/\//i.test(url)) {
  console.error('Usage: node scripts/test-scrape.mjs "https://my.reiblackbook.com/contacts/..."');
  process.exit(1);
}

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
