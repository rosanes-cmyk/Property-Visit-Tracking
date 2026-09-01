/**
 * PASS 2 — filling in a missing REI BlackBook Link.
 *
 *   node tests/rei-link-backfill.test.mjs
 *
 * A row with a REAL address is never a parked row, so fill-pending's PASS 1 skips it; and recheck.mjs
 * refuses any row without a link ("no REI link"). So a booking that arrives complete-looking falls
 * between both jobs and is permanently outside the REI sweep — no stage changes, no gift tracking, no
 * owner corrections, no cancellation detection, and nothing anywhere saying so.
 *
 * That was an edge case until the client confirmed their colleague will ALWAYS reply with the address.
 * Then it becomes every booking from the phone path.
 *
 * The dangerous part of the fix is scope, not logic: the 379 imported legacy rows also have no link, and
 * each lookup is a real browser page on a machine whose 2-minute board-intake job is already losing its
 * turn to the long sweeps. An unbounded backfill would send it browsing REI for hours and starve the job
 * a colleague is watching. So the bounds are what this test mostly pins.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const SRC = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

console.log('=== It is bounded, both ways ===');
const days = (code.match(/const REI_LINK_BACKFILL_DAYS = (\d+);/) || [])[1];
const max = (code.match(/const REI_LINK_BACKFILL_MAX = (\d+);/) || [])[1];
check('a day window exists', Number(days) > 0, true);
check('...and cannot reach the 2023-24 legacy import', Number(days) <= 90, true);
check('a per-run cap exists', Number(max) > 0, true);
check('...and it is small enough not to monopolise the browser', Number(max) <= 25, true);
check('the day window is actually applied', /age > REI_LINK_BACKFILL_DAYS/.test(code), true);
check('the cap is actually applied', /\.slice\(0, REI_LINK_BACKFILL_MAX\)/.test(code), true);

console.log('\n=== Which rows qualify ===');
check('a parked row is left to PASS 1', /addr\.startsWith\(PENDING_PREFIX\)\) continue;/.test(code), true);
check('a blank address is skipped', /if \(!addr \|\| addr\.startsWith\(PENDING_PREFIX\)\) continue;/.test(code), true);
check('an existing link is never overwritten',
  /if \(text\(r\['REI BlackBook Link'\]\)\) continue;/.test(code), true);
check('a row with no phone is skipped', /if \(!text\(r\['Phone'\]\)\) continue;/.test(code), true);
/*
 * An unreadable Created Date is SKIPPED, not assumed recent. Touching a legacy row is the worse of the
 * two mistakes — and it is logged, so "unreadable" cannot hide the way a silent skip would.
 */
check('an unreadable Created Date is skipped, not assumed recent',
  /if \(age === null\) \{ unreadable \+= 1; continue; \}/.test(code), true);
check('...and the count is reported on screen',
  /row\(s\) skipped for the link backfill: Created Date could not be read/.test(SRC), true);
check('a future Created Date is skipped too', /age < 0\) continue;/.test(code), true);

console.log('\n=== It writes one cell and nothing else ===');
/*
 * Making the row visible to the sweep is the whole job. The sweep then enriches it on its own schedule
 * with all of its own guards; a second writer of the same fields is how a tracker starts disagreeing
 * with itself.
 */
// Anchored on the next FUNCTION, not on the comment between them: `code` has its comments stripped, so a
// comment anchor matches nothing, indexOf returns -1, and the slice silently becomes the rest of the file.
const writer = code.slice(code.indexOf('async function writeReiLink'), code.indexOf('function lookupKeyFor'));
check('writeReiLink targets the REI BlackBook Link column',
  /headers\.indexOf\('REI BlackBook Link'\)/.test(writer), true);
check('...one cell, by row number', /values\.update/.test(writer), true);
check('...and only ever that one column', (writer.match(/values\.update/g) || []).length, 1);
check('a tracker without the column is reported, not crashed',
  /the tracker has no "REI BlackBook Link" column/.test(SRC), true);

console.log('\n=== It reuses the existing by-phone lookup ===');
// scrapeReiVisit with an empty link and a phone is exactly how PASS 1 resolves a parked row.
check('searches REI by phone with no link',
  /scrapeReiVisit\(context, '', \{ phone, sellerName: who, appointmentStartIso: '' \}\)/.test(code), true);
check('no link found is reported, never guessed',
  /REI returned no contact link for/.test(SRC), true);

console.log('\n=== Ordering and blast radius ===');
check('PASS 2 runs after the parked rows',
  code.indexOf('for (const row of pending)') < code.indexOf('for (const row of backfill.rows)'), true);
check('...inside the same lock and browser',
  code.indexOf('for (const row of backfill.rows)') < code.indexOf('await context.close()'), true);
/*
 * Counted apart from `stuck`, which feeds the board-intake summary and the NOT REACHED arithmetic. A link
 * that could not be found is not a booking that did not happen, and reporting it as one would cry wolf on
 * the number that matters.
 */
check('link failures do not inflate the stuck count',
  /linksMissed \+= 1;/.test(code) && !/for \(const row of backfill\.rows\)[\s\S]*?stuck \+= 1/.test(code), true);
check('every row has its own try, so one cannot kill the pass',
  /for \(const row of backfill\.rows\) \{[\s\S]{0,400}?try \{/.test(code), true);
check('the summary mentions the links when there are any', /REI link\(s\) filled in/.test(code), true);

console.log('\n=== PASS 2 still runs when there are no parked rows ===');
/*
 * The early return used to fire whenever `pending` was empty, which on a good day is always — so the
 * backfill would only ever have run on the rare occasions a parked row happened to be waiting too.
 */
check('the list is built before the early return',
  code.indexOf('const backfill = rowsNeedingReiLink(rows)') < code.indexOf('No rows are waiting on REI. Everything'), true);
check('the early return needs BOTH to be empty',
  /if \(!pending\.length && !backfill\.rows\.length\) \{/.test(code), true);

console.log('\n=== Still paused-aware and still read-only at REI ===');
check('the pause switch is checked before anything opens', /haltForPause\(\{ force: FORCE \}\)/.test(code), true);
check('the scraper is the only REI call in the new pass',
  (code.slice(code.indexOf('for (const row of backfill.rows)')).match(/scrapeReiVisit|readTasks|completeTask/g) || []).join(','),
  'scrapeReiVisit');

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
