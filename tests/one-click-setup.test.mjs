/**
 * The folder you copy to a new server sets that server up in one double-click.
 *
 *   node tests/one-click-setup.test.mjs
 *
 * WHY THIS EXISTS. The client asked for "a file folder that can copy if moving the server, 1 click only
 * and working" -- after a move that took most of a day and went wrong at five separate points: the app
 * landed in a folder Windows sabotages, files arrived carrying the Mark of the Web, credentials.json was
 * missing and failed late, the jobs were registered to run only while somebody was signed in, and the
 * password prompt was hit from a non-elevated window so it reported "Access is denied" after converting
 * nothing.
 *
 * SET-UP-THIS-PC.cmd now covers every one of those. This asserts it still does, because the whole value
 * of a one-click installer is that nobody reads it before running it.
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
/* Comment-stripped: the header explains the fault each step exists for, and this project has had six
   assertions satisfied by prose rather than code. */
const SETUP = read('SET-UP-THIS-PC.cmd').replace(/^\s*rem\b.*$/gim, '');
const PACK = read('scripts/make-portable.ps1');

console.log('=== one double-click, start to finished ===');
/*
 * Elevation first. Two steps need admin, and discovering that three commands in -- after typing a
 * password that then gets refused -- is exactly how the last move went.
 */
check('it asks for administrator itself rather than failing later',
  /net session >nul 2>&1/.test(SETUP) && /-Verb RunAs/.test(SETUP), true);
check('it prepares Windows before anything else', /move-to-this-pc\.ps1/.test(SETUP), true);
check('...skipping the install the package already carries', /-SkipInstall/.test(SETUP), true);
check('it signs in and schedules', /setup-app\.mjs/.test(SETUP), true);
check('it makes the jobs survive a restart', /run-without-login\.ps1" -All/.test(SETUP), true);

console.log('\n=== it stops rather than half-installing ===');
check('a failed preparation stops the run', /Preparation stopped/.test(SETUP), true);
check('a failed setup stops the run', /Setup did not finish/.test(SETUP), true);
check('a source checkout is told to npm install first', /no node_modules/.test(SETUP), true);

console.log('\n=== the package cannot become a credential ===');
/*
 * An allow-list, and then a leak check over what was actually copied. A deny-list is one forgotten
 * folder away from shipping the REI session, and the failure is silent: the package works perfectly
 * and is a way into the account.
 */
check('the copy list is an allow-list', /\$include = @\("src", "scripts", "config"/.test(PACK), true);
check('...and the result is scanned for secrets anyway',
  /\$forbidden = @\("\.env", "token\.json", "credentials\.json"\)/.test(PACK), true);
check('...including a stray REI session', /browser-data/.test(PACK), true);
check('...and it refuses to build rather than warning', /REFUSING TO CONTINUE/.test(PACK), true);

console.log('\n=== the one manual step is explained up front ===');
/*
 * credentials.json is excluded on purpose, and that exclusion is what cost an hour on the last move
 * because nobody knew where to get it. The README now says exactly where, before the install step.
 */
check('the read-me says to add credentials.json first',
  /BEFORE YOU START - one file has to be put in by hand/.test(PACK), true);
check('...and where to get it', /OAuth 2\.0 Client IDs/.test(PACK), true);
check('...and why it is not in the package', /would make\s*\r?\nthis folder itself a credential/.test(PACK), true);
check('the Windows password is explained, not just demanded',
  /WHY IT ASKS FOR THE WINDOWS PASSWORD/.test(PACK), true);
check('...including that it is skippable', /Skip the step if you prefer/.test(PACK), true);

console.log('\n=== both new scripts actually travel in the package ===');
/*
 * They live in scripts\, which is copied whole -- so this guards the thing that would silently break it:
 * somebody narrowing the allow-list to individual files.
 */
check('the whole scripts folder is copied, so new ones are included by default',
  /"scripts"/.test(PACK), true);
for (const f of ['scripts/move-to-this-pc.ps1', 'scripts/run-without-login.ps1']) {
  check(`${f} exists to be copied`, fs.existsSync(path.resolve('twin-visit-logger-sandbox', f)), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
