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
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
/*
 * It still updates ITSELF — .cmd is one of the three extensions it carries, and CopyUpdates.cmd is a file in
 * the app like any other, so it is indexed and replaced along with everything else. That is precisely why
 * the staging above is not optional.
 */
check('.cmd files are carried, so it can still update itself',
  /\$code = '\^\\\.\(mjs\|cmd\|ps1\)\$'/.test(BODY), true);

console.log('\n=== The .env is the test, and only the .env ===');
check('a missing .env is caught', /if not exist "%APP%\\\.env" set "NOENV=1"/.test(BODY), true);
check('it stops before copying anything',
  BODY.indexOf('NOENV') < BODY.indexOf('Get-ChildItem $app -Recurse'), true);
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

console.log('\n=== There is no list of files, because the list is what kept failing ===');
/*
 * TWICE IN ONE WEEK, and the second one is why the list is gone.
 *
 * ONE — src/utils/shutdown.mjs was a NEW file, and the list named only the files changed that day.
 * browser.mjs, which the list DID carry, shipped importing it, so the PC received a browser module pointing
 * at a file that was not on disk:
 *
 *     Cannot find module '...\src\utils\shutdown.mjs' imported from '...\src\rei\browser.mjs'
 *
 * Every REI script died on startup. Not a wrong result — nothing ran at all.
 *
 * TWO — src\config.mjs was never in the list. Not in any version of it. The fix for a bug reported FIVE
 * times lived in that one file; the client downloaded it, ran CopyUpdates, and the output said NOTHING
 * about it — no COPIED line, and no MISSING line either, because a file the list does not name is never
 * looked for. Three runs later they were still reading `briefing = undefined` with the correct file sitting
 * in Downloads the whole time.
 *
 * My response to ONE was to widen the list to cover src\rei and src\utils entirely, and to assert exactly
 * that here. Both the fix and this test were scoped to the folder the last failure happened in — so
 * config.mjs, one level up in src\, was outside both, and the test passed while the file was undeliverable.
 *
 * A list has to be right about the future. This one has now been wrong twice, and a test asserting a list
 * contains what I remembered to think of is not a check — it is the same assumption written down twice. So
 * the mechanism changed: the copier walks the app and indexes what is THERE. Whether a given file can be
 * delivered is now a question about behaviour, and the section below answers it by running the thing.
 */
