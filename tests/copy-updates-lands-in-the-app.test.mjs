/**
 * CopyUpdates.cmd cannot corrupt itself mid-run, and cannot silently install into the wrong folder.
 *
 *   node tests/copy-updates-lands-in-the-app.test.mjs
 *
 * Two faults from one screenshot of a live run, and the quieter one was much the worse.
 *
 * ONE — it overwrote itself while running.
 *
 *     'PIED' is not recognized as an internal or external command
 *     '"}"' is not recognized as an internal or external command
 *
 * cmd.exe reads a batch file FROM DISK as it executes, keeping a byte offset between lines. This script has
 * 'CopyUpdates*.cmd' in its own map, so it replaced the file it was running from. That was harmless while
 * the new copy was byte-identical; the moment it changed length, cmd resumed at its saved offset inside a
 * DIFFERENT file and landed mid-line — "COPIED" minus its first two characters, then a fragment of the
 * PowerShell block. Every copy above it had already succeeded, so a finished job looked like a crash.
 *
 * TWO — every copy reported success, into a folder nothing runs from.
 *
 *     to:   C:\Users\bryan\Downloads\twin-visit-logger-sandbox\twin-visit-logger-sandbox
 *
 * A freshly unzipped archive in Downloads, nested twice, with no .env. Nine COPIED lines, not one of them
 * reaching the app the scheduled tasks run. The REI logout fix appeared to install and changed nothing.
 *
 * That is this project's signature failure — a confident success that reached nobody — and it is why the
 * guard asks rather than trusts, and why WhereIsTheApp.cmd reads the path out of Windows itself instead of
 * anybody having to know which identical-looking folder is real.
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

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
/* cmd comments are `rem`, so the usual JS-comment stripper is no use here. */
const code = (s) => s.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');

const CMD = read('twin-visit-logger-sandbox/scripts/CopyUpdates.cmd');
const BODY = code(CMD);
const WHERE = read('twin-visit-logger-sandbox/scripts/WhereIsTheApp.cmd');

console.log('=== It runs from a staged copy, so it never overwrites the file it is executing ===');
check('the staged pass is recognised by its first argument', /if \/i "%~1"=="__staged" goto :run/.test(BODY), true);
check('it copies itself into TEMP', /copy \/y "%~f0" "%STAGE%\\CopyUpdates\.cmd"/.test(BODY), true);
check('...and calls THAT copy', /call "%STAGE%\\CopyUpdates\.cmd" __staged "%~dp0\.\."/.test(BODY), true);
/*
 * The exit matters as much as the call. Without it the first pass would fall through into :run and do the
 * work twice — the second time from the file that had just been replaced, which is the original bug again.
 */
check('...and then stops, rather than falling into the work',
  /call "%STAGE%\\CopyUpdates\.cmd" __staged "%~dp0\.\."\s*\nexit \/b/.test(BODY), true);
check('the staged run is handed the app folder, since %~dp0 is TEMP there',
  /if \/i "%~1"=="__staged" \(cd \/d "%~2"\) else \(cd \/d "%~dp0\.\."\)/.test(BODY), true);
