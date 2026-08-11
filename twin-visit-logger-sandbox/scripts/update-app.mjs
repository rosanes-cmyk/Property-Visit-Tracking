/**
 * Check for an update, fetch it, and stage the swap.
 *
 *   node scripts/update-app.mjs              look only, and say what it found
 *   node scripts/update-app.mjs --install    fetch it and stage the swap
 *   node scripts/update-app.mjs --rollback   put the previous version back
 *
 * Normally reached by double-clicking scripts\update-app.cmd.
 *
 * WHY THE SWAP IS "STAGED" RATHER THAN DONE HERE
 *
 * On Windows a running process holds its own files open, so this script cannot replace the folder it is
 * executing from — the rename fails with a sharing violation, and a partial replacement is the one outcome
 * an updater must never produce. So it prepares everything, writes a tiny swap script, and that script runs
 * after this process has exited. The same reason installers on Windows so often end with "please close the
 * application".
 *
 * WHAT IT REFUSES TO DO
 *
 *   - install while a job is running (the run lock is held). Swapping files out from under a sweep that is
 *     driving a browser is how a browser profile gets corrupted, which on this project means REI logs you out.
 *   - install a version that is not newer.
 *   - install anything it could not verify — see downloadUpdate; a truncated zip is discarded, not installed.
 *
 * AND THE ONE THING TO KEEP IN MIND
 *
 * The Drive folder this reads is a code-execution path: whoever can write to it can run anything on the PC,
 * as the Windows user, with the Google token and the REI session sitting right there. It must be a folder only
 * the owner can edit. The script says so every time it runs, because it is the kind of thing that gets set up
 * once, shared "just for a minute", and never tightened again.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { checkForUpdate, downloadUpdate, installedVersion, UPDATE_FOLDER } from '../src/google/updates.mjs';

const args = process.argv.slice(2);
const INSTALL = args.includes('--install');
const ROLLBACK = args.includes('--rollback');
/*
 * Other processes the swap must wait for, as --wait-for 1234,5678.
 *
 * Needed because of how the button on the dashboard works. The dashboard server runs FROM the folder being
 * replaced, so it holds files open and `move` fails with a sharing violation — the update would appear to be
 * ready and then quietly not happen. Waiting for it too is the difference between a button that works and one
 * that half-works. Ignored entirely when the updater is run from a command line, where there is nothing else
 * to wait for.
 */
const WAIT_FOR = (() => {
  const i = args.indexOf('--wait-for');
  if (i < 0) return [];
  return String(args[i + 1] || '').split(',').map((n) => Number.parseInt(n, 10)).filter(Number.isFinite);
})();

const ROOT = path.resolve('.');
const PARENT = path.dirname(ROOT);
const PREVIOUS = path.join(PARENT, `${path.basename(ROOT)}.previous`);
const STAGE = path.join(PARENT, `${path.basename(ROOT)}.new`);
const UPDATES = path.resolve('./updates');

const line = () => console.log('-'.repeat(66));

/* ------------------------------------------------------------------- rollback */

if (ROLLBACK) {
  /*
   * The first thing I would want if an update went wrong, so it exists from the start rather than being added
   * after the first bad night. It is the same staged swap in reverse — this process cannot replace its own
   * folder either way.
   */
  try {
    await fs.access(PREVIOUS);
  } catch {
    console.log('\nThere is no previous version kept, so there is nothing to roll back to.');
    console.log(`Expected it at: ${PREVIOUS}`);
    process.exit(1);
  }
  const prevVersion = await installedVersion(PREVIOUS);
  console.log(`\nRolling back to ${prevVersion}.`);
  await writeSwapScript({ from: PREVIOUS, keepCurrentAs: STAGE, reason: `rollback to ${prevVersion}` });
  console.log('Ready. Close this window and the swap runs on its own.');
  process.exit(0);
}

/* ---------------------------------------------------------------------- check */

console.log('');
line();
console.log('  TWIN VISIT LOGGER — update');
line();

const installed = await installedVersion(ROOT);
console.log(`\n  Installed: ${installed}`);

const auth = await authorizeGoogle();
const drive = google.drive({ version: 'v3', auth });

