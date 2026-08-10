/**
 * The Windows scheduled tasks, and what each one is allowed to do unattended.
 *
 *   node tests/scheduled-tasks.test.mjs
 *
 * The client asked, of the REI re-check: "just to be sure it will check time to time the update". The
 * honest answer at the time was no — it only ran when somebody typed the command. This pins the three
 * timers, their intervals, and the reasons: a run that fires unattended and does nothing is worse than
 * no timer at all, because it looks like cover.
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

const INSTALL = fs.readFileSync('twin-visit-logger-sandbox/scripts/install-windows-task.ps1', 'utf8');
const RECHECK = fs.readFileSync('twin-visit-logger-sandbox/scripts/recheck.cmd', 'utf8');

console.log('=== Three timers, each with a runner that exists ===');
for (const [task, runner] of [
  ['Twin Visit Logger Sandbox', 'run-once.cmd'],
  ['Twin Visit Logger WhatsApp', 'whatsapp-watch.cmd'],
  ['Twin Visit Logger REI Recheck', 'recheck.cmd']
]) {
  check(`"${task}" is installed`, INSTALL.includes(`-Name "${task}"`), true);
  check(`  ...and runs ${runner}`, INSTALL.includes(`-Runner "${runner}"`), true);
  check(`  ...which is a real file`,
    fs.existsSync(`twin-visit-logger-sandbox/scripts/${runner}`), true);
}

console.log('\n=== The notes audit runs on a timer too ===');
/*
 * It did not, and that was the biggest hole left. audit-notes.mjs is the only job here that needs no
 * browser and no REI link, so it is the only one that can see all 378 rows rather than the 102 with a REI
 * page — and it is how "Cancelled the property visit" (Lili) and "Pending reschedule" (Todd) reached the
 * board at all. Until now it ran only when somebody typed it, so the NEXT outcome a colleague wrote down
 * would have sat there unread.
 */
check('the notes audit task is installed', INSTALL.includes('-Name "Twin Visit Logger Notes Audit"'), true);
check('  ...and runs audit-notes.cmd', INSTALL.includes('-Runner "audit-notes.cmd"'), true);
check('  ...which is a real file', fs.existsSync('twin-visit-logger-sandbox/scripts/audit-notes.cmd'), true);
/*
 * Hourly, not every 20 minutes. It reads the whole tab in one API call so it is cheap, but notes do not
 * change minute to minute and a wasted run is still a write path opened for nothing.
 */
check('it defaults to hourly', /\[int\]\$NotesIntervalMinutes = 60/.test(INSTALL), true);
check('...with a 10-minute floor', /NotesIntervalMinutes -lt 10/.test(INSTALL), true);
check('...and says why', /Each run reads the whole tab/.test(INSTALL), true);
check('it can be skipped', /\$SkipNotes/.test(INSTALL), true);
check('its log is listed', /logs\\audit-notes\.log/.test(INSTALL), true);

const NOTES_CMD = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/audit-notes.cmd'), 'utf8');
// A dry run on a timer would report the same drift every hour and correct none of it.
check('the scheduled run APPLIES rather than reports', /audit-notes\.mjs --yes/.test(NOTES_CMD), true);
check('the log is rotated, not grown forever', /GTR 5000000/.test(NOTES_CMD), true);
check('it runs from the project root', /cd \/d "%~dp0\.\."/.test(NOTES_CMD), true);
check('each run is date-stamped', /==== %DATE% %TIME% ====/.test(NOTES_CMD), true);

console.log('\n=== The re-check interval ===');
/*
 * 20 minutes, matching RECHECK_MINUTES in recheck.mjs — at the client's request, "why this is two hour?
 * should be every 20 mins check it". It was 120.
 *
 * The two numbers have to agree or the timer is theatre: with a 120-minute timer and a 20-minute per-lead
 * window nothing is checked between firings, and with a 20-minute timer and the old 24-hour window every
 * run would fire and skip every lead. What bounds the cost is the per-run CAP of 5 leads, not the interval
 * — three runs an hour is at most 360 REI page loads a day however many leads are active.
 */
