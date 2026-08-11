/**
 * The parked-lead sweep — closed and nurture leads, on a slow clock, reported not rewritten.
 *
 *   node tests/parked-sweep.test.mjs
 *
 * The client asked whether Lost / Closed Out and Long-Term Nurture should join the ordinary auto-check, and
 * asked twice for a straight answer rather than a hedge.
 *
 * Both extremes are wrong, and the tests here are mostly about holding the middle:
 *
 *   Adding ~214 mostly-dead leads to the 20-minute rotation roughly DOUBLES REI page loads — and REI page
 *   volume is what has been logging this account out all along — while putting dead leads in front of a
 *   booking a colleague is watching on the board.
 *
 *   Never re-reading them is also wrong. Long-Term Nurture is DEFINED as "check back later", and a closed
 *   lead somebody reopens in REI would read Lost on the board for ever: a live deal disappearing quietly,
 *   which is the most expensive failure available here.
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
const read = (p) => fs.readFileSync(path.resolve('twin-visit-logger-sandbox', p), 'utf8');
const S = read('scripts/sweep-parked.mjs');

console.log('=== it writes NOTHING ===');
/*
 * The important design decision, not a limitation. Moving a lead OUT of Lost / Closed Out is a business
 * judgement — this project's own rule is that Current Stage belongs to the team — and stageAdvance already
 * refuses to drag a closed lead back on REI's say-so. Automating the un-close would be the automation
 * overruling a decision a person made, which is exactly what got a colleague blamed once already.
 */
check('no cell is ever written', /values\.update|values\.append|values\.batchUpdate/.test(S), false);
check('...and the reason is stated', /IT WRITES NOTHING\. NOT ONE CELL\./.test(S), true);
check('...it reports instead', /parked lead\(s\) look alive again in REI/.test(S), true);
check('...saying explicitly that nothing changed',
  /Nothing has been changed — have a look and decide/.test(S), true);

console.log('\n=== which leads, and only which ===');
check('exactly the two parked stages',
  /const PARKED = \['Lost \/ Closed Out', 'Long-Term Nurture'\];/.test(S), true);
/* Everything else is already covered, far more often, by the ordinary re-check. Overlap would be waste. */
check('...and nothing else, because the re-check has the rest',
  /every\r?\n \* other stage is already covered, more often, by the ordinary re-check/.test(S), true);
check('a lead with no REI link is not attempted', /text\(r\['REI BlackBook Link'\]\)/.test(S), true);
check('test rows are excluded', /text\(r\['Source'\]\) !== 'TEST'/.test(S), true);

console.log('\n=== the slow clock, and the cap ===');
check('forty a run by default', /Finite\(n\) && n > 0 \? n : 40/.test(S), true);
/*
 * Oldest-checked first. Without it the sweep re-reads the top forty for ever and the rest are never seen —
 * which is the same as not running it at all, while still costing the browser time.
 */
check('oldest checked first, so the rotation is fair', /oldest first, so the rotation is fair/i.test(S), true);
check('...with its own state file, not the re-check\'s',
  /parked-sweep\.json/.test(S), true);
check('...and why they are kept apart',
  /cannot be knocked out of order by the fast one/.test(S), true);
/*
 * A lead that was LOOKED at is recorded even when the page failed, or a permanently broken link would be
 * retried every single day for ever and permanently block the rotation behind it.
 */
check('a failed read still counts as looked at',
  S.indexOf('Recorded whether or not anything was found') > 0, true);

console.log('\n=== it is the lowest-priority job, and behaves like it ===');
/*
 * acquireLock, NOT acquireLockWaiting. A weekly rotation losing one day costs nothing; a booking a colleague
 * is watching losing twenty minutes to a dead lead costs something real.
 */
check('it does not wait for the browser lock', /await acquireLock\(\);/.test(S), true);
check('...and does not queue behind anything', /acquireLockWaiting/.test(S), false);
check('...standing down quietly when REI is busy', /tomorrow will do/.test(S), true);
check('it honours the pause switch', /haltForPause\(/.test(S), true);
check('...and only runs on the active PC', /haltIfNotActiveMachine\(/.test(S), true);
check('...both before the browser opens',
  Math.max(S.indexOf('haltForPause('), S.indexOf('haltIfNotActiveMachine(')) < S.indexOf('launchReiContext('), true);
check('it reports itself to the dashboard', /beginJob\('parked-sweep'/.test(S), true);
check('...and marks itself finished even if it threw',
  S.indexOf('endJob(', S.lastIndexOf('} finally {')) > 0, true);

console.log('\n=== what counts as "alive again" ===');
/*
 * reiSaysLost is the SAME test the close-out rule uses, so the two cannot disagree about what dead means.
 * A sweep with its own private definition would flag leads the re-check had just closed, and vice versa.
 */
check('deadness is judged by the same rule that closes leads',
  /reiSaysLost\(reiStage\)/.test(S), true);
check('...imported, not reimplemented', /import \{ mapReiStage, reiSaysLost \}/.test(S), true);
/* A blank stage from REI means the page did not render, not that the lead is alive. */
check('a blank REI stage is not treated as alive',
  /REI gave no stage — nothing to compare/.test(S), true);

console.log('\n=== one message, not one per lead ===');
/*
 * Three separate notifications about dead leads coming back is how a space gets muted — and this is a "look
 * at these when you have a minute" message, not an emergency.
 */
check('the batch is reported in a single message',
  (S.match(/await notifyChat\(/g) || []).length, 1);
check('...capped, with the remainder counted', /and \$\{alive\.length - 10\} more/.test(S), true);
check('...and it is a warning, not an alarm', /\{ kind: 'warn' \}/.test(S), true);
check('a clean sweep says nothing at all', /Nothing to report/.test(S), true);

console.log('\n=== scheduled once a day, at a quiet hour ===');
{
  const INSTALL = read('scripts/install-windows-task.ps1');
  const UNINSTALL = read('scripts/uninstall-windows-task.ps1');
  check('there is a daily task', /Twin Visit Logger Parked Leads/.test(INSTALL), true);
  /* 13:00 — after the 10:45 sweep, well before the 15:45 one, so it queues behind nothing that matters. */
  check('...at 13:00, between the sweeps that matter', /\$parkedAt = "13:00"/.test(INSTALL), true);
  check('...and uninstalling removes it', UNINSTALL.includes('"Twin Visit Logger Parked Leads"'), true);
  check('the runner exists', fs.existsSync('twin-visit-logger-sandbox/scripts/sweep-parked.cmd'), true);
  const CMD = read('scripts/sweep-parked.cmd');
  check('...using the bundled Node', /runtime\\node\.exe/.test(CMD), true);
  check('...and the bundled Chromium', /PLAYWRIGHT_BROWSERS_PATH/.test(CMD), true);
  /*
   * The reasoning lives in the installer too, because that is where somebody will be when they wonder why a
   * ninth task exists and whether it can be deleted.
   */
  check('the installer says why this is not just added to the re-check',
    /roughly doubles REI page loads/.test(INSTALL), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