const found = await checkForUpdate(drive, { root: ROOT });

if (found.error) {
  console.log(`\n  Could not check for updates: ${found.error}`);
  console.log('  Nothing was changed. Try again later — the automation is unaffected.');
  process.exit(1);
}
if (!found.available) {
  console.log(`\n  No update available — ${found.reason}.`);
  if (/no update folder/.test(found.reason || '')) {
    /*
     * Explained rather than reported, because this is the state on the very first run and it looks like a
     * fault. The security note goes here too: this is the moment somebody is about to create the folder.
     */
    console.log(`\n  To use updates, create a folder in your Google Drive called exactly:`);
    console.log(`      ${UPDATE_FOLDER}`);
    console.log('  and put a package in it named like  TwinVisitLogger-1.1.0.zip');
    console.log('\n  IMPORTANT: keep that folder private to you. Anything in it gets RUN on this PC,');
    console.log('  so anyone you share edit access with can run code on this machine.');
  }
  process.exit(0);
}

console.log(`  Available: ${found.version}   (${found.file.name}, ${Math.round(found.file.size / 1e6)} MB)`);

if (!INSTALL) {
  console.log('\n  Nothing has been downloaded. To install it:');
  console.log('      scripts\\update-app.cmd --install');
  console.log('\n  Or from the command line:  node scripts/update-app.mjs --install');
  process.exit(0);
}

/* -------------------------------------------------------------- refuse if busy */

/*
 * The run lock, checked BEFORE downloading rather than after. Downloading 200 MB and then refusing wastes
 * somebody's afternoon; and the check is cheap.
 *
 * Only a LIVE holder blocks. A lock left behind by a run that died would otherwise block updates for thirty
 * minutes — and "the updater says something is running, but nothing is" is exactly the kind of thing that
 * gets worked around by deleting files by hand.
 */
const lockPath = path.resolve('./data/run.lock');
try {
  const raw = await fs.readFile(lockPath, 'utf8');
  const pid = Number(/(\d+)/.exec(raw)?.[1]);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (e) { alive = e?.code === 'EPERM'; }
  if (alive) {
    console.log('\n  A job is running right now (REI is open), so this is not the moment to swap files.');
    console.log('  Swapping mid-sweep can corrupt the browser profile, which logs REI out.');
    console.log('\n  Wait a couple of minutes and run this again — or use scripts\\pause.cmd first,');
    console.log('  then update, then scripts\\resume.cmd.');
    process.exit(1);
  }
} catch { /* no lock file: nothing is running */ }

/* ------------------------------------------------------------------- download */

console.log('\n  Downloading…');
let got;
try {
  got = await downloadUpdate(drive, found.file, { into: UPDATES });
} catch (error) {
  /*
   * Verification failures land here and they are GOOD news: the check did its job. Said plainly, because
   * "checksum mismatch" reads like a crash rather than like a refusal that protected you.
   */
  console.log(`\n  The update was NOT installed: ${error.message}`);
  console.log('  Your app is untouched and still working. Re-upload the package and try again.');
  process.exit(1);
}
console.log(`  Downloaded ${Math.round(got.bytes / 1e6)} MB and verified it (${got.verified}).`);

/* ------------------------------------------------------------------ stage it */

console.log('\n  Preparing the swap…');
await fs.rm(STAGE, { recursive: true, force: true });
await fs.mkdir(STAGE, { recursive: true });

/*
 * Extracted with PowerShell rather than a zip library. Adding a dependency for this is a poor trade: the
 * updater must work on a machine where node_modules may be the very thing being replaced, and Expand-Archive
 * ships with Windows.
 */
