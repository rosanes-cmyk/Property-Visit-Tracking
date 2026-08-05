/**
 * REI's owner wording -> a value the workbook's dropdown will accept.
 *
 *   node tests/owner-map.test.mjs
 *
 * Caught in a dry run, one command before it would have done damage. With 367 REI links freshly imported,
 * the re-check read Maria Ramos and offered the sheet:
 *
 *     Assigned Owner: "(blank)" -> "Thea, Cherry"
 *
 * "Thea" is in NEITHER dropdown. And a value outside a dropdown does not fail its own cell — it fails the
 * WHOLE WRITE. That is not a guess: earlier in this project one bad Lead Source value produced "the data you
 * entered in cell G379 violates the data validation rules" and took the entire row with it. Now that a batch
 * carries corrections for several leads at once, one unmappable name would silently lose all of them.
 */
import { mapOwner, mapVisitor, OWNER_VALUES, VISITOR_VALUES }
  from '../twin-visit-logger-sandbox/src/google/owner-map.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== The value that would have failed the write ===');
check('"Thea, Cherry" becomes Cherry', mapOwner('Thea, Cherry'), 'Cherry');
check('...for the visitor column too', mapVisitor('Thea, Cherry'), 'Cherry');
check('...and Cherry is a legal value', OWNER_VALUES.includes(mapOwner('Thea, Cherry')), true);
// "Thea" alone is nobody the sheet knows, so nothing is written and the gap stays visible.
check('"Thea" alone maps to nothing', mapOwner('Thea'), '');
check('...rather than being invented', mapVisitor('Thea'), '');

console.log('\n=== Everything it returns must be legal, or empty ===');
/*
 * This is the property that matters. Every possible output is either '' or a value the dropdown contains —
 * there is no third case, so no output of this function can fail a write.
 */
const SAMPLES = ['Juan', 'juan', 'JUAN', 'Juan Diaz', 'Thea, Cherry', 'Agent Thea, Juan', 'Matt/Juan',
  'Cherry/Matt', 'Kyle & Cherry', 'Team', 'Thea', 'Juanita', 'someone else', '', '-', null, undefined,
  '   ', 'Cherry, Thea', 'Juan, Kyle', 'Arly and Matt', 'Danica', '(unassigned)', 'UNASSIGNED'];
for (const s of SAMPLES) {
  const o = mapOwner(s); const v = mapVisitor(s);
  check(`owner(${JSON.stringify(s)}) is legal or empty`, o === '' || OWNER_VALUES.includes(o), true);
  check(`  visitor(${JSON.stringify(s)}) is legal or empty`, v === '' || VISITOR_VALUES.includes(v), true);
}

console.log('\n=== Longest match wins, and word boundaries hold ===');
// Otherwise "Juan" matches inside "Juan Diaz" at an earlier position and the specific value is lost.
check('"Juan Diaz" stays Juan Diaz for a visitor', mapVisitor('Juan Diaz'), 'Juan Diaz');
check('...and collapses to Juan for an owner, which has no Diaz', mapOwner('Juan Diaz'), 'Juan');
check('"Matt/Juan" is matched whole, not as Matt', mapOwner('Matt/Juan'), 'Matt/Juan');
check('"Cherry/Matt" too', mapOwner('Cherry/Matt'), 'Cherry/Matt');
// The boundary check: a name inside another word is not that name.
check('"Juanita" is not Juan', mapOwner('Juanita'), '');
check('"Matthew" is not Matt', mapOwner('Matthew'), '');
check('"Teamwork" is not Team', mapOwner('Teamwork'), '');

console.log('\n=== Case and spacing ===');
check('lower case', mapOwner('juan'), 'Juan');
check('upper case', mapOwner('CHERRY'), 'Cherry');
check('padded', mapOwner('  Kyle  '), 'Kyle');
check('an exact combined value beats a scan', mapOwner('matt/arly'), 'Matt/Arly');

console.log('\n=== The two lists really are different ===');
/*
 * Copied from the workbook, not merged. Juan Diaz, Cesar, Jose Herrera, Manny Morales, Lily and Alan
 * Hernandez visit but are not owners; Arly, Matt, Darius, Danica and Team own but do not appear as
 * visitors. Merging them would put a value in a column whose dropdown rejects it.
 */
check('Juan Diaz is a visitor but not an owner',
  [VISITOR_VALUES.includes('Juan Diaz'), OWNER_VALUES.includes('Juan Diaz')], [true, false]);
check('Team is an owner but not a visitor',
  [OWNER_VALUES.includes('Team'), VISITOR_VALUES.includes('Team')], [true, false]);
check('a visitor-only name is refused for the owner column', mapOwner('Cesar'), '');
check('...and accepted for the visitor column', mapVisitor('Cesar'), 'Cesar');
check('an owner-only name is refused for the visitor column', mapVisitor('Darius'), '');

console.log('\n=== Wired into the write path, twice ===');
const RECHECK = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/recheck.mjs', import.meta.url), 'utf8');
const RUNNER = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('the mapper is used, not the raw REI value', /const owner = mapOwner\(scraped\.assignedOwner\)/.test(RECHECK), true);
check('...and the visitor column has its own', /const visitor = mapVisitor\(scraped\.assignedOwner\)/.test(RECHECK), true);
check('an unmapped name writes nothing at all', /if \(owner\) out\['Assigned Owner'\] = owner;/.test(RECHECK), true);
/*
 * The second check lives in the code that actually writes. One bad cell does not fail alone — it fails
 * every other correction in the same request, silently.
 */
check('the writer re-checks against the dropdown', /const DROPDOWN = \{ 'Assigned Owner': OWNER_VALUES/.test(RUNNER), true);
check('...and skips rather than failing the batch', /SKIPPED \$\{c\.field\} = "\$\{c\.to\}"/.test(RUNNER), true);
check('...and says what to do about it', /Add it to the \$\{c\.field\} list in the workbook/.test(RUNNER), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
