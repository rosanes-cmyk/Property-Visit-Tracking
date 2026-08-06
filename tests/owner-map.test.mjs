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
/*
 * "Thea, Cherry" is REI's own way of writing the pair, and it is the exact value that nearly failed a whole
 * batch write. It used to collapse to just Cherry, losing Thea — the best that could be done when Thea was
 * not a value the dropdown held.
 *
 * The client has since added her: "add thea, also there should be combo of cherry and thea". So the pair now
 * resolves to the pair, which is what REI was saying all along.
 */
check('"Thea, Cherry" becomes the pair', mapOwner('Thea, Cherry'), 'Cherry/Thea');
check('...written either way round', mapOwner('Cherry, Thea'), 'Cherry/Thea');
check('...and with a slash or an "and"',
  [mapOwner('Cherry/Thea'), mapOwner('Thea and Cherry')], ['Cherry/Thea', 'Cherry/Thea']);
check('...and it is a legal value', OWNER_VALUES.includes(mapOwner('Thea, Cherry')), true);
/*
 * The VISITOR column is a different dropdown and does not hold the pair, so it still resolves to the single
 * name it does hold. An alias only fires when its target is legal for the column being written.
 */
check('...while the visitor column, which has no pair, still gives Cherry',
  mapVisitor('Thea, Cherry'), 'Cherry');
/*
 * "Theavil Marie" is the fuller name REI writes on gift orders and shipping notes. \bThea\b cannot match
 * inside it — there is no word boundary after the 'a' — so without an alias she reads as nobody and the lead
 * stays Unassigned. That is the client's question answered: "why other is unassigned?"
 */
check('"Thea" is now a name the sheet knows', mapOwner('Thea'), 'Thea');
check('"Theavil Marie" resolves to her too', mapOwner('Theavil Marie'), 'Thea');
check('"Theavil" alone as well', mapOwner('Theavil'), 'Thea');
check('...but the visitor column does not hold her, so nothing is written',
  mapVisitor('Theavil Marie'), '');

console.log('\n=== Everything it returns must be legal, or empty ===');
/*
 * This is the property that matters. Every possible output is either '' or a value the dropdown contains —
 * there is no third case, so no output of this function can fail a write.
 */
const SAMPLES = ['Juan', 'juan', 'JUAN', 'Juan Diaz', 'Thea, Cherry', 'Agent Thea, Juan', 'Matt/Juan',
  'Cherry/Matt', 'Kyle & Cherry', 'Team', 'Thea', 'Juanita', 'someone else', '', '-', null, undefined,
  '   ', 'Cherry, Thea', 'Juan, Kyle', 'Arly and Matt', 'Danica', '(unassigned)', 'UNASSIGNED',
  // Names the client REMOVED from the dropdown. Each must now produce nothing rather than an illegal value.
  'Kyle', 'Jonathan', 'Matt', 'Arly', 'Darius', 'Matt/Arly', 'Cherry/Matt', 'Theavil Marie', 'Theavil'];
for (const s of SAMPLES) {
  const o = mapOwner(s); const v = mapVisitor(s);
  check(`owner(${JSON.stringify(s)}) is legal or empty`, o === '' || OWNER_VALUES.includes(o), true);
  check(`  visitor(${JSON.stringify(s)}) is legal or empty`, v === '' || VISITOR_VALUES.includes(v), true);
}

console.log('\n=== Longest match wins, and word boundaries hold ===');
// Otherwise "Juan" matches inside "Juan Diaz" at an earlier position and the specific value is lost.
check('"Juan Diaz" stays Juan Diaz for a visitor', mapVisitor('Juan Diaz'), 'Juan Diaz');
check('...and collapses to Juan for an owner, which has no Diaz', mapOwner('Juan Diaz'), 'Juan');
check('"Cherry/Thea" is matched whole, not as Cherry', mapOwner('Cherry/Thea'), 'Cherry/Thea');
/*
 * A pair naming somebody who has LEFT resolves to the member who remains, and that is the right answer rather
 * than a gap: "Matt/Juan" means Matt and Juan, Matt is no longer on the list, and Juan still owns the lead.
 * Writing nothing would leave it Unassigned when one of the two named people is still here.
 */