check('no hand-written list of destinations survives', /\$want = @\(/.test(BODY), false);
check('it indexes the app folder instead', /Get-ChildItem \$app -Recurse -File/.test(BODY), true);
check('...by filename, with the hyphens the browser strips removed',
  /\$k = \(\$f\.Name -replace '-',''\)\.ToLower\(\)/.test(BODY), true);
check('...and the repeat-download suffix removed from the download side',
  /-replace ' \?\\\(\?\\d\+\\\)\?\$',''/.test(BODY), true);
// CreationTime, because a downloaded file keeps the SOURCE file's write time — this already cost a file.
check('newest by CreationTime, not LastWriteTime',
  /\$d\.CreationTime -gt \$newest\[\$k\]\.CreationTime/.test(BODY), true);
check('node_modules is excluded, or a vendored file could become a destination',
  /node_modules/.test(BODY), true);
/*
 * .json is refused wholesale. token.json and credentials.json sit in the app root, and a copier that moves
 * files by name must not be able to move a credential — including out of a Downloads folder where a copy of
 * one may well be sitting.
 */
check('only code extensions are carried, so no .json can move',
  /\$code = '\^\\\.\(mjs\|cmd\|ps1\)\$'/.test(BODY), true);
check('an unmatched download is REPORTED, which is the line the list could never print',
  /IGNORED - this app has no file by these names/.test(CMD), true);
check('...and says a brand new file needs placing by hand once',
  /BRAND NEW file, it has to be put in place by hand/.test(CMD), true);
check('two files with one name is a refusal, not a guess',
  /there is no way to tell which one you meant/.test(CMD), true);

console.log('\n=== ...so the real question is answered by RUNNING it ===');
/*
 * A list with a gap in it is perfectly valid source code, which is why source-matching missed config.mjs.
 * This builds a fake app and a fake Downloads — hyphens stripped, a repeat-download suffix, a vendored
 * file under node_modules, a credential — runs the PowerShell block EXTRACTED FROM THE .cmd, and checks
 * where the files actually went.
 *
 * The block is lifted, not retyped: each ^-continued line's quoted fragment joined with a space, which is
 * what cmd.exe hands to powershell. A retyped copy would test my transcription.
 *
 * It needs a PowerShell, which a Linux CI box may not have. When there is none it says SKIPPED loudly and
 * counts a fail — a silent skip is the exact failure mode this whole project keeps hitting.
 */
{
  const ps = ['pwsh', '/opt/pwsh/pwsh', 'powershell'].find((p) => {
    try { return execFileSync('sh', ['-c', `command -v ${p}`], { encoding: 'utf8' }).trim(); }
    catch { return false; }
  });

  const lines = CMD.split('\n');
  const from = lines.findIndex((l) => l.startsWith('powershell -NoProfile'));
  const block = [];
  for (let i = from + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*"(.*)"\s*\^?\s*$/);
    if (!m) break;
    block.push(m[1]);
  }
  check('the PowerShell block was lifted out of the .cmd', block.length > 20, true);

  if (!ps) {
    console.log('FAIL  the copier was RUN  (SKIPPED - no PowerShell on this machine)');
    console.log('        a skipped check is not a passed one; install pwsh to run this section');
    fail++;
  } else {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyupdates-'));
    const app = path.join(root, 'app');
    const dl = path.join(root, 'home', 'Downloads');
    const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

    // The app, including the file that could never be delivered and the pair that must not collide.
    for (const rel of ['src/config.mjs', 'src/rei/notes.mjs', 'src/rei/notes-tab.mjs',
      'src/utils/lock.mjs', 'scripts/fill-pending-rei.mjs', 'scripts/CopyUpdates.cmd']) {
      write(path.join(app, rel), `OLD ${rel}`);
    }
    write(path.join(app, 'node_modules/zod/config.mjs'), 'VENDORED');   // must never be a destination
    write(path.join(app, '.env'), 'SPREADSHEET_ID=x');                  // the "this is a real install" test

    // Downloads, shaped the way this client's browser leaves it.
    write(path.join(dl, 'config.mjs'), 'NEW config');
    write(path.join(dl, 'fillpendingrei.mjs'), 'NEW fill');
    write(path.join(dl, 'fillpendingrei (2).mjs'), 'OLDER fill');
    write(path.join(dl, 'notestab.mjs'), 'NEW notestab');
    write(path.join(dl, 'shutdown.mjs'), 'A NEW FILE');                 // matches nothing in the app
    write(path.join(dl, 'token.json'), 'CREDENTIAL');                   // must never move
    const old = new Date('2026-09-01T09:00:00Z');
    fs.utimesSync(path.join(dl, 'fillpendingrei (2).mjs'), old, old);

    const script = block.join(' ').replace("'%APP%'", '$__app');
    const out = execFileSync(ps, ['-NoProfile', '-Command',
      `$env:USERPROFILE='${path.join(root, 'home')}'; $__app='${app}'; ${script}`],
    { encoding: 'utf8', cwd: app });

    const landed = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
    // THE ONE THAT MATTERS. This is the assertion the old list-based test could not express.
    check('src/config.mjs is deliverable', landed('src/config.mjs'), 'NEW config');
    check('a hyphenated name is restored from the flattened download',
      landed('scripts/fill-pending-rei.mjs'), 'NEW fill');
    check('...taking the NEWEST download, not the repeat-suffixed older one',
      landed('scripts/fill-pending-rei.mjs') !== 'OLDER fill', true);
    check('notestab.mjs lands on notes-tab.mjs', landed('src/rei/notes-tab.mjs'), 'NEW notestab');
    check('...and notes.mjs is left alone', landed('src/rei/notes.mjs'), 'OLD src/rei/notes.mjs');
    check('a vendored file of the same name is not a destination',
      landed('node_modules/zod/config.mjs'), 'VENDORED');
    check('no .json is moved, credential or otherwise',
      fs.existsSync(path.join(app, 'token.json')), false);
    check('a download matching nothing is named on screen',
      /IGNORED[^\n]*shutdown\.mjs/.test(out), true);
    check('...and is not silently dropped into the app',
      fs.existsSync(path.join(app, 'src/utils/shutdown.mjs')), false);
    // Three matching downloads: config.mjs, fillpendingrei.mjs, notestab.mjs. token.json and shutdown.mjs
    // are not copies of anything in the app, and the repeat-suffixed file is the same one as fillpendingrei.
    check('it reports how many it updated', /3 file\(s\) updated/.test(out), true);
    check('no folder was invented on the way', fs.existsSync(path.join(app, 'src/rei/notes')), false);

    // A second file of the same name INSIDE the app: refuse, name both, copy neither, carry on.
    write(path.join(app, 'backup/config.mjs'), 'A BACKUP');
    const out2 = execFileSync(ps, ['-NoProfile', '-Command',
      `$env:USERPROFILE='${path.join(root, 'home')}'; $__app='${app}'; ${script}`],
    { encoding: 'utf8', cwd: app });
    check('an ambiguous name is refused', /REFUSED[^\n]*config\.mjs/.test(out2), true);
    check('...naming both candidates', (out2.match(/config\.mjs/g) || []).length >= 3, true);
    check('...and overwriting neither', landed('backup/config.mjs'), 'A BACKUP');
    check('...while the unambiguous files still copy', /COPIED[^\n]*notes-tab\.mjs/.test(out2), true);

    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n=== Every copied file is unblocked, or a scheduled task hangs on a dialog nobody sees ===');
/*
 * THE FAULT THAT STOPPED THE AUTOMATION FOR TWO DAYS.
 *
 * Windows tags anything downloaded from the internet with a hidden Zone.Identifier stream. Running a
 * tagged .cmd or .vbs shows "Open File - Security Warning: the publisher could not be verified".
 *
 * Clicked by hand it is a nuisance. Launched by a SCHEDULED TASK — hidden, with no interactive desktop —
 * that box appears where nobody can see it and waits for an OK that never comes. "Board Intake" sat at
 * Status: Running from Wednesday 13:24 with Last Result 0x800710E0, because Windows kept trying to start a
 * second copy while the first held an invisible dialog. Not one line reached any log, not even the dated
 * header the script writes before anything else.
 *
 * Running the same file by hand worked perfectly every time, because a person was there to click Run.
 * That is what made it nearly impossible to see.
 *
 * And EVERY UPDATE RE-MARKS THE FILE, so it cannot be a cleanup somebody remembers to do. It has to happen
 * on the copy, which is the only path a downloaded file takes into the app.
 */
{
  const src = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/scripts/CopyUpdates.cmd'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
  check('the copier unblocks what it installs', /Unblock-File -Path \$dest/.test(code), true);
  /* Immediately after the copy, so a file cannot be left marked by an error later in the loop. */
  check('...on the same pass as the copy',
    /Copy-Item \$src\.FullName \$dest -Force;[\s\S]{0,120}Unblock-File/.test(code), true);
  /*
   * SilentlyContinue: a file with no mark, or a filesystem that has no alternate data streams, must not
   * fail the install. The unblock is a precaution, not a step that can refuse.
   */
  check('...and a file that was never blocked does not break the run',
    /Unblock-File[^\n]*-ErrorAction SilentlyContinue/.test(code), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
