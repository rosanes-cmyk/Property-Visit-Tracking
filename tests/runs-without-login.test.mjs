/**
 * The script that ends the sign-in dependency is safe to run.
 *
 *   node tests/runs-without-login.test.mjs
 *
 * WHY THIS EXISTS. Every outage this system has had was the same fault, and never the code: tasks created
 * by `schtasks /Create` with no credentials run ONLY while somebody is signed in to Windows. A 2am update
 * reboot lands on the sign-in screen and every job stops -- while Task Scheduler still reports Ready and
 * Last Result 0, because a task that never fired cannot fail. Measured on the client's server on 14
 * October: booted 2:15 AM, nothing ran until a person signed in at 2:55 PM. Thirteen hours.
 *
 * This file does not run PowerShell -- there is none in this container, and the script has to be run on
 * the server anyway. What it guards is the shape of the thing: that converting is reversible, that it
 * starts with one task rather than eleven, and above all that the password is never written anywhere this
 * project can read it. A credential leaked into a log or the repository would be a far worse bug than the
 * outage it fixes.
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
const RAW = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/run-without-login.ps1'), 'utf8');
/* Comment-stripped: this project has had five assertions satisfied by the prose explaining a fix rather
   than the fix, and the header here names both the old behaviour and the new one. */
const CODE = RAW.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');

console.log('=== the password cannot leak ===');
/*
 * The one thing that must be true. It is read as a SecureString, converted only to hand to Windows, and
 * dropped immediately. Nothing may write it to a file, a log, the console or a command line.
 */
check('the password is read as a SecureString', /Read-Host[^\n]*-AsSecureString/.test(CODE), true);
check('...and is cleared as soon as Windows has it', /\$plain = \$null/.test(CODE), true);
check('it is never echoed', /Write-Host[^\n]*\$plain/.test(CODE), false);
check('it is never written to a file', /(Out-File|Set-Content|Add-Content|Export-)[^\n]*\$plain/.test(CODE), false);
/*
 * schtasks /RP puts the password in a command line, which is visible to other processes and lands in
 * transcripts. Set-ScheduledTask -Password passes it in-process instead.
 */
check('it is not passed on a command line via schtasks /RP', /schtasks[^\n]*\/RP/.test(CODE), false);
check('Windows is handed it through Set-ScheduledTask', /Set-ScheduledTask[^\n]*-Password \$plain/.test(CODE), true);

console.log('\n=== it starts with one task, not eleven ===');
/*
 * With nobody signed in there is no desktop, and REI is read through a browser. It should work -- the
 * browser already runs headless -- but "should" is not a thing to bet eleven jobs on at once.
 */
check('the default is a single-task test', /\[CmdletBinding\(DefaultParameterSetName = 'Test'\)\]/.test(CODE), true);
check('the test task is the 20-minute re-check, which proves itself fastest',
  /\$TESTTASK\s*=\s*'Twin Visit Logger REI Recheck'/.test(CODE), true);
check('converting everything needs an explicit -All', /\[Parameter\(ParameterSetName = 'All'\)\]\[switch\]\$All/.test(CODE), true);

console.log('\n=== it is reversible ===');
check('-Undo exists', /\[Parameter\(ParameterSetName = 'Undo'\)\]\[switch\]\$Undo/.test(CODE), true);
/*
 * Reverting is Set-ScheduledTask with a user and NO password: that puts the principal back to
 * InteractiveToken, which is exactly how the installer created them.
 */
check('...and reverts by dropping the password, back to interactive',
  /Set-ScheduledTask -TaskName \$t\.TaskName -User \$me -ErrorAction Stop/.test(CODE), true);
check('the revert instruction is printed after every conversion',
  /run-without-login\.ps1 -Undo/.test(CODE), true);

console.log('\n=== it cannot quietly do nothing ===');
check('it refuses when no Twin Visit Logger task exists', /throw "No '\$PREFIX' tasks found/.test(CODE), true);
check('it refuses an empty password rather than converting with none',
  /if \(-not \$plain\) \{ throw/.test(CODE), true);
check('a task it could not convert is reported, not swallowed', /\$failed \+= \$t\.TaskName/.test(CODE), true);
/*
 * NAME THE REAL CAUSE. This printed "the usual cause is that this PowerShell is not elevated" whatever
 * Windows had actually said -- and the first time it fired, Windows had said "The user name or password
 * is incorrect" on all ten lines. Sending somebody to re-open PowerShell as administrator when the answer
 * is "you typed one character too many" is the same fault this script exists to end: a confident message
 * pointing at the wrong thing.
 */
check('it keeps the reason Windows gave', /\$reasons \+= \$msg/.test(CODE), true);

/*
 * THE ONE THAT MATTERS MOST, and it was learned the hard way.
 *
 * The loop used to try the same password against every task in turn, so ONE mistyped character became ten
 * failed Windows logon attempts in a couple of seconds -- which tripped the account lockout policy on the
 * client's server:
 *
 *     FAILED  Twin Visit Logger Notes Audit: The referenced account is currently locked out
 *             and may not be logged on to.
 *
 * That is worse than the fault this script exists to fix. With the account locked nobody can sign in to
 * that machine at all. A wrong password is a user slip; turning it into a lockout was a bug here.
 */
check('a refused password stops the run instead of being retried on every task',
  /if \(\$credBad\) \{ break \}/.test(CODE), true);
check('...and the credential failures that trigger that include a lockout',
  /\$credBad = \$true/.test(CODE) && /locked out'\)/.test(CODE), true);
check('...and it says why it stopped', /can lock the Windows account/.test(CODE), true);
check('a locked-out account is told not to sign out', /DO NOT SIGN OUT/.test(CODE), true);
check('...and is given both the wait and the unlock', /lusrmgr\.msc/.test(CODE) && /net accounts/.test(CODE), true);
check('...and names a rejected password as a password problem',
  /user name or password is incorrect\|logon failure/.test(CODE), true);
check('...and a refusal to change as an elevation problem',
  /Access is denied\|not authorized\|requires elevation/.test(CODE), true);
check('...with a fallback when it is neither', /Windows gave the reason on each line above/.test(CODE), true);
/*
 * A run that converted nothing must not print the celebratory next steps under its own warning. It did,
 * and the screen read as though it had worked.
 */
check('a run that converted nothing says so and stops',
  /Nothing was changed\. The jobs are exactly as they were\./.test(CODE), true);
check('it prints the state of every task before changing anything', /Current state:/.test(CODE), true);

console.log('\n=== it leaves the rest of the task alone ===');
/*
 * The installer sets a 20-minute kill limit and undoes three battery defaults that once stopped the
 * schedule for two days. Re-registering a task from scratch would discard them; Set-ScheduledTask changes
 * only the principal.
 */
check('it changes only the principal, never re-registers the task',
  /Register-ScheduledTask/.test(CODE), false);
check('...and never rewrites the schedule', /schtasks[^\n]*\/Create/.test(CODE), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
