/**
 * A booking parked from the board fills IN its own row. It never becomes a second row.
 *
 *   node tests/parked-row-is-the-row.test.mjs
 *
 * WHAT HAPPENED, from the client's own tracker, found by scripts/parked-doctor.mjs:
 *
 *   Marie Tran           row 407 STILL PARKED    row 414 filled
 *   Frank Yong           row 408 STILL PARKED    row 416 filled
 *   Kathleen Tostanoski  row 410 STILL PARKED    row 415 filled
 *   Everett Morgan       row 412 STILL PARKED    row 418 filled
 *   Emmanuel Hoggs       row 413 STILL PARKED    row 417 filled
 *
 * Five people, ten rows. Five cards on the board that could never clear — Kyle Flores showed "Still not
 * finished" for 11.8 days — while the log said, for each one:
 *
 *   filled row 418 · calendar event set
 *   Chat briefing posted
 *
 * Every word of that was true. It filled a row, set an event and posted a briefing. It just did it to a
 * row nobody was looking at.
 *
 * THE CAUSE was one line: the parked row was handed to findExistingVisit, which matches on Gmail message
 * id, REI record id, REI link, or a normalised address verified by phone. A row booked from the board has
 * none of them — its id and link are blank until this script fills them, and its address is the
 * placeholder. Phone alone is never a match, only a verifier. So the search came back empty every time and
 * upsertVisit wrote a new row, exactly as it is supposed to for a genuinely new lead.
 *
 * The file header has said "The EXISTING row is updated in place. Nothing is appended, so a colleague's
 * row cannot become two" since the day it was written. A comment is not a test. This is.
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

const ROOT = path.resolve('twin-visit-logger-sandbox');
const raw = fs.readFileSync(path.join(ROOT, 'scripts/fill-pending-rei.mjs'), 'utf8');
/* Comment-stripped: this project has caught itself asserting against its own prose nine times. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

console.log('=== The row it is standing on is the row it writes ===');
/*
 * The whole fix. A search that finds nothing must fall back to the parked row, not to an append.
 */
check('a failed search falls back to the parked row',
  /const match = searched\.found \? searched : \{/.test(code), true);
check('...and the fallback carries the parked row NUMBER',
  /rowNumber: row\.__rowNumber/.test(code), true);
check('...and is marked found, so upsertVisit updates instead of appending',
  /found: true,/.test(code), true);
/*
 * upsertVisit reads the existing row by column INDEX to protect a human's progress — see
 * HUMAN_ADVANCED_STAGES. Handing it a record keyed by header name would read every cell as empty and
 * quietly drop that protection, so the raw array has to be carried through.
 */
check('the RAW row array is kept for it', /__values: values/.test(code), true);
check('...and handed over', /row: row\.__values \|\| \[\]/.test(code), true);

console.log('\n=== A contact that really does already have a row is merged, and the parked row RETIRED ===');
/*
 * The other half, and it had been described but never written. The branch logged "merging into it" and
 * did nothing else, so the placeholder sat on the board beside the real card for ever and every run did
 * the whole REI lookup again to reach the same answer.
 */
check('merging is detected on the SEARCH result, not the fallback',
  /const mergingInto = searched\.found && searched\.rowNumber !== row\.__rowNumber/.test(code), true);
check('the parked row is retired', /await retireParkedRow\(sheets, headers, row, mergingInto\)/.test(code), true);
check('...by rewriting Property Address, which is what the board reads',
  /headers\.indexOf\('Property Address'\)/.test(code), true);
check('...to text that names the surviving row',
  /DUPLICATE — this booking was merged into row \$\{intoRowNumber\}/.test(raw), true);
/*
 * Never deleted. A row that vanishes is indistinguishable from one that was never created, and deleting
 * somebody else's row is not this script's decision to make.
 */
check('no row is ever deleted', /deleteDimension|batchUpdate.*deleteRange/.test(code), false);
check('a failed retire is survivable, not fatal',
  /could not clear the parked row/.test(raw), true);

console.log('\n=== The matcher itself is unchanged ===');
/*
 * Deliberately NOT fixed by loosening findExistingVisit to match on phone alone. That function decides
 * whether two records are the same lead across the whole project, and one shared mobile — a landlord, a
 * husband and wife on one number — would merge two different properties into one row. The parked row does
 * not need to be FOUND; it is already in hand.
 */
const sheets = fs.readFileSync(path.join(ROOT, 'src/google/sheets.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
check('phone is still only a verifier for an address, never a match on its own',
  /sameMessage \|\| sameId \|\| sameLink \|\| \(sameAddress && \(!targetPhone \|\| samePhone\)\)/.test(sheets), true);

console.log('\n=== The board and the sheet agree on what "parked" means ===');
// Two constants, two languages, one string. They have drifted before.
const NODE_PREFIX = (raw.match(/const PENDING_PREFIX = '(.*?)'/) || [])[1];
const DASH = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');
const DASH_PREFIX = (DASH.match(/var PENDING_PREFIX='(.*?)'/) || [])[1];
check('the PC writes a prefix the board recognises',
  Boolean(NODE_PREFIX && DASH_PREFIX && NODE_PREFIX.startsWith(DASH_PREFIX)), true);
check('...and the retire text does NOT start with it, or the card would never clear',
  'DUPLICATE — this booking was merged into row 9'.startsWith(DASH_PREFIX), false);

console.log('\n=== The doctor that found this stays read-only ===');
/*
 * It is the thing somebody runs when the board and the log disagree, often while a job is running. The
 * moment it can write, it stops being safe to reach for.
 */
const DOC = fs.readFileSync(path.join(ROOT, 'scripts/parked-doctor.mjs'), 'utf8');
for (const forbidden of ['values.update', 'values.append', 'setNote', 'notifyChat',
  'launchReiContext', 'acquireLock']) {
  check(`parked-doctor does not ${forbidden}`, DOC.includes(forbidden), false);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
