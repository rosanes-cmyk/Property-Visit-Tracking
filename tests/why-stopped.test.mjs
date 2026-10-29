/**
 * One command answers "why has it stopped", and names a cause rather than a symptom.
 *
 *   node tests/why-stopped.test.mjs
 *
 * WHY THIS EXISTS. Every outage this system has had was diagnosed by the client pasting six or seven
 * commands at my request, one at a time, reading the output back and waiting for the next list. That is
 * the wrong shape of help, and they said so: "YOU KNOW I DONT WANT TO BLE LIKE THIS ALWAYS."
 *
 * So why-stopped.mjs checks every fault this project has actually hit, in one run. What this file guards
 * is the two properties that make it worth running: it must never make things worse, and its verdict must
 * point at a CAUSE. The first draft failed the second test -- on a fresh install it announced "Booking
 * emails has not run" while the real answer, credentials.json missing, sat four lines below it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
const SRC = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/why-stopped.mjs'), 'utf8');
/* Comment-stripped: the header names every fault and the old broken behaviour, and this project has had
   seven assertions satisfied by prose about a fix rather than the fix. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== it cannot make an outage worse ===');
/*
 * A diagnostic run during an incident must not take the lock, open REI, or write anything. The one that
 * does is the one you cannot run while the problem is happening -- which is the only time you want it.
 */
check('it never takes the REI lock', /acquireLock/.test(CODE), false);
check('it never opens a browser', /launchReiContext|chromium/.test(CODE), false);
check('it never writes a file', /writeFile|appendFile|Set-Content/.test(CODE), false);
check('...and never touches the sheet', /spreadsheets|googleapis/.test(CODE), false);
check('it refuses politely from the wrong folder', /This is not the app folder/.test(CODE), true);

console.log('\n=== the verdict names a cause, not a symptom ===');
check('findings carry a rank', /const RANK = \{/.test(CODE), true);
check('...and the verdict is sorted by it', /\.sort\(\(a, b\) => a\.rank - b\.rank\)/.test(CODE), true);
/*
 * The specific bug: five "job X has not run" lines above the reason none of them could.
 */
check('symptoms are dropped once their cause is named', /rootNamed && f\.rank === RANK\.jobLate/.test(CODE), true);
check('a job being late ranks below every structural cause',
  /jobLate: 80/.test(CODE) && /google: 20/.test(CODE) && /interactive: 40/.test(CODE), true);

console.log('\n=== it checks every fault this project has actually hit ===');
for (const [what, re] of [
  ['the pause flag in .env, which no monitor reads', /AUTOMATION_PAUSED/],
  ['the pause FILE as well, since either one stops jobs', /data\/PAUSED/],
  ['a run wedged holding the REI browser', /has held the REI browser/],
  ['tasks that only run while somebody is signed in', /ONLY while somebody is signed in/],
  ['tasks that have been disabled', /scheduled tasks are DISABLED/],
  ['REI having signed itself out', /login page/],
  ['a missing Google credentials file', /credentials\.json is missing/],
  ['the sweep stamp the Chat cards wait on', /the work-queue cards hold at 90 minutes/],
  ['a browser killed without saving its cookies', /CONTEXT NEVER CLOSED/],
  ['a recent restart, which explains a quiet hour', /restarted/],
]) check(`it checks for ${what}`, re.test(CODE), true);

/*
 * The diverted-log case cost two days: when the shared log is held open a run writes
 * logs\<name>-<random>.log instead, and a check reading only the shared file calls that "never ran".
 */
check('it reads diverted logs too, not just the shared one',
  /f\.startsWith\(base \+ '-'\)/.test(CODE), true);

console.log('\n=== it runs ===');
let out = '';
try {
  out = execFileSync(process.execPath, ['scripts/why-stopped.mjs'],
    { cwd: path.resolve('twin-visit-logger-sandbox'), encoding: 'utf8', timeout: 60000 });
} catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
check('it produces a verdict', /MOST LIKELY CAUSE|NOTHING IS WRONG/.test(out), true);
check('...and does not crash', /TypeError|ReferenceError|ENOENT/.test(out), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
