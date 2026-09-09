@echo off
rem Copy freshly-downloaded updates out of Downloads and into the right folders, with the right names.
rem
rem WHY THIS EXISTS. Every fix has to reach this PC as a file copy -- the "Twin Visit Logger Updates" Drive
rem folder has never existed, so the app's own update button has nothing to find. And this client's browser
rem STRIPS HYPHENS from downloaded filenames, so fill-pending-rei.mjs arrives as fillpendingrei.mjs and
rem rei-login.mjs as reilogin.mjs -- sometimes with a number on the end when it has been downloaded before.
rem
rem The result was an evening of hand-typed copy commands, one of which copied reilogin.mjs when the newest
rem was reilogin3.mjs and put the OLD file back. Six files across three folders is not something to do by
rem hand at the end of a long day.
rem
rem So this takes the NEWEST download matching each pattern and puts it where it belongs, under its proper
rem name.
rem
rem SORTED BY CreationTime, NOT LastWriteTime, and that distinction cost a file. A download keeps the
rem timestamp of the file it came from, so LastWriteTime is when the file was WRITTEN, not when it arrived
rem here. Sorting by it picked reilogin3.mjs, dated 6 August, over a copy saved minutes earlier -- and
rem cheerfully installed the old login script over the good one. CreationTime is when it landed in
rem Downloads, which is the thing actually being asked for.
rem
rem It says exactly what it did, and MISSING for anything not downloaded -- a file you did not save is not
rem an error, it just was not part of this update.
rem
rem Safe to run twice: copying the same file again changes nothing.
rem
rem The name has no hyphen on purpose.
setlocal

rem ======================================================================================================
rem  IT RUNS ITSELF FROM A COPY IN %TEMP%, AND THAT IS NOT TIDINESS -- IT IS A BUG FIX.
rem
rem  cmd.exe reads a batch file FROM DISK AS IT EXECUTES, remembering a byte offset between lines. This
rem  script has 'CopyUpdates*.cmd' in its own map, so it overwrote itself mid-run. That was harmless while
rem  the new copy was byte-identical to the old one. The moment it changed length, cmd resumed at its saved
rem  offset inside a DIFFERENT file and landed in the middle of a line:
rem
rem      'PIED' is not recognized as an internal or external command
rem      '"}"' is not recognized as an internal or external command
rem
rem  which is the tail of "COPIED" and a fragment of the PowerShell block. The copies above it had all
rem  succeeded, so it looked like a broken installer when it had actually just finished its job.
rem
rem  Re-running from a staged copy means the file being executed is never the file being replaced. The
rem  first pass copies itself to %TEMP% and calls that; the staged pass does the work and is handed the
rem  app folder, since %~dp0 there points at %TEMP% and not at the app.
rem ======================================================================================================
if /i "%~1"=="__staged" goto :run
set "STAGE=%TEMP%\twin-visit-updates"
if not exist "%STAGE%" mkdir "%STAGE%" >nul 2>&1
copy /y "%~f0" "%STAGE%\CopyUpdates.cmd" >nul
if errorlevel 1 (
  echo   Could not stage this script in %TEMP% -- running in place instead.
  echo   If it ends with a "not recognized as an internal or external command" error, everything
  echo   above that line still copied correctly. Run it once more and it will be clean.
  goto :run
)
call "%STAGE%\CopyUpdates.cmd" __staged "%~dp0.."
exit /b

:run
rem The app folder: %2 when staged, the parent of this script when not.
if /i "%~1"=="__staged" (cd /d "%~2") else (cd /d "%~dp0..")
set "APP=%CD%"

echo.
echo   COPYING UPDATES INTO THE APP
echo   from: %USERPROFILE%\Downloads
echo   to:   %APP%
echo   ----------------------------------------------------------------------
echo.

