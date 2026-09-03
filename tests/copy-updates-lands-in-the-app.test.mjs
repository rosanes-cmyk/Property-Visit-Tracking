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
const WHERE = read('twin-visit-logger-sandbox/scripts/WhereIsTheApp.ps1');

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

console.log('\n=== The .env is the test, and only the .env ===');
check('a missing .env is caught', /if not exist "%APP%\\\.env" set "NOENV=1"/.test(BODY), true);
check('it stops before copying anything', BODY.indexOf('NOENV') < BODY.indexOf('$map = [ordered]'), true);
check('it names what is wrong, not just that something is',
  /\*\* WAIT - there is no \.env file here/.test(CMD), true);
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

console.log('\n=== A Downloads path is a WARNING, never a refusal ===');
/*
 * MY OWN SECOND MISTAKE, in the opposite direction to the first. I treated "under Downloads" as proof the
 * folder was not the app — and on the client's machine the configured install really does live there, with
 * a .env and scripts\run-hidden.vbs. So the guard would have blocked the only correct folder on the PC.
 *
 * A guard that refuses the right answer is worse than no guard: the first one loses an update, the second
 * merely fails to catch one. What is true about Downloads is only that it is a bad place to KEEP the app —
 * browsers, disk cleanup and "clear downloads" all delete from there, and it is where a second unzipped
 * copy lands.
 */
check('a Downloads path is detected', /find \/i "\\Downloads" >nul && set "INDOWNLOADS=1"/.test(BODY), true);
// No trailing backslash: Downloads itself is as much of a risk as a folder inside it.
check('...including Downloads itself, not only folders inside it',
  /find \/i "\\Downloads\\"/.test(BODY), false);
check('it is a separate flag from the .env test', /set "INDOWNLOADS="/.test(BODY), true);
check('...reached only when the .env IS present', /\) else if defined INDOWNLOADS \(/.test(BODY), true);
check('it carries on rather than asking', /Carrying on\./.test(CMD), true);
check('...and says the .env proves the folder is real',
  /the \.env proves it is the real thing/.test(CMD), true);
check('there is no second choice prompt to get past',
  (BODY.match(/choice \/C YN/g) || []).length, 1);
// The old wording claimed the folder was not the app. It must not come back.
check('it no longer claims a Downloads install is not the app',
  /this folder is under Downloads/.test(CMD), false);

console.log('\n=== Everything a Windows console prints is ASCII ===');
/*
 * The console runs in codepage 437, so a UTF-8 em-dash reached the client's screen as three garbage
 * characters mid-sentence: "Run the CopyUpdates.cmd shown above <garbage> the one inside the APP folder."
 * PowerShell 5.1 also reads a BOM-less .ps1 as ANSI. Comments included, because the first draft of the
 * comment warning about this quoted the garbage characters and put them straight back in the file.
 */
for (const [name, text] of [
  ['CopyUpdates.cmd', CMD],
  ['WhereIsTheApp.cmd', read('twin-visit-logger-sandbox/scripts/WhereIsTheApp.cmd')],
  ['WhereIsTheApp.ps1', WHERE]
]) {
  const bad = [...new Set([...text].filter((c) => c.charCodeAt(0) > 127))];
  check(`${name} is ASCII throughout`, bad, []);
}

console.log('\n=== WhereIsTheApp reads the path out of Windows, rather than guessing ===');
const WHERE_CMD = read('twin-visit-logger-sandbox/scripts/WhereIsTheApp.cmd');
check('the launcher exists', fs.existsSync(path.resolve('twin-visit-logger-sandbox/scripts/WhereIsTheApp.cmd')), true);
check('the script exists', fs.existsSync(path.resolve('twin-visit-logger-sandbox/scripts/WhereIsTheApp.ps1')), true);
/*
 * A .ps1, not a `powershell -Command` chain of twenty ^-continued lines escaping pipes past cmd's parser.
 * That is the kind of code that half-works, and a diagnostic reporting the wrong state is the specific
 * failure this project already has a scar from — whatsapp-doctor said "looks logged in" on a logout page.
 */
