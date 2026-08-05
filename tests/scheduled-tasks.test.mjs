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

console.log('\n=== The re-check interval ===');
/*
 * Two hours matches the short clock in recheck.mjs for a visit whose date has passed while the row still
 * says Scheduled — the case where the board is actively wrong about today. Tighter than that just opens
 * browser pages for leads nothing has changed about.
 */
check('defaults to 2 hours', /\[int\]\$RecheckIntervalMinutes = 120/.test(INSTALL), true);
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

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