rem ======================================================================================================
rem  IS THIS EVEN THE APP THE TIMERS RUN?
rem
rem  A live run copied nine files into:
rem
rem      C:\Users\bryan\Downloads\twin-visit-logger-sandbox\twin-visit-logger-sandbox
rem
rem  Every copy reported COPIED. Nothing was wrong with any of them. And nothing reached the folder the
rem  automation runs from, so the fix appeared to install and changed nothing. That is the exact failure
rem  this whole project keeps hitting: a confident success that reached nobody.
rem
rem  THE ONE TEST THAT MEANS ANYTHING IS THE .env. The app cannot read the sheet or the Chat webhook
rem  without it, and a freshly unzipped archive never has one. If it is here, this IS a working install.
rem
rem  AND BEING UNDER DOWNLOADS DOES NOT DISQUALIFY IT. My first version treated that as proof this was
rem  "not the app", and on the client's machine the configured install really does live under Downloads --
rem  so the guard would have refused the only correct folder on the PC. That is the same mistake in the
rem  other direction, and a guard that blocks the right answer is worse than no guard. It is now a WARNING
rem  about where the folder lives -- browsers, disk cleanup and "clear downloads" all delete from there,
rem  and it is where a second unzipped copy lands -- not a claim about what the folder is.
rem
rem  It ASKS rather than refusing either way: someone may genuinely be setting up a new copy, and a tool
rem  that flatly says no to a thing you meant to do is a tool people work around.
rem ======================================================================================================
set "NOENV="
set "INDOWNLOADS="
if not exist "%APP%\.env" set "NOENV=1"
rem No trailing backslash in the pattern, so Downloads ITSELF is caught as well as a folder inside it.
echo %APP% | find /i "\Downloads" >nul && set "INDOWNLOADS=1"

if defined NOENV (
  echo   ** WAIT - there is no .env file here, so this is not a configured install. **
  echo.
  echo   This looks like a freshly unzipped copy, NOT the app your scheduled tasks run. Copying into
  echo   it would report success and change nothing that actually runs.
  echo.
  echo   To find the real folder: double-click  scripts\WhereIsTheApp.cmd
  echo   It reads the path straight out of the Windows scheduled task, so it cannot guess wrong.
  echo.
  echo   Then run the CopyUpdates.cmd inside THAT folder, not this one.
  echo.
  choice /C YN /N /M "   Copy into this folder anyway? [Y/N] "
  if errorlevel 2 (
    echo.
    echo   Nothing was copied. Find the real folder and run CopyUpdates.cmd from there.
    echo.
    pause
    exit /b 1
  )
  echo.
) else if defined INDOWNLOADS (
  rem A real install, in a risky place. Say so once and carry on -- this is not a reason to stop.
  echo   NOTE: this install lives under Downloads. It works, and the .env proves it is the real thing,
  echo   but Downloads is where browsers and disk-cleanup delete from, and where a second unzipped copy
  echo   lands. Worth moving it somewhere permanent when there is time. Carrying on.
  echo.
)

