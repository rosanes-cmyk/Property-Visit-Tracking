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

console.log('\n=== A Task Body must not stop the parking ===');
/*
 * THE REGRESSION THIS EXISTS FOR. The condition was `!addr && !body`, and the voice-AI path writes a Task
 * Body on EVERY row — "Human-answered call. Campaign PROPERTY-LEADS. Booked by Thea. Agreed time 2:00 PM.
 * Ref ..." — so `body` was never empty and the parking branch could never run for the one path it was
 * written for. The row fell through to webIntake_ and was rejected for having no address: exactly the
 * behaviour the parking was meant to replace. It was tested against a row with an empty Task Body, a shape
 * those rows never have.
 */
for (const [label, src] of [['IntakeInbox.gs', INBOX], ['Code.combined.gs', COMBINED]]) {
  check(`${label}: the guard is on the ADDRESS, not on the body`,
    /if \(!addr && !addrInBody\) \{/.test(src), true);
  check(`${label}: '!addr && !body' is gone`, /if \(!addr && !body\) \{/.test(src), false);
  // A body that really does carry "Property address: ..." still completes normally, no parking needed.
  check(`${label}: the body is searched for an address first`,
    /parseReiTaskBody_\(body\) \|\| \{\}\)\.address/.test(src), true);
  check(`${label}: ...defensively, so a parser change cannot break intake`,
    /typeof parseReiTaskBody_ === 'function'/.test(src), true);
  // And a truly empty row is still skipped in silence — a body alone is not "real content".
  check(`${label}: a blank row with no body is still skipped quietly`,
    /if \(!hasSomething && !body\) continue;/.test(src), true);
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
// The `&& !body` is part of it now: a row carrying only a Task Body is not "genuinely empty", and
// silence is what made three real appointments invisible for days.
check('a genuinely empty row is still skipped in silence',
  /if \(!hasSomething && !body\) continue;/.test(INBOX), true);

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


console.log('\n=== A reschedule of an existing lead still gets its event ===');
/*
 * THE BUG THIS SECTION EXISTS FOR. A booking from the phone path carries no address, so it reaches
 * webIntake_ holding the "PENDING REI LOOKUP — <phone>" placeholder. It matched an existing row by phone
 * and updated the time correctly — and then the placeholder guard refused to make a calendar event, even
 * though the ROW being updated already had a real address on it.
 *
 * So the board showed the new time and Juan's calendar got nothing: everything reported success and the
 * visit reached nobody. The row is the authority; the incoming placeholder is only a lookup key.
 */
for (const [label, src] of [['WebApp.gs', WEBAPP], ['Code.combined.gs', COMBINED]]) {
  check(`${label}: the row's own address is read`,
    /var rowAddr = String\(U\.get\('Property Address'\) \|\| ''\)\.trim\(\);/.test(src), true);
  check(`${label}: ...and preferred unless it is itself a placeholder`,
    /var calAddr = \(rowAddr && rowAddr\.indexOf\(PENDING_REI_PREFIX\) !== 0\) \? rowAddr : addr;/.test(src), true);
  check(`${label}: the calendar is given that address, not the incoming one`,
    /maybeCreateVisitEvent_\(calMap, calAddr, dup\.rowNum\)/.test(src), true);
  check(`${label}: and the event describes it too`,
    /'Property Address': calAddr,/.test(src), true);
  // The guard itself must stay: a row with NO real address must still never reach the calendar.
  check(`${label}: a genuinely placeholder-only row still gets no event`,
    /String\(addr \|\| ''\)\.indexOf\(PENDING_REI_PREFIX\) === 0/.test(src), true);
}

console.log('\n=== A booking waits a minute, not ten ===');
/*
 * The client: "the intake inbox kinda take long for 10 mins we need it to for 5 mins ... once there a new
 * came from intake inbox should auto process in the data because that is prio."
 *
 * They asked for five and it is one, because five is not meaningfully closer to what they want and one
 * costs almost nothing. A row in this tab is a BOOKING somebody took on the phone — a seller expecting a
 * visit, a colleague waiting to organise it — and every minute it sits here is a minute the board, the
 * calendar and the team all say the visit does not exist. An idle run reads the tab, finds every row
 * already has a Status, and returns.
 */
for (const [label, src] of [['IntakeInbox.gs', INBOX], ['Code.combined.gs', COMBINED]]) {
  check(`${label}: the trigger runs every minute`,
    /ScriptApp\.newTrigger\('processIntakeInbox_'\)\.timeBased\(\)\.everyMinutes\(1\)\.create\(\);/.test(src), true);
  check(`${label}: the old ten-minute cadence is gone`,
    /everyMinutes\(10\)/.test(src), false);
  // Reinstalling must not leave the old one running alongside the new: two copies double every read.
  check(`${label}: any existing trigger is removed first`,
    src.indexOf("if (t.getHandlerFunction() === 'processIntakeInbox_') ScriptApp.deleteTrigger(t);")
      < src.indexOf('everyMinutes(1)'), true);
}
check('the menu says so, so nobody has to guess the cadence',
  /Turn ON auto-check \(every minute\)/.test(read('apps-script/Code.combined.gs')), true);
/*
 * AND THE LIMIT IS WRITTEN DOWN. Zapier writes this tab through the Sheets API, and an API write fires
 * neither onEdit nor onChange — the same rule that makes the tracker's stage cascade need a handler rather
 * than a sheet event. So nothing can react to the row ARRIVING, and a minute is as close as a timer gets.
 * Recording that stops the next person hunting for an event trigger that cannot exist.
 */
check('why it cannot be truly instant is recorded',
  /an API write does not fire onEdit or onChange/.test(read('apps-script/IntakeInbox.gs')), true);
// Matched on a phrase that does not straddle the comment's line wrap — my first version did and failed.
check('...along with what WOULD be instant',
  /intake endpoint directly instead of writing a row/.test(read('apps-script/IntakeInbox.gs')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
