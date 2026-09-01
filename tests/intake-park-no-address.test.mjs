/**
 * A booking with a phone but no address is PARKED, not rejected.
 *
 *   node tests/intake-park-no-address.test.mjs
 *
 * The same situation reached two different outcomes, and the rejecting one was the path the voice-AI
 * bookings were being built on.
 *
 *   the dashboard booking form  parks the row as 'PENDING REI LOOKUP — (phone)' and the office PC looks
 *                              the contact up in REI on its next pass
 *   the Intake Inbox            wrote 'NOT LOGGED: no Property Address' and stopped
 *
 * The Chat card that feeds the Inbox says, in its own words, "No address on file — add it after the
 * time" — the address is OPTIONAL there by design. So every reply without one was rejected. Nine such
 * rows were found sitting in the tab, each a booking that reached neither the board nor Juan's calendar,
 * and nothing anywhere said so except a cell nobody had opened.
 *
 * Three things are pinned here: that a phone-bearing row parks, that a row with nothing to look up with
 * is still marked, and that a parked row does NOT put a placeholder-titled event on Juan's calendar.
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

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const INBOX = strip(read('apps-script/IntakeInbox.gs'));
const WEBAPP = strip(read('apps-script/WebApp.gs'));
const COMBINED = strip(read('apps-script/Code.combined.gs'));

console.log('=== A phone-bearing row parks instead of being rejected ===');
for (const [label, src] of [['IntakeInbox.gs', INBOX], ['Code.combined.gs', COMBINED]]) {
  check(`${label}: a lookup key is taken from Phone, then the REI link`,
    /var lookupKey = String\(inboxGet_\(row, idx, 'Phone'\) \|\|\s*\n?\s*inboxGet_\(row, idx, 'REI BlackBook Link'\) \|\| ''\)\.trim\(\);/.test(src), true);
  check(`${label}: the placeholder uses the shared prefix, not a literal`,
    /parked = PENDING_REI_PREFIX \+ ' ' \+ lookupKey;/.test(src), true);
  check(`${label}: ...and becomes the row's address`, /addr = parked;/.test(src), true);
  // Flagged the way the booking form flags one, or the board shows a finished-looking record.
  check(`${label}: parked rows are flagged Incomplete`,
    /lead\['Data Quality Status'\] = 'Incomplete';/.test(src), true);
  check(`${label}: ...with the [since ...] stamp the card's timer reads`,
    /\[since ' \+ new Date\(\)\.toISOString\(\) \+ '\]/.test(src), true);
}

console.log('\n=== A row with nothing to look up with is still marked ===');
// Parking is only possible when something can find the address. With neither an address nor a phone
// there is genuinely nothing to be done, and silence is what made three appointments invisible for days.
check('no address and no phone is reported',
  /NOT LOGGED: no Property Address and no phone to look one up with/.test(INBOX), true);
check('...and the message says to CLEAR THE CELL', /CLEAR THIS CELL/.test(INBOX), true);
/*
 * That instruction matters and the old wording was wrong. processIntakeInbox_ skips any row whose Status
 * is non-blank — permanently — so "fill it in, then re-run" could not work: the row is never looked at
 * again until the Status cell is emptied.
 */
check('the skip-if-Status-set rule is still what makes that necessary',
  /if \(String\(row\[idx\['Status'\]\]\)\.trim\(\)\) continue;/.test(INBOX), true);
check('a genuinely empty row is still skipped in silence',
  /if \(!hasSomething\) continue;/.test(INBOX), true);

console.log('\n=== A parked row gets NO calendar event ===');
for (const [label, src] of [['WebApp.gs', WEBAPP], ['Code.combined.gs', COMBINED]]) {
  check(`${label}: maybeCreateVisitEvent_ refuses a placeholder address`,
    /String\(addr \|\| ''\)\.indexOf\(PENDING_REI_PREFIX\) === 0/.test(src), true);
  check(`${label}: ...and says why`,
    /address not known yet \(parked for REI lookup\)/.test(src), true);
  // Before createEvent, or the guard is decoration.
  const body = src.slice(src.indexOf('function maybeCreateVisitEvent_'));
  check(`${label}: the guard runs BEFORE createEvent`,
    body.indexOf('indexOf(PENDING_REI_PREFIX)') < body.indexOf('createEvent'), true);
}

console.log('\n=== The flags have a way through webIntake_ ===');
// The map loop skips empty values, so these are inert for every existing caller.
check('Data Quality Status is a pass-through',
  /'Data Quality Status': g\('Data Quality Status', 'dataQuality'\)/.test(WEBAPP), true);
check('Exception Reason is a pass-through',
  /'Exception Reason': g\('Exception Reason', 'exceptionReason'\)/.test(WEBAPP), true);

console.log('\n=== The prefix is shared, so the office PC recognises the row ===');
/*
 * fill-pending-rei.mjs only picks up rows carrying this exact prefix. If the two strings ever drift, a
 * parked row is invisible to the PC and sits on the board forever looking like a finished record with a
 * strange address — so both sides assert it.
 */
const NODE = read('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs');
const appsPrefix = (WEBAPP.match(/var PENDING_REI_PREFIX = '(.*?)';/) || [])[1];
const nodePrefix = (NODE.match(/const PENDING_PREFIX = '(.*?)';/) || [])[1];
check('Apps Script defines the prefix', typeof appsPrefix, 'string');
check('the office PC uses the identical string', nodePrefix, appsPrefix);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