check('the launcher runs the .ps1 by file, not as an inline command',
  /powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"/.test(WHERE_CMD), true);
check('...and says so plainly when the .ps1 is missing rather than failing oddly',
  /WhereIsTheApp\.ps1 is missing from this scripts folder/.test(WHERE_CMD), true);
check('it names this PC, so it can be compared with the machine on the cards',
  /THIS PC     \{0\}/.test(WHERE), true);
check('it asks the scheduled tasks', /Get-ScheduledTask -ErrorAction Stop/.test(WHERE), true);
check('...matching by name rather than a fixed list', /-notlike '\*Twin Visit\*'/.test(WHERE), true);
check('it derives the app folder from the launcher path', /run-hidden\\?\.vbs/.test(WHERE), true);
check('...two levels up, which is where the launcher sits',
  /Split-Path \(Split-Path \$m\.Groups\['p'\]\.Value\)/.test(WHERE), true);
// The same .env test, so the two scripts cannot disagree about what counts as an install.
check('it confirms the folder is configured', /Test-Path \(Join-Path \$app '\.env'\)/.test(WHERE), true);
check('...and says so when a TASK points somewhere unconfigured',
  /this task points at an unconfigured folder/.test(WHERE), true);
check('it prints the exact CopyUpdates.cmd to run',
  /Join-Path \$app 'scripts\\CopyUpdates\.cmd'/.test(WHERE), true);

console.log('\n=== "not installed" and "could not check" are never confused ===');
/*
 * MY FIRST MISTAKE HERE, and the one that sent a wrong answer to the client's screen. The original used
 * `Get-ScheduledTask -ErrorAction SilentlyContinue`, which makes a failure — an old build, a policy, a
 * missing module — indistinguishable from an empty result. It then printed "the tasks were never
 * installed", a claim it had no basis for, which would send somebody to reinstall tasks that may be
 * running perfectly.
 */
check('a failed query is caught, not silenced', /-ErrorAction Stop/.test(WHERE), true);
check('...and falls back to schtasks, which ships with every Windows',
  /& schtasks\.exe \/Query \/FO CSV \/V/.test(WHERE), true);
check('a query that genuinely ran is tracked separately from its result',
  /\$queried = \$false/.test(WHERE), true);
check('"could not check" says it is NOT a claim that they are missing',
  /This does NOT mean they are missing/.test(WHERE), true);
check('"none found" says Windows actually answered',
  /Windows answered, so this is a real answer/.test(WHERE), true);
check('...and points at the machine name on the cards',
  /you are at the wrong PC and copying files here changes nothing/.test(WHERE), true);
/*
 * The installs on disk are listed WHATEVER the tasks said — including when a task was found — because the
 * two can disagree, and a second copy of the app is exactly how nine files went into Downloads.
 */
/*
 * Proven by INDENTATION, which is the only thing that actually distinguishes top-level from nested here.
 * My first attempt compared its offset against the last `} else {` in the file — and that else belongs to
 * the `if ($hits)` block further down, so the check failed on correct code.
 */
check('the on-disk installs are listed unconditionally, outside the task branches',
  /^Line '  Folders on this PC that are configured installs/m.test(WHERE), true);
check('...bounded, so it cannot walk the whole disk', /-Depth 5/.test(WHERE), true);
check('...and only counts folders that hold the launcher too',
  /Join-Path \$_\.DirectoryName 'scripts\\run-hidden\.vbs'/.test(WHERE), true);
check('a Downloads install is flagged as risky, not as wrong',
  /works, but Downloads is risky/.test(WHERE), true);

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
  ['WhereIsTheApp*.cmd', 'scripts\\WhereIsTheApp.cmd'],
  // The launcher is useless without it, and "download them as a pair" is a step people skip.
  ['WhereIsTheApp*.ps1', 'scripts\\WhereIsTheApp.ps1']
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
