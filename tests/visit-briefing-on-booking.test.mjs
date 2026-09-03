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

console.log('\n=== The PC path says whether the briefing will fire, and never skips in silence ===');
/*
 * THE CLIENT'S REPORT: "the notif is not firing once the calendar is created, it should create and fire as
 * well." The row in question was filled by the PC (fill-pending-rei.mjs), not by webIntake_ — the output
 * read:
 *
 *     filled row 400 - calendar event set
 *     cleared the "waiting for the PC" flag on row 400
 *     REI task still open - no matching REI task was found on the contact
 *
 * and nothing at all about the briefing. The posting code has been there all along and its default is ON,
 * so the honest answer was one of two things — the .env switches it off, or something skipped it — and the
 * output gave no way to tell them apart. An absent line is not evidence; it is the absence of evidence, and
 * this project has lost days to exactly that.
 */
const FILL = read('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs');
check('the run says up front whether the briefing is on',
  /Chat briefing: \$\{config\.chatVisitBriefing/.test(FILL), true);
check('...naming the switch when it is off',
  /set CHAT_VISIT_BRIEFING=true in \.env/.test(FILL), true);
check('a booking with the briefing off SAYS so',
  /Chat briefing SKIPPED — CHAT_VISIT_BRIEFING is off in \.env\./.test(FILL), true);
check('...and a booking with it on reports posted or not',
  /Chat briefing \$\{posted \? 'posted' : 'NOT posted \(reason above\)'\}/.test(FILL), true);
// The default is ON, so nobody has to edit a config file to get the one channel the team actually has.
check('the default is on', /chatVisitBriefing: bool\(process\.env\.CHAT_VISIT_BRIEFING, true\)/.test(
  read('twin-visit-logger-sandbox/src/config.mjs')), true);
/*
 * WhatsApp stays OFF. Four numbers have been banned or restricted running it, and the agreed design is that
 * the briefing lands in Chat with a line telling a person to make the group by hand. That line is the
 * handover, and it must not quietly become an automated group creation.
 */
check('the Chat message still hands the group to a person',
  /NEXT: create the WhatsApp group, add the team, and paste this briefing/.test(FILL), true);

console.log('\n=== CHAT_ALERTS=off must not swallow the briefing ===');
/*
 * THE ACTUAL CAUSE of "the notif is not firing". The client had CHAT_VISIT_BRIEFING=true — they checked —
 * and the briefing still never arrived, because notifyChat has a SECOND gate:
 *
 *     if (cfg && !cfg.chatAlerts && !critical) return false;
 *
 * CHAT_ALERTS=off was asked for to stop per-lead noise: "this visit moved", "that gift went out". The visit
 * briefing is not that. It is the thing somebody reads before driving to a stranger's house, it has its own
 * switch, and being silenced by a second switch that mentions neither it nor the first is how a message
 * becomes impossible to explain. Two gates on one message and the output named neither.
 *
 * `requested` rather than `critical`, because those mean different things and CLAUDE.md is deliberate about
 * keeping `critical` narrow: critical is "nothing works until a person acts"; requested is "a person
 * switched this on by name, so the noise switch does not get a vote".
 */
const NOTIFY = read('twin-visit-logger-sandbox/src/utils/notify.mjs');
check('notifyChat takes a `requested` flag', /requested = false\n?\} = \{\}\) \{/.test(NOTIFY), true);
check('...which bypasses the alerts switch',
  /if \(cfg && !cfg\.chatAlerts && !critical && !requested\) \{/.test(NOTIFY), true);
check('critical stays a separate idea', /!critical && !requested/.test(NOTIFY), true);
// Every path that sends the VISIT BRIEFING, named individually: one left out is one that silently vanishes.
for (const f of [
  'twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs',
  'twin-visit-logger-sandbox/src/services/process.mjs',
  'twin-visit-logger-sandbox/scripts/send-briefing.mjs'
]) check(`${f.split('/').pop()} marks the briefing as requested`,
  /keepContactDetails: true, requested: true/.test(read(f)), true);
/*
 * The WhatsApp watcher is deliberately NOT in that list: WhatsApp is off, and its message is about a group
 * having been created, which is per-lead by nature and correctly silenced by CHAT_ALERTS.
 */
check('the WhatsApp group message is left as per-lead noise',
  /keepContactDetails: true, requested: true/.test(read('twin-visit-logger-sandbox/src/whatsapp/watch.mjs')), false);

console.log('\n=== A refusal to send says WHICH switch stopped it ===');
/*
 * notifyChat returned a bare false for three different reasons — alerts off, no webhook, HTTP refusal — so
 * the caller guessed, and printed "NOT posted — check CHAT_WEBHOOK_URL" on a run whose webhook was perfect.
 * That sent somebody to check the one thing that was not wrong.
 */
check('alerts-off says so, and says the webhook is fine',
  /CHAT_ALERTS=off in \.env silences this\. The webhook is fine\./.test(NOTIFY), true);
check('a missing webhook says that instead', /no CHAT_WEBHOOK_URL is set/.test(NOTIFY), true);
check('the caller no longer guesses the reason',
  /NOT posted — check CHAT_WEBHOOK_URL/.test(FILL), false);
check('...it defers to the line above', /NOT posted \(reason above\)/.test(FILL), true);
check('the startup banner names the second switch too',
  /CHAT_ALERTS=off — per-lead alerts are silenced, but the briefing/.test(FILL), true);

console.log('\n=== Asking for a briefing by hand cannot end in silence ===');
/*
 * The client ran the sender and got three lines of usage back, then a prompt. Their question was "what is
 * this?" — which is the right question: a bare list of command forms reads like output rather than an
 * instruction, and nothing on screen said the briefing had NOT gone. They had asked for tomorrow's and
 * reasonably assumed it was on its way.
 *
 * Cosmetic-looking, and not: the complaint being worked on at that moment was "the notif is not firing",
 * and this was one more way to end up with no message and no explanation.
 */
const SEND = read('twin-visit-logger-sandbox/scripts/send-briefing.mjs');
const SENDCMD = read('twin-visit-logger-sandbox/scripts/send-briefing.cmd');
check('the usage says outright that nothing was sent',
  /NOTHING WAS SENT — this needs to know WHICH briefing you want\./.test(SEND), true);
check('...and points at the double-click first', /double-click  scripts\\\\send-briefing\.cmd/.test(SEND), true);
check('...and explains each form rather than just listing it',
  /every visit booked for tomorrow/.test(SEND), true);

console.log('\n=== The double-click version is a menu, not a guess-the-word prompt ===');
/*
 * "Type today or tomorrow" required typing one of two words exactly. Everything else in this project is a
 * double-click, so the two commonest answers are now keys and nothing typed can match nothing.
 */
check('it offers numbered choices', /choice \/C 1234 \/N \/M/.test(SENDCMD), true);
check('tomorrow is option 1, the commonest ask', /\[1\]  Tomorrow's visits/.test(SENDCMD), true);
check('there is a way out', /\[4\]  Cancel/.test(SENDCMD), true);
/*
 * LABELS, not parenthesised blocks. cmd expands %VAR% when it PARSES a block, so `set /p WHO=` followed by
 * `%WHO%` inside the same ( ) reads the value from BEFORE anything was typed. My first draft of this menu
 * had exactly that and would have said "nothing typed" at whatever name was entered.
 */
check('the name prompt is not inside a parenthesised block',
  /:byname\s*\necho\.\s*\nset "WHO="\s*\nset \/p WHO=/.test(SENDCMD), true);
check('...and branches by goto', /if errorlevel 4 goto cancel/.test(SENDCMD), true);
// Descending, because `if errorlevel N` means "N or higher" — ascending would take the first branch always.
check('errorlevel is tested in descending order',
  SENDCMD.indexOf('if errorlevel 4') < SENDCMD.indexOf('if errorlevel 3')
  && SENDCMD.indexOf('if errorlevel 3') < SENDCMD.indexOf('if errorlevel 2'), true);
// Somebody who has just asked for a briefing wants it now; the de-duplication is for the timer.
/*
 * Against the CODE only. `rem` lines are comments in a .cmd, and the comment above this menu uses the words
 * "--force on every path" — so counting them in the raw file gives four for three call sites. Eighth time in
 * this project an assertion has been decided by prose instead of code.
 */
const SENDCODE = SENDCMD.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
check('every path forces, so an asked-for briefing is never de-duplicated away',
  (SENDCODE.match(/--force/g) || []).length, 3);

console.log('\n=== The 07:30 briefing is untouched ===');
// This ADDS a moment; it does not replace the morning one, which is what a visitor reads before setting off.
check('the office PC still owns the morning briefing',
  fs.existsSync(path.resolve('twin-visit-logger-sandbox/scripts/send-briefing.mjs')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
