/**
 * The Windows installer.
 *
 *   node tests/installer.test.mjs
 *
 * Nothing here can run Inno Setup or Windows, so these are checks on the script's text — and they are aimed
 * squarely at the decisions that would be expensive to get wrong, because each one only fails on a real
 * machine after the .exe has been handed over.
 *
 * The biggest is WHERE it installs. Program Files is the reflex answer and it would break this app outright.
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
const ISS = read('installer/TwinVisitLogger.iss');
const BUILD = read('scripts/build-installer.ps1');

console.log('=== per-user, not Program Files ===');
/*
 * THE decision in this file.
 *
 * This app writes into its own folder constantly: logs, the run lock, the heartbeat the dashboard reads,
 * browser-data holding the REI session, and the entire folder being replaced by the updater. Under Program
 * Files each of those needs elevation — and scheduled tasks do not run elevated, so they would fail SILENTLY,
 * which is the failure mode this project has already been bitten by twice.
 */
check('it installs into LOCALAPPDATA', /DefaultDirName=\{localappdata\}\\TwinVisitLogger/.test(ISS), true);
check('...and asks for no administrator rights', /PrivilegesRequired=lowest/.test(ISS), true);
check('...and never targets Program Files', /\{pf\}|\{commonpf\}|Program Files\}/.test(ISS), false);
check('the reason is written down for whoever changes it next',
  /scheduled\r?\n; tasks do not run elevated, so they would fail silently/.test(ISS), true);
