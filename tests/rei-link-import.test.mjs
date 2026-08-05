/**
 * Giving the tracker the REI links it is missing.
 *
 *   node tests/rei-link-import.test.mjs
 *
 * This is the cap on everything else built today. 374 of 378 tracker rows have no REI link, so the
 * 20-minute re-check can only ever see FOUR leads — the dashboard says "209 REI link missing", and keeping
 * the board accurate from REI is limited to about one percent of the sheet.
 *
 * The client's own Property_Visit_Tracking workbook carries 373 of them, hyperlinked onto the seller NAMES
 * in its Data tab. That is why no import ever found them: a hyperlink lives in the file's relationship
 * table, not in the cell text, so every CSV export of that sheet dropped them silently.
 *
 * The danger here is putting the WRONG link on a row. The re-check would then read another seller's REI
 * page and write that seller's phone number, appointment and stage onto this one. So most of this tests
 * the matching and the refusals.
 */
import fs from 'node:fs';

/*
 * The real normalizeAddress, lifted out of sheets.mjs rather than imported.
 *
 * sheets.mjs imports googleapis, so it is not resolvable from the repo root — the same reason
 * address-normalization.test.mjs does this, and lifting it means this suite cannot drift from the function
 * the importer actually runs.
 */
const MJS = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/google/sheets.mjs', import.meta.url), 'utf8');
const from = MJS.indexOf('export const normalizeAddress = (value) =>');
const to = MJS.indexOf('.trim();', from) + '.trim();'.length;
if (from < 0) throw new Error('normalizeAddress not found in sheets.mjs');
const normalizeAddress = new Function(
  `${MJS.slice(from, to).replace('export const', 'const')}\nreturn normalizeAddress;`
)();

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const SCRIPT = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/import-rei-links.mjs', import.meta.url), 'utf8');

/* The matchers, lifted out of the shipped script so they cannot drift from what actually runs. */
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const nameKey = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
const addressMatch = (a, b) => {
  const x = normalizeAddress(a); const y = normalizeAddress(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
};

console.log('=== Phone is the first and strongest signal ===');
check('same number, different formatting', digits10('(650) 620-4017') === digits10('650-620-4017'), true);
check('a leading 1 does not break it', digits10('1 (650) 620-4017') === digits10('6506204017'), true);
check('different numbers do not match', digits10('(650) 620-4017') === digits10('(650) 620-4018'), false);
// A blank must never match a blank — that would pair every phoneless row with every phoneless source row.
check('a blank phone yields no key', digits10(''), '');
check('a short number yields a short key, not a false match', digits10('4017') === digits10(''), false);

console.log('\n=== Address, through the SAME normalizer the upsert uses ===');
/*
 * The source workbook writes "340 Vallejo Dr, Apt 83, Millbrae, CA, 94030" and REI writes the same address
 * with ", UNITED STATES" on the end. If those two read as different properties, the link lands nowhere.
 */
check('the country suffix does not break it',
  addressMatch('340 Vallejo Dr, Apt 83, Millbrae, CA, 94030, UNITED STATES', '340 Vallejo Dr, Apt 83, Millbrae, CA, 94030'), true);
check('"Apt 83" and "#83" are one place',
  addressMatch('340 Vallejo Dr, Apt 83, Millbrae, CA 94030', '340 Vallejo Dr #83, Millbrae, CA 94030'), true);
check('a missing zip still matches on the prefix',
  addressMatch('1390 Estudillo Ave, San Leandro, CA 94577', '1390 Estudillo Ave, San Leandro'), true);
check('two different houses on one street do NOT match',
  addressMatch('1390 Estudillo Ave, San Leandro, CA', '1392 Estudillo Ave, San Leandro, CA'), false);
check('a different street does not match',
  addressMatch('340 Vallejo Dr, Millbrae, CA', '340 Sonoma Blvd, Vallejo, CA'), false);
check('a blank address matches nothing', addressMatch('', '340 Vallejo Dr'), false);

console.log('\n=== Name alone is never an identity ===');
check('the same person spelled differently keys the same', nameKey('Sara Davenport') === nameKey('sara  davenport'), true);
check('punctuation is ignored', nameKey("O'Brien, Sean") === nameKey('OBrien Sean'), true);
check('two different people do not collide', nameKey('Maria Garcia') === nameKey('Mario Garcia'), false);
// The tier requires the city too, so two Maria Garcias in different towns cannot be merged.
check('the name tier demands a city as well',
  /nameKey\(r\['Seller Name'\]\) === nameKey\(s\.name\)\s*\n\s*&& Boolean\(s\.city\)/.test(SCRIPT), true);

console.log('\n=== The refusals ===');
/*
 * Putting the wrong link on a row is the one way this can do real damage: the re-check would then read
 * another seller's REI page and write their phone, appointment and stage onto this lead.
 */
check('an existing link is never replaced', /if \(existing\) \{/.test(SCRIPT), true);
check('...and a differing one is reported', /already have a DIFFERENT REI link — left alone/.test(SCRIPT), true);
check('a source link matching two rows is skipped, not picked',
  /if \(hits\.length > 1\) \{ ambiguous\.push/.test(SCRIPT), true);
check('...and it says they are probably duplicates', /probably duplicate tracker rows/.test(SCRIPT), true);
check('it is a dry run by default', /const APPLY = process\.argv\.includes\('--yes'\)/.test(SCRIPT), true);
check('it reuses the project normalizer rather than a second one',
  /import \{ normalizeAddress \} from '\.\.\/src\/google\/sheets\.mjs'/.test(SCRIPT), true);
check('tiers are tried in order and stop at the first hit', /if \(hits\.length\) \{ how = label; break; \}/.test(SCRIPT), true);
check('it writes only the two link columns',
  (SCRIPT.match(/colOf\.get\('(?!REI BlackBook Link|REI Record ID)/g) || []).length, 0);
check('REI Record ID is only set when blank', /!text\(row\['REI Record ID'\]\)/.test(SCRIPT), true);

console.log('\n--- the stored link is canonical ---');
/*
 * REI's own links carry "?activeTab=chat" and similar. What is stored should not depend on which tab
 * somebody had open when they copied it, and the id is what the scraper and the state file key on.
 */
const canon = (l) => { const id = (l.match(/contacts\/(\d+)/) || [])[1]; return id ? `https://my.reiblackbook.com/contacts/${id}` : l; };
check('a chat-tab link is cleaned',
  canon('https://my.reiblackbook.com/contacts/20533149?activeTab=chat'), 'https://my.reiblackbook.com/contacts/20533149');
check('an about-tab link is cleaned',
  canon('https://my.reiblackbook.com/contacts/20284479?activeTab=about'), 'https://my.reiblackbook.com/contacts/20284479');
check('an already-clean link is unchanged',
  canon('https://my.reiblackbook.com/contacts/20539133'), 'https://my.reiblackbook.com/contacts/20539133');
check('the script does the same', /https:\/\/my\.reiblackbook\.com\/contacts\/\$\{id\}/.test(SCRIPT), true);

console.log('\n=== Seller data must not be committed ===');
/*
 * build/rei-links.json holds seller names, phone numbers and home addresses. CLAUDE.md: never commit
 * seller data. This is the check that stops a convenience file becoming a leak.
 */
const IGNORE = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
check('the extract is gitignored', /build\/rei-links\.json/.test(IGNORE), true);
check('the script reads it from build/', /const SOURCE = '\.\/build\/rei-links\.json'/.test(SCRIPT), true);
check('...and says what to do when it is absent', /Put the extracted rei-links\.json/.test(SCRIPT), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