// If staging fails it must still work, just with the old risk — a broken TEMP cannot block an update.
check('a failed staging falls back to running in place', /if errorlevel 1 \(/.test(BODY), true);
check('...and says the trailing error is harmless if it happens',
  /everything\s*\r?\n\s*echo\s+above that line still copied correctly/.test(CMD), true);
// The self-update is still in the map — that is the point of staging, not something to remove.
check('it still updates itself', /'CopyUpdates\*\.cmd'\s+= 'scripts\\CopyUpdates\.cmd'/.test(BODY), true);

console.log('\n=== It refuses to install into something that is not the app ===');
check('a missing .env is caught', /if not exist "%APP%\\\.env" set "SUSPECT=/.test(BODY), true);
check('a Downloads path is caught', /find \/i "\\Downloads" >nul && set "SUSPECT=/.test(BODY), true);
/*
 * No trailing backslash in that pattern on purpose: the live case was a folder INSIDE Downloads, but
 * Downloads itself is just as wrong, and "\Downloads\" would have missed it.
 */
check('...including Downloads itself, not only folders inside it',
  /find \/i "\\Downloads\\"/.test(BODY), false);
check('it stops before copying anything', BODY.indexOf('SUSPECT') < BODY.indexOf('$map = [ordered]'), true);
check('it names what is wrong, not just that something is',
  /\*\* WAIT — %SUSPECT%\. \*\*/.test(CMD), true);
check('it says why copying here would be pointless',
  /would report success and change nothing that actually runs/.test(CMD), true);
check('it points at WhereIsTheApp.cmd', /double-click  scripts\\WhereIsTheApp\.cmd/.test(CMD), true);
/*
 * It ASKS rather than refuses. Somebody may genuinely be setting up a new copy, and a tool that flatly
 * says no to a thing you meant to do is a tool people learn to work around.
 */
check('the answer is a choice, not a refusal', /choice \/C YN \/N \/M/.test(BODY), true);
check('...and N really does copy nothing', /if errorlevel 2 \(/.test(BODY), true);
check('...saying so plainly', /Nothing was copied\./.test(CMD), true);

console.log('\n=== WhereIsTheApp reads the path out of Windows, rather than guessing ===');
check('the script exists', fs.existsSync(path.resolve('twin-visit-logger-sandbox/scripts/WhereIsTheApp.cmd')), true);
check('it asks the scheduled task', /Get-ScheduledTask -TaskName \$n/.test(WHERE), true);
check('...for the task the installer actually creates', /'Twin Visit Logger Sandbox'/.test(WHERE), true);
check('it derives the app folder from the launcher path', /run-hidden\\?\.vbs/.test(WHERE), true);
check('...two levels up, which is where the launcher sits',
  /Split-Path \(Split-Path \$m\.Groups\['p'\]\.Value\)/.test(WHERE), true);
// The same .env test, so the two scripts cannot disagree about what counts as an install.
check('it confirms the folder is configured', /Test-Path \(Join-Path \$app '\.env'\)/.test(WHERE), true);
check('...and says so when the TASK itself points somewhere unconfigured',
  /the task points at an unconfigured folder/.test(WHERE), true);
check('it prints the exact CopyUpdates.cmd to run',
  /Join-Path \$app 'scripts\\CopyUpdates\.cmd'/.test(WHERE), true);
/*
 * No task found is a real state, not an error: the tasks may never have been installed, or may belong to a
 * different Windows user. Falling back to a bounded search beats printing nothing.
 */
check('no task found falls back to searching for installs',
  /No Twin Visit Logger scheduled task was found/.test(WHERE), true);
check('...bounded, so it cannot walk the whole disk', /-Depth 5/.test(WHERE), true);
check('...and only counts folders that hold the launcher too',
  /Join-Path \$_\.DirectoryName 'scripts\\run-hidden\.vbs'/.test(WHERE), true);

console.log('\n=== The map carries everything the current fix needs ===');
/*
 * Named individually. A count would pass while the one file that matters is missing, and the file that
 * matters here is the one that stops REI logging out — the single most annoying bug in the project.
 */
for (const [pattern, dest] of [
  ['shutdown*.mjs', 'src\\utils\\shutdown.mjs'],
  ['lock*.mjs', 'src\\utils\\lock.mjs'],
  ['browser*.mjs', 'src\\rei\\browser.mjs'],
  ['sessionlog*.mjs', 'src\\rei\\session-log.mjs'],
  ['recheckrei*.mjs', 'scripts\\recheck-rei.mjs'],
  ['WhereIsTheApp*.cmd', 'scripts\\WhereIsTheApp.cmd']
]) {
  const re = new RegExp(`'${pattern.replace(/[*.]/g, (c) => '\\' + c)}'\\s+= '${dest.replace(/\\/g, '\\\\')}'`);
  check(`${pattern} -> ${dest}`, re.test(BODY), true);
}
// The hyphen-stripping is the whole reason these patterns look the way they do.
check('every source pattern is hyphen-free, because the browser strips hyphens on download',
  (BODY.match(/^\s*"\s+'([^']+)'\s+=/gm) || []).every((l) => !/'[^']*-[^']*'/.test(l)), true);
check('CreationTime, not LastWriteTime — a download keeps the SOURCE file\'s write time',
  /Sort-Object CreationTime -Descending/.test(BODY), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
