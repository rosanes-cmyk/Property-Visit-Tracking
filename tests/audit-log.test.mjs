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

console.log('\n=== A lead that could not be READ is not a lead that agreed ===');
/*
 * A live run reported "REI agrees with the sheet on every lead checked. Nothing to change." immediately
 * after all TWENTY leads failed with a login redirect. Nothing had been checked at all.
 *
 * That is the fourth time a summary in this feature has claimed agreement it never verified, after "REI
 * agrees with the sheet", "dates and contact details agree", and "REI agrees on every lead checked" printed
 * over an unverified lead. So a failed scrape now vetoes the all-clear outright rather than being invisible
 * to it.
 */
check('scrape failures are collected', /failures\.push\(\{ row, reason: error\.message \}\)/.test(RUNNER), true);
check('the all-clear requires no failures',
  /if \(!changedRows\.length && !unanswered\.length && !failures\.length\)/.test(RUNNER), true);
check('failures are reported before anything else', /COULD NOT BE READ/.test(RUNNER), true);
check('...and say nothing can be concluded', /nothing about them can be concluded from this run/.test(RUNNER), true);
/*
 * Twenty identical login errors is noise; the fix is one command for all of them. So the login case is
 * counted and stated once.
 */
check('a logged-out REI is summarised once, not per lead', /failed because REI is LOGGED OUT/.test(RUNNER), true);
check('...with the command that fixes it', /npm run login:rei/.test(RUNNER), true);
check('...and reassurance that nothing is corrupted', /a failed lead is not recorded as checked/.test(RUNNER), true);
check('the audit row counts them too', /\$\{failures\.length\} unreadable/.test(RUNNER), true);

console.log('\n=== One browser at a time, or REI logs the client out ===');
/*
 * This was the cause of the repeated logouts, and it is worth stating precisely. run-once.mjs takes
 * acquireLock(); the re-check took none. Both call chromium.launchPersistentContext on the SAME profile
 * directory, the one holding REI's session cookies, and two Chromium processes on one profile corrupt it.
 *
 * The schedules guarantee the collision: the email task fires at :00 :05 :10 :15 :20, this at :00 :20 :40.
 * They land on the same minute every twenty, and a 20-lead run takes five to eight minutes.
 */
/*
 * It takes the lock either way — but a SCHEDULED run stands down when it is busy and a --only run waits.
 * The timer fires again in twenty minutes so skipping costs nothing; a person checking one lead has no next
 * run, and lost the race three times in a row before this split existed. tests/lock covers the behaviour;
 * this asserts only that the lock is still taken on both paths.
 */
check('the re-check takes the lock', /await acquireLock(Waiting)?\(/.test(RUNNER), true);
check('...and waits for it when a lead was named by hand',
  /const release = ONLY\s*\?\s*await acquireLockWaiting/.test(RUNNER), true);
check('...but a scheduled run still stands down instead of queueing',
  /:\s*await acquireLock\(\);/.test(RUNNER), true);
check('...the same unnamed one run-once uses',
  /acquireLock\(\);/.test(fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/run-once.mjs', import.meta.url), 'utf8')), true);
check('it exits cleanly when another run holds it', /Another REI run is active — skipped/.test(RUNNER), true);
check('...and names the reason, so the skip is not read as a fault',
  /That is what was logging REI out/.test(RUNNER), true);
check('the lock is released in finally, even on a crash',
  /\} finally \{\s*\n\s*await context\.close\(\);\s*\n\s*await release\(\);/.test(RUNNER), true);
/*
 * The manual login is the likeliest collision of all, because somebody only runs it WHEN the session has
 * already broken — which is often while a scheduled run is mid-flight.
 */
const LOGIN = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/rei-login.mjs', import.meta.url), 'utf8');
check('logging in takes the lock too', /const releaseLogin = await acquireLock\(\);/.test(LOGIN), true);
check('...and refuses rather than corrupting the profile', /A scheduled REI run is active/.test(LOGIN), true);
check('...releasing it on exit', /process\.on\('exit'/.test(LOGIN), true);

console.log('\n--- and logging in is not on a 45-second clock ---');
/*
 * waitForEvent took Playwright's DEFAULT timeout, which fired at 45 seconds while the client was still
 * completing MFA. The race lost to its own clock and the script crashed mid-login -- during the one step
 * that inherently takes minutes: read a code off a phone, type it, wait for a dashboard.
 */
check('the wait for the window has no timeout',
  /context\.waitForEvent\('close', \{ timeout: 0 \}\)/.test(LOGIN), true);
check('a failed wait no longer crashes the script', /\]\)\.catch\(\(error\) => \{/.test(LOGIN), true);
/*
 * And it tells the truth about the session. Chromium writes a persistent profile continuously, so a login
 * completed before an error is already saved -- claiming otherwise sends somebody round the loop again for
 * nothing.
 */
check('...and says the session may already be saved', /the session IS saved/.test(LOGIN), true);
check('...with how to check rather than a guess', /Run the re-check and see/.test(LOGIN), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
