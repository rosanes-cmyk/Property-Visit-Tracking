/**
 * The visit briefing fires when the booking reaches the calendar, not the next morning.
 *
 *   node tests/visit-briefing-on-booking.test.mjs
 *
 * The briefing already existed and was good — property, drive, seller's number, what they said — but it
 * only went out at 07:30 on the DAY of the visit, or when somebody ran it by hand. The client, on being
 * told that: "no that is stupid once it add to calendar shoudl fire that one as we;;"
 *
 * They are right. A visit booked at 4pm for the next morning left the visitor with nothing until 07:30,
 * and a booking taken by phone can be for the same afternoon. The information exists the moment the event
 * is created.
 *
 * THE RISK IS SCOPE, not the message. maybeCreateVisitEvent_ is the choke point for the import, the trash
 * restore and the stage-fixer as well as for bookings — wiring a Chat post into it would turn a
 * maintenance job into a flood. And the client's standing instruction is that a visit which merely MOVES
 * posts nothing: "i dont want the update for this in the chat, it will confuse my teammate." So this is
 * pinned to the booking path and to newly-created events only.
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

const CHAT = read('apps-script/ChatNotify.gs');
const WEB = strip(read('apps-script/WebApp.gs'));
const COMBINED = read('apps-script/Code.combined.gs');

console.log('=== The briefing exists and carries what a visitor needs ===');
check('postVisitBriefing_ is defined', /function postVisitBriefing_\(rowNum\) \{/.test(CHAT), true);
for (const [what, re] of [
  ['the address', /R\.get\('Property Address'\)/],
  ['the date', /R\.get\('Visit Date'\)/],
  ['the time, through timeCell_', /timeCell_\(R\.get\('Visit Time'\)\)/],
  ['the seller', /R\.get\('Seller Name'\)/],
  ['the phone', /R\.get\('Phone'\)/],
  ['who is going', /R\.get\('Assigned Visitor'\) \|\| R\.get\('Assigned Owner'\)/],
  ['the REI link', /R\.get\('REI BlackBook Link'\)/],
  ['directions', /maps\/dir\/\?api=1&destination=/]
]) check(`it carries ${what}`, re.test(CHAT), true);
// A briefing that sends somebody to a house to meet a person they cannot ring is worse than none.
check('the phone is NOT redacted out', /' · ' \+ phone/.test(CHAT), true);
check('an unassigned visit says so loudly', /Needs a visitor assigned/.test(CHAT), true);
check('the drive time is included when known', /driveMinutes_\(addr\)/.test(CHAT), true);

console.log('\n=== It cannot break the booking it describes ===');
check('the whole thing is wrapped', /\} catch \(e\) \{\s*\n\s*\/\* Never fatal\./.test(CHAT), true);
check('a missing webhook is a silent no-op', /if \(!chatWebhookUrl_\(\) \|\| !rowNum\) return '';/.test(CHAT), true);
check('no address means no briefing', /if \(!addr\) return '';/.test(CHAT), true);
check('the drive-time lookup cannot throw out', /catch \(e\) \{ mins = 0; \}/.test(CHAT), true);
check('the result is logged either way', /Visit briefing FAILED: /.test(CHAT) && /Visit briefing posted for /.test(CHAT), true);

console.log('\n=== Scope: only a NEW event, only from the booking path ===');
for (const [label, src] of [['WebApp.gs', WEB], ['Code.combined.gs', strip(COMBINED)]]) {
  // Both webIntake_ paths — the new row and the matched-existing one.
  check(`${label}: fires on the create path`,
    /const cal = maybeCreateVisitEvent_\(map, addr, row\);\s*\n\s*if \(String\(cal\)\.indexOf\('event created'\) === 0/.test(src), true);
  check(`${label}: fires on the upsert path`,
    /var calU = maybeCreateVisitEvent_\(calMap, calAddr, dup\.rowNum\);[\s\S]{0,200}?if \(String\(calU\)\.indexOf\('event created'\) === 0/.test(src), true);
  /*
   * 'event created' is the prefix maybeCreateVisitEvent_ returns ONLY when it made a new event. The reuse
   * path returns 'event already on the calendar — reused…', so a plain reschedule stays silent.
   */
  check(`${label}: a reused or moved event posts nothing`,
    /indexOf\('event already/.test(src), false);
  check(`${label}: guarded by typeof, so ChatNotify being absent cannot break intake`,
    (src.match(/typeof postVisitBriefing_ === 'function'/g) || []).length, 2);
}
// The choke point itself must stay silent: it is shared with the import, the restore and the stage-fixer.
// Bounded to the FUNCTION BODY. An unbounded [\s\S]*? runs straight past the closing brace and matches the
// call site in webIntake_ further down the file, which is exactly where it is supposed to be.
const chokePoint = WEB.slice(WEB.indexOf('function maybeCreateVisitEvent_'),
  WEB.indexOf('\n}', WEB.indexOf('function maybeCreateVisitEvent_')));
check('maybeCreateVisitEvent_ does not post anything itself',
  /postVisitBriefing_/.test(chokePoint), false);
check('...and it is a real slice, not an empty one', chokePoint.length > 500, true);

console.log('\n=== The 07:30 briefing is untouched ===');
// This ADDS a moment; it does not replace the morning one, which is what a visitor reads before setting off.
check('the office PC still owns the morning briefing',
  fs.existsSync(path.resolve('twin-visit-logger-sandbox/scripts/send-briefing.mjs')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
