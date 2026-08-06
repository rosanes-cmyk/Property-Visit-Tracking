/**
 * Being able to answer "was this already updated?" while looking at the lead.
 *
 *   node tests/audit-log.test.mjs
 *
 * The client, mid-conversation with a colleague: "how would i know the auto update in the dashboard check
 * in the rei all what happened like this ... its already update".
 *
 * He could not know. The REI re-check corrected rows in silence — the Chat webhook returns 404 so nothing
 * was announced, and nothing was recorded either. The only trace was a log file on one particular laptop.
 * A cell would change and there was no way to answer "when was this last checked, and what changed?"
 *
 * The Apps Script side has always written to an 'Automation Log' tab through logAuto_. The Node side now
 * writes to the SAME tab, so both halves leave their history in one place.
 */
import { auditLine } from '../twin-visit-logger-sandbox/src/google/audit-log.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const AMELIA = { __rowNumber: 4, 'Seller Name': 'Amelia Middel', 'Property Address': '460 5th Avenue, Redwood City' };

console.log('=== A log line has to read on its own, months later ===');
const line = auditLine(AMELIA, [
  { field: 'Current Stage', from: 'Visit Scheduled', to: 'Offer Sent' },
  { field: 'Approved Offer Amount', from: '', to: '930000' }
]);
check('it names the row', /row 4/.test(line), true);
check('it names the seller', /Amelia Middel/.test(line), true);
check('it names the property', /460 5th Avenue/.test(line), true);
check('it names each field', /Current Stage/.test(line) && /Approved Offer Amount/.test(line), true);
/*
 * The OLD value matters as much as the new one. "Visit Status -> Canceled" cannot tell you whether the
 * automation corrected something or broke it; "Scheduled -> Canceled" can.
 */
check('it keeps the old value', /"Visit Scheduled" -> "Offer Sent"/.test(line), true);
check('a blank old value is shown as blank, not omitted', /"\(blank\)" -> "930000"/.test(line), true);
check('a missing seller name does not produce an empty gap', /\(no name\)/.test(auditLine({ __rowNumber: 9 }, [])), true);
// A long note must not blow the cell out; the log is for scanning.
const longLine = auditLine(AMELIA, [{ field: 'Last Contact Result', from: '', to: 'x'.repeat(400) }]);
check('a long value is clipped', longLine.length < 300, true);

console.log('\n=== What gets logged, and what does not ===');
const RUNNER = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('an applied change is logged', /auditRows\.push\(\{ level: 'INFO'[\s\S]*?auditLine\(row, legal\)/.test(RUNNER), true);
check('a dead-lead tag is logged as an EXCEPTION', /auditRows\.push\(\{ level: 'EXCEPTION'/.test(RUNNER), true);
/*
 * A summary row on EVERY run, including one that changed nothing. Without it, silence in the log reads the
 * same whether the automation checked twenty leads and found them all correct or stopped three days ago —
 * and those need opposite reactions.
 */
check('every run leaves a summary row', /REI re-check \$\{APPLY \? 'run' : 'DRY RUN'\}/.test(RUNNER), true);
check('...which says how many were read and updated', /lead\(s\) read, /.test(RUNNER), true);
check('...and how many could not be verified', /unverified/.test(RUNNER), true);
// A dry run must not fill the team's audit trail with things that never happened.
check('a DRY RUN writes no log rows', /if \(APPLY && auditRows\.length\)/.test(RUNNER), true);

console.log('\n=== It writes to the tab the Apps Script already uses ===');
const LOG = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/google/audit-log.mjs', import.meta.url), 'utf8');
const COMBINED = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');
check("the Node side targets 'Automation Log'", /const LOG_SHEET = 'Automation Log';/.test(LOG), true);
check('...the same tab logAuto_ writes to', /getSheetByName\('Automation Log'\)/.test(COMBINED), true);
check('...with the same four columns',
  /\['Timestamp', 'Level', 'Property ID', 'Message'\]/.test(LOG), true);
check('...matching the Apps Script header row',
  /appendRow\(\['Timestamp','Level','Property ID','Message'\]\)/.test(COMBINED), true);

console.log('\n--- and it cannot damage anything ---');
/*
 * values.append writes to the first column of the TABLE IT DETECTS rather than the range given, and that
 * has already put data in the wrong place on this project's tracker. Reading the length and updating a
 * known row costs one extra call and cannot land anywhere unexpected.
 */
// Matched as a CALL, not as prose: the comment above the code names values.append to explain the choice.
check('it does NOT call values.append', /sheets\.spreadsheets\.values\.append\(/.test(LOG), false);
check('...and says in the code why not', /writes to the first column of the TABLE IT DETECTS/.test(LOG), true);
check('it updates an explicit row range', /range: `\$\{LOG_SHEET\}!A\$\{start\}:D\$\{start \+ rows\.length - 1\}`/.test(LOG), true);
/*
 * A log write must never fail the correction it describes. The row is already in the sheet by the time this
 * runs, and losing the note is far better than losing the fix.
 */
check('every failure is swallowed', /catch \(error\) \{\s*\n\s*console\.log\(`    \(audit log not written/.test(LOG), true);
check('...and it returns 0 rather than throwing', /return 0;\s*\n\s*\}\s*\n\}/.test(LOG), true);
check('an empty batch is a no-op', /if \(!rows \|\| !rows\.length\) return 0;/.test(LOG), true);
check('it creates the tab if the workbook has none', /addSheet: \{ properties: \{ title: LOG_SHEET, hidden: true \} \}/.test(LOG), true);
// Hidden, like the Apps Script creates it — this is an audit trail, not a tab the team works in.
check('...hidden, as the Apps Script also does', /sh\.hideSheet\(\)/.test(COMBINED), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