check('defaults to 20 minutes', /\[int\]\$RecheckIntervalMinutes = 20/.test(INSTALL), true);
check('...and the per-lead window in recheck.mjs agrees with it',
  /export const RECHECK_MINUTES = 20;/.test(
    fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/rei/recheck.mjs'), 'utf8')), true);
check('refuses anything under 5 minutes', /RecheckIntervalMinutes -lt 5/.test(INSTALL), true);
check('...and says why', /opens a REI browser page per lead/.test(INSTALL), true);
check('can be skipped entirely', /\$SkipRecheck/.test(INSTALL), true);

console.log('\n=== A scheduled run must actually correct things ===');
/*
 * The dry run is the right default for a person at a keyboard and the wrong one for a timer: it would
 * report the same drift every two hours forever and fix none of it. So the runner passes --yes.
 */
check('the runner applies changes', /recheck-rei\.mjs --yes/.test(RECHECK), true);
check('it logs to its own file', /logs\\recheck-task\.log/.test(RECHECK), true);
check('every run is date-stamped in the log', /==== %DATE% %TIME% ====/.test(RECHECK), true);
check('the log is rotated, not grown forever', /GTR 5000000/.test(RECHECK), true);
check('it runs from the project root, not wherever the scheduler starts',
  /cd \/d "%~dp0\.\."/.test(RECHECK), true);
check('the installer mentions the new log', /logs\\recheck-task\.log/.test(INSTALL), true);

console.log('\n=== The bucket sweep QUEUES for REI; the whole-book re-check stands down ===');
/*
 * These two want opposite things from a busy lock, and getting it backwards is not a small bug.
 *
 * Both drive the same browser profile and share one lock. On the client's machine the sweep skipped twice
 * in a row — fired on its timer, read the sheet, listed the 7 leads on the card, then found the lock held
 * by the 20-minute job and exited 0. A clean exit, a full-looking log, and nothing checked.
 *
 * For the whole-book job that outcome is fine: three firings an hour, and the next one picks up whatever
 * accumulated. For the sweep it is not. It runs once an hour and exists to make the 11am and 3pm cards
 * true; a skipped sweep means a card posted from stale data with nothing on it saying so. So it waits its
 * turn — affordable because it walks only the leads on the card, not the 149 with REI links.
 */
const BUCKETS = fs.readFileSync('twin-visit-logger-sandbox/scripts/recheck-buckets.cmd', 'utf8');
check('the sweep runner exists',
  fs.existsSync('twin-visit-logger-sandbox/scripts/recheck-buckets.cmd'), true);
check('it sweeps the buckets, not the whole book', /--buckets/.test(BUCKETS), true);
check('it WAITS for a busy REI rather than skipping', /--wait/.test(BUCKETS), true);
check('...and the flag it passes is one recheck-rei.mjs honours',
  /const WAIT = args\.includes\('--wait'\)/.test(
    fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/recheck-rei.mjs'), 'utf8')), true);
check('it applies changes, not a dry run', /--yes/.test(BUCKETS), true);
check('it logs to its own file', /logs\\bucket-task\.log/.test(BUCKETS), true);
check('every run is date-stamped', /==== %DATE% %TIME% ====/.test(BUCKETS), true);
check('the log is rotated, not grown forever', /GTR 5000000/.test(BUCKETS), true);
check('it runs from the project root', /cd \/d "%~dp0\.\."/.test(BUCKETS), true);
/* And the opposite half of the rule, so a future edit cannot quietly make both jobs queue. */
check('the whole-book re-check does NOT wait', /--wait/.test(RECHECK), false);


console.log('\n=== The board intake: rows a colleague added without an address ===');
/*
 * The client: "instead of waiting in the email... just add the number and then the name of the seller and
 * date and it will do automatic... since my teammate can access it as well the dashboard."
 *
 * The board writes the row and parks it, because Apps Script has no browser and cannot open REI. This
 * task is the half that can. The two halves agree through one string, and if they ever stop agreeing the
 * rows sit on the board forever looking like finished records with a strange address — nothing would
 * report it, so the agreement is asserted here.
 */
const FILL = fs.readFileSync('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs', 'utf8');
const WEBAPP = fs.readFileSync('apps-script/WebApp.gs', 'utf8');
const PENDING = 'PENDING REI LOOKUP —';

check('the board marks a parked row', WEBAPP.includes(`var PENDING_REI_PREFIX = '${PENDING}'`), true);
check('...and the PC looks for the same string', FILL.includes(`const PENDING_PREFIX = '${PENDING}'`), true);
check('the runner exists', fs.existsSync('twin-visit-logger-sandbox/scripts/fill-pending.cmd'), true);
check('the task is installed', INSTALL.includes('-Name "Twin Visit Logger Board Intake"'), true);
check('...running that runner', INSTALL.includes('-Runner "fill-pending.cmd"'), true);
check('...every 2 minutes by default', /\[int\]\$PendingIntervalMinutes = 2/.test(INSTALL), true);
check('...and can be skipped', /\$SkipPending/.test(INSTALL), true);

const FILLCMD = fs.readFileSync('twin-visit-logger-sandbox/scripts/fill-pending.cmd', 'utf8');
check('the scheduled run applies changes', /fill-pending-rei\.mjs --yes/.test(FILLCMD), true);
check('it logs to its own file', /logs\\fill-pending\.log/.test(FILLCMD), true);
check('the log is rotated', /GTR 5000000/.test(FILLCMD), true);
check('it runs from the project root', /cd \/d "%~dp0\.\."/.test(FILLCMD), true);

/*
 * It WAITS for a busy REI rather than standing down. A colleague is watching that record on the board, so
 * "skipped, try again in five minutes" is a person staring at a row that never completes.
 */
check('it queues for REI rather than skipping', /acquireLockWaiting/.test(FILL), true);
/* A row it cannot resolve keeps its placeholder and says why — a silent skip looks like "not yet". */
check('an unresolvable row is reported, not silently dropped', /left parked/.test(FILL), true);
check('...and REI having no address is never guessed around',
  /REI has no Property Address/.test(FILL), true);
/* The colleague typed the date; REI may not know about the booking yet. Theirs wins. */
check('the date typed on the board is kept', /keeping the date typed on the board/.test(FILL), true);
/* And it updates the row that exists rather than appending a second one beside it. */
check('the existing row is matched, not appended', /findExistingVisit\(auth, visit\)/.test(FILL), true);
check('a dry run is the default', /const APPLY = args\.includes\('--yes'\)/.test(FILL), true);


console.log('\n--- booking from the board: edit, never duplicate ---');
/*
 * The client, shown that "+ Add property" always appended: "no, just edit that tab instead, edit
 * property, since that is already [there]." Right — and a second Sara would have double-counted her in
 * every number across the top of the board: SLA breach, Overdue, Need decision, Stalled.
 */
const WEB = fs.readFileSync('apps-script/WebApp.gs', 'utf8');
const COMBINED = fs.readFileSync('apps-script/Code.combined.gs', 'utf8');

check('an existing lead is looked for before anything is written',
  WEB.indexOf('findRowForBooking_(params)') < WEB.indexOf("ensureRows_(sh, CFG.MAX_ROWS)"), true);
check('...and a match is rescheduled, not appended',
  /if \(found\.row\) return webRescheduleRow_\(found\.row, params\);/.test(WEB), true);
check('matching ignores phone formatting', /digits\.slice\(-10\)/.test(WEB), true);
/*
 * A closed-out lead is NOT "already there": the same seller returning months later is a new
 * opportunity, and reviving the dead row would bury why it was closed.
 */
check('a closed-out row is not revived', /Lost \/ Closed Out/.test(WEB), true);
/*
 * One phone, two properties, two rows. Rescheduling a guess moves the wrong visit silently; a duplicate
 * card somebody merges by hand is the recoverable mistake of the two.
 */
check('an ambiguous phone creates rather than guesses', /ambiguous: true/.test(WEB), true);
check('...and says so on the record', /POSSIBLE DUPLICATE/.test(WEB), true);
/* A reschedule must not drag a lead backwards past where it has actually got to. */
check('a stage past the visit is never rewound', /STAGES_BEFORE_OFFER/.test(WEB), true);
/* The two Apps Script files are kept identical by hand; a drift here ships one and not the other. */
check('Code.combined.gs carries the same logic',
  /function webRescheduleRow_/.test(COMBINED) && /function findRowForBooking_/.test(COMBINED), true);

/* And the PC side must clear a parked row it merged elsewhere, or the placeholder lives forever. */
check('a merged parked row is cleared', /cleared the parked row/.test(FILL), true);
check('...by blanking it, not deleting the row', /values\.clear/.test(FILL), true);


console.log('\n--- the waiting card: visible, honest, and counting from the right moment ---');
const DASH = fs.readFileSync('apps-script/Dashboard.html', 'utf8');

/*
 * The counter read 1009m 16s at ten to five in the afternoon, because it subtracted Created Date — a
 * column written by today_(), which is MIDNIGHT. Both date columns are dates by design (formulas, the
 * daily report and the legacy import all depend on that), so the instant is carried in the text instead.
 */
check('the parked moment is stamped as an instant', /\[since ' \+ new Date\(\)\.toISOString\(\)/.test(WEB), true);
check('...and the board reads it from there', /\\\[since \(\[\^\\\]\]\+\)\\\]/.test(DASH), true);
check('...not from Created Date', /var since=r\.created\?new Date\(r\.created\)/.test(DASH), false);

/*
 * The client: "there should be showed in the dashboard, added will not be closed, so that its still
 * working." Pinned above every section and never filtered out — left in the ordinary sections it would
 * sort by due date, hide behind whatever chip was on, and look identical to a card that had failed.
 */
check('pending rows are pinned in their own section', /<h2>Being added<\/h2>/.test(DASH), true);
check('...and removed from the ordinary sections',
  /live=live\.filter\(function\(r\)\{return !isPending\(r\);\}\)/.test(DASH), true);
/* And they must not move the numbers at the top: a half-fetched row is not an SLA breach. */
check('...and excluded from the counts',
  /ribbon\(live\.filter\(function\(r\)\{return !isPending\(r\);\}\)\)/.test(DASH), true);
/* After fifteen minutes it stops claiming to be working and names the actual cause. */
check('a stuck row stops pretending', /Still not finished/.test(DASH), true);
check('...and says what to check', /signed in to Windows/.test(DASH), true);

console.log('\n--- the booking form ---');
check('visit time is on the form', /data-k="visitTime" type="time"/.test(DASH), true);
check('...and is sent to the sheet', /'Visit Time':g\('visitTime'\)/.test(DASH), true);
check('a visitor can be chosen', /data-k="visitor"/.test(DASH), true);
/*
 * Both lists come from the WORKBOOK's own dropdowns, never hardcoded here. A value outside them fails
 * the whole row write, not just its own cell — REI really does contain "Thea, Cherry".
 */
check('the visitor list comes from the workbook', /visitors: visitors/.test(WEB), true);
check('...read from the sheet\'s dropdown', /DROPDOWNS\['Assigned Visitor'\]/.test(WEB), true);
check('...and the page takes it from the server', /if\(d\.visitors&&d\.visitors\.length\)VISITORS=d\.visitors/.test(DASH), true);


console.log('\n--- a board booking does everything an email booking does ---');
/*
 * It did not, and the client spotted the inconsistency: "if someone added in here this should be prio and
 * work all ASAP to add, book, add calendar, closed, chat, check notes and alert GC."
 *
 * A visit typed on the board reached the tracker and the calendar and then went silent — no briefing, so
 * the visitor never got one, and the REI task stayed open. The same event had two different outcomes
 * depending on which door it came through.
 */
check('today first, not sheet order', /soonest visit first/.test(FILL), true);
check('...sorted by the visit date', /pending\.sort\(/.test(FILL), true);
check('...and undated rows go last', /'9999-99-99'/.test(FILL), true);
check('the Chat briefing is posted', /await notifyChat\(/.test(FILL), true);
check('...from the same builder as the email path', /briefingFromDescription\(buildDescription\(visit\)/.test(FILL), true);
check('...with the seller\'s number kept', /keepContactDetails: true/.test(FILL), true);
check('the REI task is closed through the same gate', /shouldCompleteTask\(\{/.test(FILL), true);
check('...only when REI_COMPLETE_TASKS is on', /if \(config\.reiCompleteTasks\) \{/.test(FILL), true);
check('...matched on phone AND date', /pickTaskForVisit\(tasks, visitKey\)/.test(FILL), true);
check('...and an unconfirmed click is not called closed',
  /the click was not confirmed/.test(FILL), true);
/* Closed BEFORE the message, so the message can report it — same ordering as the intake. */
check('the task is closed before the Chat message',
  FILL.indexOf('shouldCompleteTask({') < FILL.indexOf('await notifyChat('), true);

console.log('\n--- a visit today outranks everything ---');
/*
 * Visit Scheduled scored 30, below Offer Preparation — so a visit this afternoon ranked beneath
 * paperwork on the board, the KPIs, the reports and the Chat card, all of which read this one column.
 *
 * The bonus is TIME-based rather than a flat promotion on purpose: promoting the stage itself would rank
 * a visit booked for next month above a contract about to be signed, which is wrong and would teach
 * everyone to ignore the ordering.
 */
const SETUP = fs.readFileSync('apps-script/Setup.gs', 'utf8');
check('a visit today gets the top bonus', /TODAY\(\),75/.test(SETUP), true);
check('...tomorrow less', /TODAY\(\)\+1,50/.test(SETUP), true);
check('...this week less again', /TODAY\(\)\+7\),25/.test(SETUP), true);
/* A completed or cancelled visit must not keep the bonus and sit at the top all day. */
check('only while the visit is still Scheduled',
  /IF\(AND\('.*Visit Status.*"Scheduled"/.test(SETUP.replace(/\n/g, '')), true);
/* Setup.gs and Code.combined.gs are kept identical by hand; a drift ships one and not the other. */
check('Code.combined.gs has the same formula', /TODAY\(\),75/.test(COMBINED), true);


console.log('\n--- the finished row stops claiming to be waiting ---');
/*
 * The client's screenshot caught this: Sean's card was complete — address, owner, next action — and still
 * carried "⚠️ Waiting for the PC to read REI and fill in the address and details. [since ...]".
 *
 * Not cosmetic. Data Quality Status is a FORMULA reading Exception Reason, so a stale reason makes that
 * row count as an Exception in every total on the board, permanently, and shows a red warning to the
 * visitor saying the automation has not run on a record it plainly has.
 */
check('the waiting flag is cleared after a fill', /cleared the "waiting for the PC" flag/.test(FILL), true);
check('...by writing the cell, not hoping upsert does it', /values\.update/.test(FILL), true);
/*
 * A POSSIBLE DUPLICATE warning is addressed to a PERSON and is still true after the lookup, so it stays.
 * Only our own sentence goes.
 */
check('only our own sentence is removed',
  /\^Waiting for the PC to read REI/.test(FILL), true);
check('...and the duplicate warning survives', /kept the duplicate warning/.test(FILL), true);
/* The [since] stamp goes either way — it drives the elapsed timer, and there is nothing left to time. */
check('the since-stamp is always stripped', /\\s\*\\\[since \[\^\\\]\]\*\\\]/.test(FILL), true);
/*
 * Exception Reason is past column Z on this sheet, so a one-letter A1 range would write to the wrong
 * column — silently, into whatever lives at that letter.
 */
check('the A1 range handles two-letter columns', /function columnLetter/.test(FILL), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
