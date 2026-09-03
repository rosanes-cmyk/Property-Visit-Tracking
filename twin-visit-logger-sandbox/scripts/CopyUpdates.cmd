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

rem One PowerShell call rather than a dozen copy lines: it can sort by date, which cmd cannot do simply,
rem and picking the NEWEST match is the whole point.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dl = Join-Path $env:USERPROFILE 'Downloads';" ^
  "$app = '%APP%';" ^
  "$map = [ordered]@{" ^
  "  'fillpendingrei*.mjs' = 'scripts\fill-pending-rei.mjs';" ^
  "  'recheckrei*.mjs'     = 'scripts\recheck-rei.mjs';" ^
  "  'reilogin*.mjs'       = 'scripts\rei-login.mjs';" ^
  "  'sweepparked*.mjs'    = 'scripts\sweep-parked.mjs';" ^
  "  'scraper*.mjs'        = 'src\rei\scraper.mjs';" ^
  "  'sessionlog*.mjs'     = 'src\rei\session-log.mjs';" ^
  "  'browser*.mjs'        = 'src\rei\browser.mjs';" ^
  "  'priority*.mjs'       = 'src\utils\priority.mjs';" ^
  "  'shutdown*.mjs'       = 'src\utils\shutdown.mjs';" ^
  "  'lock*.mjs'           = 'src\utils\lock.mjs';" ^
  "  'FinishBookings*.cmd' = 'scripts\FinishBookings.cmd';" ^
  "  'SessionLog*.cmd'     = 'scripts\SessionLog.cmd';" ^
  "  'WhereIsTheApp*.cmd'  = 'scripts\WhereIsTheApp.cmd';" ^
  "  'WhereIsTheApp*.ps1'  = 'scripts\WhereIsTheApp.ps1';" ^
  "  'CopyUpdates*.cmd'    = 'scripts\CopyUpdates.cmd'" ^
  "};" ^
  "foreach ($k in $map.Keys) {" ^
  "  $src = Get-ChildItem (Join-Path $dl $k) -ErrorAction SilentlyContinue | Sort-Object CreationTime -Descending | Select-Object -First 1;" ^
  "  if (-not $src) { Write-Host ('  MISSING  ' + $k + '  (not downloaded - skipped)'); continue }" ^
  "  $dest = Join-Path $app $map[$k];" ^
  "  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null;" ^
  "  Copy-Item $src.FullName $dest -Force;" ^
  "  Write-Host ('  COPIED   ' + $src.Name + '  ->  ' + $map[$k] + '   (' + $src.CreationTime.ToString('MMM d HH:mm') + ')')" ^
  "}"

echo.
echo   ----------------------------------------------------------------------
echo   MISSING just means you did not download that one this time. Not a problem.
echo.
echo   It always takes the NEWEST matching download, so an older copy of the same
echo   file sitting in Downloads cannot overwrite the new one.
echo.
pause
endlocal