rem ======================================================================================================
rem  THERE IS NO LIST OF FILES ANY MORE. THE APP FOLDER IS THE LIST.
rem
rem  It used to carry a hand-written list of destinations, and the list is what kept failing:
rem
rem    * src\utils\shutdown.mjs was a NEW file with no entry. browser.mjs shipped importing it, so the PC
rem      got a browser module pointing at a file that was not there, and every REI script died with
rem      "Cannot find module ...\src\utils\shutdown.mjs". Nothing ran at all.
rem
rem    * src\config.mjs was never in the list -- not once, in any version. The fix for a bug the client
rem      reported FIVE times (the Chat briefing not firing when a calendar event is created) lives in that
rem      one file. They downloaded it, ran this, and the run said nothing about it: no COPIED line, and no
rem      MISSING line either, because a file the list does not name is not even looked for. Then:
rem
rem          briefing = undefined
rem
rem      three runs in a row, with the correct file sitting in Downloads the whole time. The list did not
rem      report a gap. It cannot: a list only knows what is on it.
rem
rem  A hand-written list has to be right about the future -- every file a later fix might touch -- and it
rem  has now been wrong twice in one week. So it is gone. This walks the app folder, indexes every .mjs,
rem  .cmd and .ps1 already there, and works out what each download in Downloads is a new copy of. Every
rem  file the app contains is deliverable, permanently, with nothing to maintain.
rem
rem  THE MATCH IS BY FILENAME, both sides flattened the way the browser flattens them: this client's
rem  browser STRIPS HYPHENS on download, so fill-pending-rei.mjs arrives as fillpendingrei.mjs. A repeat
rem  download also gains a suffix -- "2", " (2)", "(2)" -- which is stripped before matching. Newest by
rem  CreationTime wins, because a download keeps the SOURCE file's write time and sorting on
rem  LastWriteTime once installed a 6-August login script over a good one.
rem
rem  TWO THINGS IT REFUSES TO GUESS AT, because a wrong copy is worse than no copy:
rem
rem    * TWO FILES IN THE APP WITH THE SAME NAME. Then a download called notes.mjs could belong to either,
rem      so it says so and copies neither. (The app has no such pair today; a stray backup folder inside
rem      the app would create one.)
rem
rem    * A DOWNLOAD MATCHING NOTHING. Reported as IGNORED, by name. That line is the thing the old list
rem      could never print, and it is what would have caught both failures above on the first run.
rem
rem  .json is deliberately NOT carried. token.json and credentials.json are credentials that live in the
rem  app root, and a copier that moves files by name must never be able to move one of those.
rem
rem  A genuinely NEW file still has to be placed by hand once -- it cannot be indexed before it exists.
rem  Every update of it after that is automatic. The IGNORED line says this on screen.
rem ======================================================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dl = Join-Path $env:USERPROFILE 'Downloads';" ^
  "$app = '%APP%';" ^
  "$code = '^\.(mjs|cmd|ps1)$';" ^
  "$skip = '[\\/](node_modules|browser-data|debug|data|\.git)[\\/]';" ^
  "$index = @{};" ^
  "foreach ($f in @(Get-ChildItem $app -Recurse -File -ErrorAction SilentlyContinue)) {" ^
  "  if ($f.Extension -notmatch $code) { continue }" ^
  "  if ($f.FullName -match $skip) { continue }" ^
  "  $k = ($f.Name -replace '-','').ToLower();" ^
  "  if ($index.ContainsKey($k)) { $index[$k] = @($index[$k]) + $f.FullName } else { $index[$k] = @($f.FullName) }" ^
  "};" ^
  "$newest = @{};" ^
  "foreach ($d in @(Get-ChildItem $dl -File -ErrorAction SilentlyContinue)) {" ^
  "  if ($d.Extension -notmatch $code) { continue }" ^
  "  $b = [IO.Path]::GetFileNameWithoutExtension($d.Name) -replace ' ?\(?\d+\)?$','';" ^
  "  $k = (($b + $d.Extension) -replace '-','').ToLower();" ^
  "  if (-not $newest.ContainsKey($k) -or $d.CreationTime -gt $newest[$k].CreationTime) { $newest[$k] = $d }" ^
  "};" ^
  "$done = 0; $unknown = @();" ^
  "foreach ($k in @($newest.Keys | Sort-Object)) {" ^
  "  $src = $newest[$k];" ^
  "  if (-not $index.ContainsKey($k)) { $unknown += $src.Name; continue }" ^
  "  $dests = @($index[$k]);" ^
  "  if ($dests.Count -gt 1) {" ^
  "    Write-Host ('  REFUSED  ' + $src.Name + '  -- this app holds ' + $dests.Count + ' files with that name,');" ^
  "    Write-Host '             so there is no way to tell which one you meant:';" ^
  "    foreach ($d2 in $dests) { Write-Host ('               ' + $d2) };" ^
  "    continue" ^
  "  }" ^
  "  $dest = $dests[0];" ^
  "  Copy-Item $src.FullName $dest -Force;" ^
  "  $rel = $dest.Substring($app.Length).TrimStart('\','/');" ^
  "  Write-Host ('  COPIED   ' + $src.Name + '  ->  ' + $rel + '   (' + $src.CreationTime.ToString('MMM d HH:mm') + ')');" ^
  "  $done = $done + 1" ^
  "};" ^
  "Write-Host '';" ^
  "if ($done -eq 0) { Write-Host '  NOTHING WAS COPIED - no file in Downloads matches a file in this app.' }" ^
  "else { Write-Host ('  ' + $done + ' file(s) updated.') };" ^
  "if ($unknown.Count) {" ^
  "  Write-Host '';" ^
  "  Write-Host ('  IGNORED - this app has no file by these names: ' + ($unknown -join ', '));" ^
  "  Write-Host '  If one of those is a BRAND NEW file, it has to be put in place by hand this one';" ^
  "  Write-Host '  time. Every update to it after that will be picked up automatically.'" ^
  "}"

echo.
echo   ----------------------------------------------------------------------
echo   Every .mjs, .cmd and .ps1 already in this app can be updated this way -- there
echo   is no list of files to keep up to date, so nothing can be left off it.
echo.
echo   It always takes the NEWEST matching download, so an older copy of the same
echo   file sitting in Downloads cannot overwrite the new one.
echo.
echo   A file you did not download is simply not mentioned. IGNORED means the opposite:
echo   you downloaded something this app has no file by that name for.
echo.
pause
endlocal