/* Per-user is also correct on its own terms: the automation needs THIS user's Google token and REI session. */
check('...including why per-user is right anyway',
  /needs this user's Google token and REI session/.test(ISS), true);

console.log('\n=== it finishes by actually setting the PC up ===');
/*
 * An installer that finishes leaving the app unconfigured has not installed anything — and the client's ask
 * was "once i installed the application in one pc all must go on like automatic once intall the app".
 */
check('setup runs at the end', /Filename: "\{app\}\\SET-UP-THIS-PC\.cmd"; Description:/.test(ISS), true);
check('...as a postinstall step', /Flags: postinstall shellexec skipifsilent/.test(ISS), true);
/* A checkbox, not forced: installing onto a spare PC to leave on standby is a legitimate thing to do. */
check('...but it can be declined', /shown as a checkbox rather than forced/.test(ISS), true);
check('the finish text says there are two sign-ins',
  /sign in to Google once and to REI once/.test(ISS), true);

console.log('\n=== shortcuts a person can actually use ===');
for (const [label, target] of [
  ['Set up this PC', 'SET-UP-THIS-PC.cmd'],
  ['Dashboard — is it working?', 'dashboard.cmd'],
  ['Sign in to REI again', 'login-rei.cmd'],
  ['Check for an update', 'update-app.cmd'],
  ['Make this PC the active one', 'make-this-pc-active.cmd'],
  ['Pause everything', 'pause.cmd']
]) {
  check(`"${label}" is in the Start menu`, ISS.includes(label) && ISS.includes(target), true);
}
/* Every shortcut needs WorkingDir: these scripts resolve everything relative to their own folder. */
const iconLines = ISS.split('\n').filter((l) => /^Name: "\{(group|autodesktop)\}/.test(l));
check('every shortcut sets a working directory',
  iconLines.every((l) => /WorkingDir:/.test(l)), true);
check('...and there are shortcuts at all', iconLines.length > 5, true);

console.log('\n=== uninstalling has to undo the right things ===');
/*
 * Tasks removed BEFORE the files, or Windows keeps eight tasks pointing at a folder that no longer exists,
 * each firing on its timer and failing forever.
 */
check('the scheduled tasks are removed', /uninstall-windows-task\.ps1/.test(ISS), true);
check('...as the current user, since that is who created them', /runascurrentuser/.test(ISS), true);
check('...and the ordering reason is stated',
  /pointing at a\r?\n; folder that no longer exists/.test(ISS), true);
/*
 * And the machine claim is HANDED BACK. Without this, uninstalling leaves the workbook still naming this PC
 * as active, so the next machine would refuse to take over — creating exactly the situation the client asked
 * about ("what if my pc got damage").
 */
check('the automation is released so another PC can take over',
  /make-this-pc-active\.mjs --release/.test(ISS), true);
check('...before the tasks are removed',
  ISS.indexOf('--release') < ISS.indexOf('uninstall-windows-task.ps1'), true);
check('...best effort, because an uninstall must not need a network',
  /an uninstall must not be blocked/.test(ISS), true);
check('...and skipped cleanly if the runtime is already gone', /skipifdoesntexist/.test(ISS), true);

console.log('\n--- what uninstalling must NOT destroy ---');
/*
 * Logs and caches go; the Google token, the REI session and .env stay. An uninstall that destroys those turns
 * "reinstall to fix something" into "sign in to everything again" — and this is a folder somebody may well
 * remove and reinstall while debugging.
 */
for (const gone of ['logs', 'data', 'updates', 'debug']) {
  check(`${gone} is cleaned up`, new RegExp(`Name: "\\{app\\}\\\\${gone}"`).test(ISS), true);
}
for (const kept of ['browser-data', 'credentials']) {
  check(`${kept} is left alone`, new RegExp(`UninstallDelete[\\s\\S]*Name: "\\{app\\}\\\\${kept}"`).test(ISS), false);
}
check('and that choice is explained', /silently destroys the Google token/.test(ISS), true);

console.log('\n=== the uninstaller script covers every task the installer creates ===');
/*
 * Checked against the installer itself rather than a hand-written list, so adding a ninth task cannot quietly
 * leave one behind. This has been wrong once already: the uninstaller listed two of four, so "Nothing is
 * scheduled any more" was untrue and the notes audit carried on writing statuses.
 */
{
  const INSTALL = read('scripts/install-windows-task.ps1');
  const UNINSTALL = read('scripts/uninstall-windows-task.ps1');
  const named = [...INSTALL.matchAll(/New-VisitTask -Name "([^"]+)"/g)].map((m) => m[1]);
  for (const name of named) check(`uninstall removes "${name}"`, UNINSTALL.includes(`"${name}"`), true);
  /* The three fixed pre-card sweeps are created by a loop calling schtasks, so they are named separately. */
  for (const at of ['0845', '1045', '1545']) {
    check(`uninstall removes the ${at} sweep`,
      UNINSTALL.includes(`Twin Visit Logger Sweep Before ${at}`), true);
  }
  check('the uninstaller no longer claims to delete "both" tasks', /Deletes both tasks/.test(UNINSTALL), false);
  /*
   * And it must NOT release the machine claim itself: this script is what somebody runs to stop the schedule
   * on a PC they are keeping, which is not the same as handing the automation to another machine.
   */
  check('stopping the schedule does not hand the automation away',
    /make-this-pc-active/.test(UNINSTALL.split('foreach')[0]) === false
      || /is not the same as handing/.test(UNINSTALL), true);
}

console.log('\n=== building it is one command, and degrades honestly ===');
check('the build script packages then compiles', /STEP 1 of 2[\s\S]*STEP 2 of 2/.test(BUILD), true);
/*
 * Inno Setup is not on PATH by default, so "iscc is not recognised" would send somebody looking for the wrong
 * problem. Its real install locations are checked first.
 */
check('the compiler is looked for where it actually installs',
  /Inno Setup 6\\ISCC\.exe/.test(BUILD), true);
check('...and PATH is only the fallback', /Get-Command iscc/.test(BUILD), true);
/*
 * A missing compiler is NOT a failed build. The portable folder is a perfectly good deliverable on its own,
 * and saying so beats an error that implies the whole thing did not work.
 */
check('a missing Inno Setup still leaves a usable folder',
  /The portable folder is ready and works on its own/.test(BUILD), true);
check('...with the link to install it', /jrsoftware\.org\/isdl\.php/.test(BUILD), true);
check('...and it exits distinguishably, not as a hard failure', /exit 2/.test(BUILD), true);
check('a failed package does not go on to compile', /Nothing was compiled/.test(BUILD), true);
check('a missing packaged folder is caught before compiling', /No packaged folder at/.test(BUILD), true);
/* Around a gigabyte of payload, so the 32-bit compressor would fail outright. */
check('the installer is built 64-bit', /ArchitecturesInstallIn64BitMode=x64compatible/.test(ISS), true);
check('the payload is copied recursively', /recursesubdirs createallsubdirs/.test(ISS), true);
/* A stable AppId is what makes the next version upgrade in place rather than installing alongside. */
check('the AppId is fixed, so updates replace rather than stack',
  /AppId=\{\{[0-9A-F-]{36}\}/i.test(ISS), true);


console.log('\n=== the shortcuts an unzipped install never got ===');
/*
 * The client, handed a full path to paste for the third time: "but thewhy do i need to type that?"
 *
 * They should not have to, and installer\TwinVisitLogger.iss already creates exactly these shortcuts. But
 * the installer was never built — this PC was set up by unzipping into C:\TwinVisitLogger\... — so there was
 * no Start-menu entry and no icons, and every instruction became a 120-character path pasted into a black
 * window. One of those pastes duplicated itself into "hostnamehostname".
 */
{
  const PS = fs.readFileSync('twin-visit-logger-sandbox/scripts/make-shortcuts.ps1', 'utf8');
  const CMD = fs.readFileSync('twin-visit-logger-sandbox/scripts/make-shortcuts.cmd', 'utf8');

  /* Double-clickable, or it does not solve the problem it exists for. */
  check('there is a .cmd to double-click', CMD.includes('make-shortcuts.ps1'), true);
  check('...that does not need an execution policy typed', /-ExecutionPolicy Bypass/.test(CMD), true);
  check('...and stays open so the output can be read', /^pause$/m.test(CMD), true);

  /* Every shortcut must point at a runner that is really in the package. */
  const targets = [...PS.matchAll(/"(scripts\\[a-z-]+\.cmd)"/g)].map((m) => m[1].replace('\\', '/'));
  check('it makes several shortcuts', targets.length >= 5, true);
  const missing = targets.filter((t) => !fs.existsSync(`twin-visit-logger-sandbox/${t}`));
  check('every target exists', missing.join(', '), '');

  /* The three that answer the three things that actually go wrong, in the order they are needed. */
  for (const [n, runner] of [['1', 'login-rei.cmd'], ['2', 'recheck-buckets.cmd'], ['3', 'fill-pending.cmd']]) {
    check(`"${n} - ..." points at ${runner}`, new RegExp(`"${n} - [^"]+"\\s*=\\s*"scripts\\\\${runner}"`).test(PS), true);
  }

  /*
   * A shortcut to a file that is not there is worse than no shortcut: it looks like the feature exists and
   * fails only when somebody is relying on it.
   */
  check('a missing runner is skipped, not linked to', /if \(-not \(Test-Path \$target\)\)/.test(PS), true);
  check('...and says which one', /Skipped '\{0\}'/.test(PS), true);

  /* The installer's own list must offer the same things, or the two disagree and the wrong one is in front of somebody. */
  const ISS = fs.readFileSync('twin-visit-logger-sandbox/installer/TwinVisitLogger.iss', 'utf8');
  for (const runner of ['login-rei.cmd', 'dashboard.cmd', 'update-app.cmd']) {
    check(`the installer also offers ${runner}`, ISS.includes(runner), true);
  }
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