const expand = await new Promise((resolve) => {
  const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath '${got.path}' -DestinationPath '${STAGE}' -Force`], { stdio: 'inherit' });
  child.on('error', (e) => resolve(-1));
  child.on('close', (code) => resolve(code));
});
if (expand !== 0) {
  console.log('\n  Could not unpack the update. Your app is untouched.');
  process.exit(1);
}

/*
 * The package contains a TwinVisitLogger folder, so the real payload is usually one level down. Handled
 * rather than assumed, because a package zipped from inside the folder and one zipped from outside it are
 * both things a person will produce, and the difference should not be an error message about a missing file.
 */
let payload = STAGE;
const entries = await fs.readdir(STAGE, { withFileTypes: true });
if (entries.length === 1 && entries[0].isDirectory()) payload = path.join(STAGE, entries[0].name);
try {
  await fs.access(path.join(payload, 'package.json'));
} catch {
  console.log('\n  That package does not look like the app — no package.json inside. Nothing was changed.');
  process.exit(1);
}

/*
 * The new version inherits this machine's IDENTITY, not the packager's: .env, the Google token, the REI
 * session and the local state stay. Without this an update would silently un-install the machine — both
 * sign-ins again, and the scheduled jobs failing in the meantime with a config error.
 */
const CARRY_OVER = ['.env', 'credentials', 'browser-data', 'data', 'logs'];
for (const item of CARRY_OVER) {
  const from = path.join(ROOT, item);
  try {
    await fs.access(from);
  } catch { continue; }
  await fs.rm(path.join(payload, item), { recursive: true, force: true });
  await fs.cp(from, path.join(payload, item), { recursive: true });
  console.log(`    kept ${item}`);
}

await writeSwapScript({ from: payload, keepCurrentAs: PREVIOUS, reason: `update to ${found.version}` });

line();
console.log(`  READY — ${installed} will be replaced by ${found.version}.`);
if (WAIT_FOR.length) console.log('\n  Close the DASHBOARD window to finish. The swap is waiting for it.');
console.log('\n  Close this window and the swap happens on its own, in a few seconds.');
console.log('  Your settings, logins and logs are carried over.');
console.log(`\n  If anything goes wrong:   scripts\\update-app.cmd --rollback`);
console.log(`  The old version is kept at: ${PREVIOUS}`);
line();

/* ------------------------------------------------------------------ the swapper */

/**
 * Write the script that does the actual move, and start it detached.
 *
 * It waits for this process to exit before touching anything — that wait is the entire reason the file
 * exists. Everything it does is a rename inside one parent folder, which is atomic enough that there is no
 * moment where neither version is present.
 */
async function writeSwapScript({ from, keepCurrentAs, reason }) {
  const swap = path.join(PARENT, 'twin-visit-logger-swap.cmd');
  const body = `@echo off
rem Written by scripts/update-app.mjs — ${reason}
rem
rem Waits for the updater to exit, because Windows will not let a process replace the folder it is running
rem from. Then three renames inside one parent folder: current -> previous, new -> current.
title Twin Visit Logger — finishing the update
echo.
echo   Finishing the update. This takes a few seconds.
${WAIT_FOR.length ? 'echo   Waiting for the dashboard window to be closed...\necho.' : 'echo.'}
:wait
${[process.pid, ...WAIT_FOR].map((pid) => `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul
if not errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)`).join('\n')}

if exist "${keepCurrentAs}" rmdir /s /q "${keepCurrentAs}"
move "${ROOT}" "${keepCurrentAs}" >nul
if errorlevel 1 (
  echo   COULD NOT MOVE THE CURRENT VERSION. Nothing was changed.
  echo   Close every Twin Visit Logger window and run the update again.
  pause
  exit /b 1
)
move "${from}" "${ROOT}" >nul
if errorlevel 1 (
  rem Put it back. A failure here would otherwise leave NO app at all, which is the one
  rem unacceptable outcome for an updater.
  move "${keepCurrentAs}" "${ROOT}" >nul
  echo   COULD NOT PUT THE NEW VERSION IN PLACE. The old one has been restored.
  pause
  exit /b 1
)

echo   Done. The scheduled jobs pick the new version up on their own.
echo.
timeout /t 4 /nobreak >nul
`;
  await fs.writeFile(swap, body, 'utf8');
  /*
   * Detached and unref'd, so it outlives this process — which is the point. `start` via cmd rather than
   * spawning the .cmd directly, because a detached child that shares this console dies with it.
   */
  const child = spawn('cmd.exe', ['/c', 'start', '""', '/min', swap], { detached: true, stdio: 'ignore' });
  child.unref();
}