check('"Matt/Juan" gives Juan, the member still on the team', mapOwner('Matt/Juan'), 'Juan');
check('"Cherry/Matt" gives Cherry', mapOwner('Cherry/Matt'), 'Cherry');
// The boundary check: a name inside another word is not that name.
check('"Juanita" is not Juan', mapOwner('Juanita'), '');
check('"Matthew" is not Matt', mapOwner('Matthew'), '');
check('"Teamwork" is not Team', mapOwner('Teamwork'), '');

console.log('\n=== Case and spacing ===');
check('lower case', mapOwner('juan'), 'Juan');
check('upper case', mapOwner('CHERRY'), 'Cherry');
check('padded', mapOwner('  Cherry  '), 'Cherry');
check('an exact combined value beats a scan', mapOwner('cherry/thea'), 'Cherry/Thea');
/*
 * The names the client removed — "remove kyle, Arly, Matt, Darius, Danica, Matt/Arly, Matt/Juan, Cherry/Matt,
 * jonathan" — must now write NOTHING rather than a value the sheet's dropdown would reject.
 *
 * Removing a name does not clear it from rows that already carry it; nothing in this module ever blanks a
 * cell. A lead REI still assigns to Kyle simply keeps whatever is already there.
 */
for (const gone of ['Kyle', 'Jonathan', 'Matt', 'Arly', 'Darius', 'Danica', 'Matt/Arly']) {
  check(`"${gone}" is no longer an owner`, mapOwner(gone), '');
}
/* A pair naming one departed and one current member keeps the current one — see above. */
check('"Matt/Juan" keeps Juan', mapOwner('Matt/Juan'), 'Juan');
check('"Cherry/Matt" keeps Cherry', mapOwner('Cherry/Matt'), 'Cherry');

console.log("\n=== \"why other is unassigned?\" — an owner the dropdown cannot hold is REPORTED ===");
/*
 * The client's question, and it had no answer from the output. mapOwner returns '' for a name the dropdown
 * does not hold, the field is skipped, and a lead REI HAD assigned to somebody looked exactly like one REI had
 * never assigned. Only one of those two is fixable, and it is fixed by adding a name to a dropdown.
 */
const { reiFieldsFromScrape, diffFromRei, describeChanges } =
  await import('../twin-visit-logger-sandbox/src/rei/recheck.mjs');
const unmapped = reiFieldsFromScrape({ assignedOwner: 'Genesis Ramirez', sellerName: 'X' });
check('an unrecognised owner is carried out for reporting', unmapped.__unmappedOwner, 'Genesis Ramirez');
check('...and no owner is written', 'Assigned Owner' in unmapped, false);
/*
 * The marker must never reach the sheet. It is not a column name, so the write loops skip it — asserted
 * because a stray key becoming a write would put "Genesis Ramirez" in a dropdown column and fail the row.
 */
const ROW = { 'Seller Name': 'X', 'Property Address': '1 A St', 'Current Stage': 'Visit Scheduled' };
check('it produces no change at all', diffFromRei(ROW, unmapped), []);
check('...and never appears in the run message',
  /__unmappedOwner/.test(describeChanges(ROW, [], unmapped)), false);
/* A name the dropdown DOES hold is written, and nothing is reported. */
const mapped = reiFieldsFromScrape({ assignedOwner: 'Theavil Marie', sellerName: 'X' });
check('a recognised owner is written', mapped['Assigned Owner'], 'Thea');
check('...and nothing is reported', '__unmappedOwner' in mapped, false);
/* The runner turns it into one line per NAME, not one per lead: "Theavil Marie — 34 leads" is one edit. */
const RUN = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('the runner reports it', /not a value the Assigned Owner dropdown accepts/.test(RUN), true);
check('...grouped by name rather than per lead', /const byName = new Map\(\)/.test(RUN), true);
check('...and logged as an EXCEPTION so it survives the window closing',
  /is not a `\s*\+ 'value the Assigned Owner dropdown holds/.test(RUN), true);
check('...only when the cell is actually empty',
  /reiFields\.__unmappedOwner && !text\(row\['Assigned Owner'\]\)/.test(RUN), true);

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
check('an owner-only name is refused for the visitor column', mapVisitor('Team'), '');
/*
 * The owner list is now the acquisitions team as it stands, set by the client. This assertion is the copy of
 * the workbook's dropdown — if the two ever disagree, a write fails the WHOLE row, so it is spelled out here
 * rather than left to be inferred from the module.
 */
check('the owner dropdown is exactly the five values agreed',
  [...OWNER_VALUES].sort(), ['Cherry', 'Cherry/Thea', 'Juan', 'Team', 'Thea']);

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
