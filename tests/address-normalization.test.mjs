/**
 * Address-key tests.
 *
 *   node tests/address-normalization.test.mjs
 *
 * Three separate pieces of code decide whether two rows are "the same property":
 *   1. the sheet's Normalized Address formula      (apps-script/Setup.gs)
 *   2. importNormAddr_                             (apps-script/ImportLegacy.gs)
 *   3. normalizeAddress                            (twin-visit-logger-sandbox/src/google/sheets.mjs)
 *
 * If any one of them drifts, a lead silently exists twice — which is exactly what happened when REI
 * addresses carried ", UNITED STATES" and the legacy workbook's did not. All three are pinned here
 * against the same cases, and the JS implementations are imported from the real files.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

// Both implementations are extracted textually from the shipped source rather than imported:
// sheets.mjs pulls in googleapis, which is not installed in a bare checkout, and a test that only
// runs after npm install is a test that stops running.
const MJS = read('twin-visit-logger-sandbox/src/google/sheets.mjs');
const mjsFrom = MJS.indexOf('export const normalizeAddress = (value) =>');
const mjsTo = MJS.indexOf('.trim();', mjsFrom) + '.trim();'.length;
if (mjsFrom < 0) throw new Error('normalizeAddress not found in sheets.mjs');
const normalizeAddress = new Function(
  `${MJS.slice(mjsFrom, mjsTo).replace('export const', 'const')}\nreturn normalizeAddress;`
)();

// Pull importNormAddr_ out of the shipped Apps Script file.
const GS = read('apps-script/ImportLegacy.gs');
const start = GS.indexOf('function importNormAddr_(value) {');
const end = GS.indexOf('\n}', start) + 2;
if (start < 0) throw new Error('importNormAddr_ not found');
const importNormAddr_ = new Function(`${GS.slice(start, end)}\nreturn importNormAddr_;`)();

/**
 * Build the actual formula string by running the real formulaFor_ with a stub column resolver, so
 * the assertions below are about the formula Sheets will receive, not about the source text.
 */
const SETUP = read('apps-script/Setup.gs');
const fnFrom = SETUP.indexOf('function formulaFor_(header, r) {');
const fnTo = SETUP.indexOf('\nconst COMPUTED_HEADERS');
const formulaFor_ = new Function('colL', 'CFG',
  `${SETUP.slice(fnFrom, fnTo)}\nreturn formulaFor_;`
)(() => 'B', { STALLED_BUSINESS_DAYS: 3 });
const formula = formulaFor_('Normalized Address', 2);

console.log('=== The sheet formula strips the country suffix ===');
check('formula lowercases before matching the country', /LOWER\(/.test(formula), true);
check('formula removes ", united states"', formula.includes('", united states",""'), true);
check('formula removes ", usa"', formula.includes('", usa",""'), true);
  check('formula folds unit/ste/suite the way it already folds apt',
    [' apt ', ' unit ', ' ste ', ' suite '].every((w) => formula.includes(`"${w}"," "`)), true);
  check('the formula has balanced parentheses',
    [...formula].reduce((depth, c) => depth + (c === '(') - (c === ')'), 0), 0);
  check('never goes negative (a stray close paren would still sum to zero)',
    [...formula].reduce((s2, c) => {
      s2.depth += (c === '(') - (c === ')');
      s2.ok = s2.ok && s2.depth >= 0;
      return s2;
    }, { depth: 0, ok: true }).ok, true);
check('country is stripped BEFORE commas are removed (otherwise it can never match)',
  formula.indexOf('", united states"') < formula.indexOf('",",""'), true);

const CASES = [
  // [input, expected key]
  ['2145 Capitol Ave, East Palo Alto, CA, 94303', '2145 capitol ave east palo alto ca 94303'],
  ['2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES', '2145 capitol ave east palo alto ca 94303'],
  ['2145 Capitol Ave, East Palo Alto, CA, 94303, United States', '2145 capitol ave east palo alto ca 94303'],
  ['2145 Capitol Ave, East Palo Alto, CA, 94303, USA', '2145 capitol ave east palo alto ca 94303'],
  ['  2145   Capitol Ave,  East Palo Alto, CA, 94303  ', '2145 capitol ave east palo alto ca 94303'],
  ['2607 Gimelli Pl, Apt 115, San Jose, CA', '2607 gimelli pl 115 san jose ca'],
  ['1160 Drury Rd., Berkeley, CA 94705', '1160 drury rd berkeley ca 94705'],
  ['#12 Main St, Oakland, CA', '12 main st oakland ca'],
  // The real pair the duplicate finder caught: the same Fremont condo written two ways.
  ['38623 Cherry Ln #206, Fremont, CA 94536', '38623 cherry ln 206 fremont ca 94536'],
  ['38623 Cherry Ln Unit 206, Fremont, CA 94536', '38623 cherry ln 206 fremont ca 94536'],
  ['38623 Cherry Ln Apt 206, Fremont, CA 94536', '38623 cherry ln 206 fremont ca 94536'],
  ['100 Market St Ste 4, SF, CA', '100 market st 4 sf ca'],
  ['100 Market St Suite 4, SF, CA', '100 market st 4 sf ca'],
  ['', ''],
];

console.log('\n=== Apps Script and the scraper produce the same key ===');
for (const [input, want] of CASES) {
  check(`importNormAddr_("${input.slice(0, 44)}")`, importNormAddr_(input), want);
  check(`normalizeAddress ("${input.slice(0, 44)}")`, normalizeAddress(input), want);
}

console.log('\n=== The real duplicate this was written for ===');
const fromRei = '2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES';
const fromLegacy = '2145 Capitol Ave, East Palo Alto, CA, 94303';
check('REI row and imported row now collapse to one key (Apps Script)',
  importNormAddr_(fromRei) === importNormAddr_(fromLegacy), true);
check('REI row and imported row now collapse to one key (scraper)',
  normalizeAddress(fromRei) === normalizeAddress(fromLegacy), true);
check('the two implementations agree with each other',
  importNormAddr_(fromRei), normalizeAddress(fromLegacy));

console.log('\n=== Genuinely different properties must NOT collapse ===');
check('different house number', normalizeAddress('2145 Capitol Ave, EPA') === normalizeAddress('2146 Capitol Ave, EPA'), false);
check('different street', normalizeAddress('100 Main St, Oakland') === normalizeAddress('100 Oak St, Oakland'), false);
check('different city', normalizeAddress('100 Main St, Oakland, CA') === normalizeAddress('100 Main St, Fremont, CA'), false);
check('different unit', normalizeAddress('1 A St, Apt 2, SF') === normalizeAddress('1 A St, Apt 3, SF'), false);
check('different unit written differently is still different',
  normalizeAddress('1 A St Unit 2, SF') === normalizeAddress('1 A St #3, SF'), false);
check('"US" inside a street name is not treated as a country',
  normalizeAddress('12 US Highway 1, Vallejo, CA'), '12 us highway 1 vallejo ca');

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
