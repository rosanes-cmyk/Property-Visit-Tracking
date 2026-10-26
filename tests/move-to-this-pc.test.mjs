/**
 * Moving the automation to a new PC does not repeat the faults the last two moves found.
 *
 *   node tests/move-to-this-pc.test.mjs
 *
 * WHY THIS EXISTS. The automation has now been moved between machines twice, and each move cost a day to
 * something nobody could see. None of it was clever; all of it is in this script because it happened:
 *
 *   - installed under Downloads, where Windows flags every file as internet-downloaded
 *   - Mark of the Web on a .cmd, so a hidden scheduled task sat for two days at Running / 0x800710E0
 *     waiting for a security dialog nobody could click
 *   - a machine that slept, and therefore ran nothing and reported nothing
 *   - Windows rebooting for an update and landing on the sign-in screen, with every job stopped and
 *     every task still reading Ready
 *
 * This asserts the shape of the script rather than running it -- there is no PowerShell in this container
 * and it has to run on the new server anyway -- against comment-stripped source, because this project has
 * had five assertions satisfied by the prose explaining a fix rather than the fix.
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
const RAW = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/move-to-this-pc.ps1'), 'utf8');
const CODE = RAW.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');

console.log('=== the Google token is never carried between machines ===');
/*
 * The project's own rule, and the one with teeth: a token belongs to the PC that signed in. Two machines
 * holding one session ends with one silently losing it, and that reads as "Google stopped working"
 * rather than "somebody copied a file".
 */
check('a copied token.json is removed', /Remove-Item -Path \$token -Force/.test(CODE), true);
check('...and the PC is told it will sign in for itself', /this PC signs in for itself/.test(CODE), true);
/*
 * credentials.json is the opposite: it MUST come across, and a missing one fails later, during the
 * Google step, where the cause is no longer obvious.
 */
check('a missing credentials.json is reported before the Google step',
  /credentials\\credentials\.json is MISSING/.test(CODE), true);
check('...and is never deleted', /Remove-Item[^\n]*\$cred\b/.test(CODE), false);

console.log('\n=== the folder cannot be somewhere Windows will sabotage ===');
check('Downloads, OneDrive and Temp are refused',
  /\$bad = @\('\\Downloads', '\\OneDrive', '\\AppData\\Local\\Temp', '\\Temp'\)/.test(CODE), true);
check('...and it throws rather than warning', /throw @"[\s\S]*not a safe home/.test(CODE), true);

console.log('\n=== Mark of the Web cannot hang a hidden task ===');
check('every file in the folder is unblocked', /Get-ChildItem -Path \$app -Recurse -File/.test(CODE), true);
check('...using Unblock-File', /Unblock-File -Path \$_\.FullName/.test(CODE), true);
check('...and the count is reported, so a silent zero is visible', /unblocked \{0\} file/.test(CODE), true);

console.log('\n=== the machine stays awake and comes back by itself ===');
check('sleep is turned off on mains power', /powercfg \/change standby-timeout-ac 0/.test(CODE), true);
check('...and so is hibernate', /hibernate-timeout-ac 0/.test(CODE), true);
/*
 * 0 means ENABLED for this policy. Setting it to 1 would disable the thing we want, so the value matters
 * more than the name suggests.
 */
check('automatic sign-in after a restart is ENABLED (0, not 1)',
  /Name 'DisableAutomaticRestartSignOn' -Value 0 -Type DWord/.test(CODE), true);
check('...and the Settings half is named too, since the policy alone is not enough on Windows 11',
  /Sign-in options/.test(CODE), true);

console.log('\n=== it refuses rather than half-moving ===');
check('a missing Node stops the run', /Node\.js is not installed on this PC/.test(CODE), true);
check('a failed npm install stops the run', /throw "npm install failed/.test(CODE), true);
check('a failed browser download stops the run', /throw "npm run install-browser failed/.test(CODE), true);

console.log('\n=== it hands off, and names what a person still has to do ===');
check('it prints the take-over command', /setup-app\.mjs --sheet/.test(CODE) && /--take-over/.test(CODE), true);
check('...and the reboot-proofing that follows it', /run-without-login\.ps1 -Test/.test(CODE), true);
/*
 * The old PC must stop driving REI. The workbook claim already makes it stand down, but two machines on
 * one REI login is what logs the account out, so the belt-and-braces step is spelled out.
 */
check('...and tells the OLD PC to stand down', /schtasks \/Change \/DISABLE/.test(CODE), true);
check('...and ends with a way to check it worked', /health-check\.mjs/.test(CODE), true);
/*
 * Neither secret may be automated: the Google consent is what makes the token the client's, and storing
 * the REI password would copy it onto every machine this is ever installed on.
 */
check('it says plainly that the two sign-ins need a person', /Neither can be automated/.test(CODE), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
