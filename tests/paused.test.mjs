/**
 * The pause switch.
 *
 *   node tests/paused.test.mjs
 *
 * The client, mid-debugging: "can we stop the auto update, we need to pause this for now, we have bug in
 * the system and auto update not need for now."
 *
 * Why this is not "disable the scheduled task": on this machine `schtasks /Change /DISABLE` answered
 * "Access is denied" for one of the two tasks — so the documented way of stopping it did not work, and
 * left the other task switched off while it failed. The project already wrote the conclusion down once,
 * over WhatsApp: a disabled scheduled task is not an off switch, because anyone can run the command by
 * hand. So the switch lives in the code, and these tests hold every entry point to it.
 */
import { pauseReason, haltForPause, PAUSE_FILE } from '../twin-visit-logger-sandbox/src/utils/paused.mjs';
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== two ways to pause, because they suit different people ===');
check('the .env flag pauses',
  pauseReason({ env: { AUTOMATION_PAUSED: 'true' }, exists: false }), 'AUTOMATION_PAUSED is set in .env');
check('the file pauses', pauseReason({ env: {}, exists: true }), `the file ${PAUSE_FILE} exists`);
check('neither means running', pauseReason({ env: {}, exists: false }), '');
/* The spellings a person actually types. "1" and "on" are as much a yes as "true". */
for (const v of ['true', 'TRUE', 'yes', 'on', '1', ' true ']) {
  check(`"${v}" pauses`, pauseReason({ env: { AUTOMATION_PAUSED: v }, exists: false }) !== '', true);
}
/* And the ones that must NOT, or a line left in .env reading AUTOMATION_PAUSED=false would pause it. */
for (const v of ['false', 'no', 'off', '0', '', 'maybe']) {
  check(`"${v}" does not pause`, pauseReason({ env: { AUTOMATION_PAUSED: v }, exists: false }), '');
}
check('an unset variable does not pause', pauseReason({ env: {}, exists: false }), '');

console.log('\n--- both set reports both ---');
/*
 * Not cosmetic. Somebody who deletes the file, sees it still paused, and is told only "the file exists"
 * has been sent to look at the wrong thing — which reads as a switch that does not work.
 */
check('both reasons are named',
  pauseReason({ env: { AUTOMATION_PAUSED: '1' }, exists: true }),
  `AUTOMATION_PAUSED is set in .env and the file ${PAUSE_FILE} exists`);

console.log('\n=== halting, and the one thing that gets through ===');
const said = [];
const log = (m) => said.push(String(m));
check('a paused run halts',
  haltForPause({ env: { AUTOMATION_PAUSED: '1' }, exists: false, log }), true);
check('...and says so plainly', said.some((l) => /PAUSED/.test(l)), true);
check('...and says nothing happened', said.some((l) => /Nothing was read, written or posted/.test(l)), true);
check('...and says how to resume', said.some((l) => /resume\.cmd/.test(l)), true);
check('...and how to override just this once', said.some((l) => /--force/.test(l)), true);

said.length = 0;
/*
 * --force is the whole reason a pause is safe to leave on. Pausing is about the automation acting
 * unattended; it must not stop the person debugging it from checking one lead.
 */
check('a typed --force run is not halted',
  haltForPause({ force: true, env: { AUTOMATION_PAUSED: '1' }, exists: false, log }), false);
check('...but it is told the pause is on', said.some((l) => /PAUSED/.test(l) && /--force/.test(l)), true);

said.length = 0;
check('an unpaused run is not halted', haltForPause({ env: {}, exists: false, log }), false);
check('...and says nothing at all', said.length, 0);

console.log('\n=== every entry point honours it, before the lock and before any I/O ===');
/*
 * The check is worthless if a script forgets it, and worse than worthless if it runs after the browser is
 * open or the sheet is read — a pause that still opens REI and still holds the lock is not a pause.
 */
const read = (p) => fs.readFileSync(path.resolve('twin-visit-logger-sandbox', p), 'utf8');
for (const file of ['scripts/recheck-rei.mjs', 'src/run-once.mjs', 'src/whatsapp/watch.mjs']) {
  const src = read(file);
  check(`${file} checks the pause`, /haltForPause\(/.test(src), true);
  check(`${file} honours --force`, /--force/.test(src), true);
  check(`${file} checks it BEFORE taking the lock`,
    src.indexOf('haltForPause(') < src.indexOf('await acquireLock'), true);
}

console.log('\n--- the commands a non-developer actually runs ---');
const PAUSE = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/pause.cmd'), 'utf8');
const RESUME = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/resume.cmd'), 'utf8');
check('pause.cmd writes the flag file', /data\\PAUSED/.test(PAUSE), true);
check('resume.cmd deletes it', /del \/q data\\PAUSED/.test(RESUME), true);
/*
 * Resuming has to check .env too. Deleting the file while AUTOMATION_PAUSED=true is still set leaves it
 * paused, and somebody who has just been told "RESUMED" will not look at the config again.
 */
check('resume.cmd warns when .env still pauses it', /AUTOMATION_PAUSED/.test(RESUME), true);
/*
 * The digest is posted by Apps Script from Google's own timers, not from this PC, so pausing here does
 * NOT stop it. Saying so on screen is the difference between a pause and a false sense of one.
 */
check('pause.cmd says the Chat digest is not covered', /Apps Script/.test(PAUSE), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
