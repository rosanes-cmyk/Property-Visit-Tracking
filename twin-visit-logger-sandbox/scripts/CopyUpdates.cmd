@echo off
rem Copy freshly-downloaded updates out of Downloads and into the right folders, with the right names.
rem
rem WHY THIS EXISTS. Every fix has to reach this PC as a file copy — the "Twin Visit Logger Updates" Drive
rem folder has never existed, so the app's own update button has nothing to find. And this client's browser
rem STRIPS HYPHENS from downloaded filenames, so fill-pending-rei.mjs arrives as fillpendingrei.mjs and
rem rei-login.mjs as reilogin.mjs — sometimes with a number on the end when it has been downloaded before.
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
rem here. Sorting by it picked reilogin3.mjs, dated 6 August, over a copy saved minutes earlier — and
rem cheerfully installed the old login script over the good one. CreationTime is when it landed in
rem Downloads, which is the thing actually being asked for.
rem
rem It says exactly what it did, and MISSING for anything not downloaded — a file you did not save is not
rem an error, it just was not part of this update.
rem
rem Safe to run twice: copying the same file again changes nothing.
rem
rem The name has no hyphen on purpose.
setlocal
cd /d "%~dp0.."
set "APP=%CD%"

echo.
echo   COPYING UPDATES INTO THE APP
echo   from: %USERPROFILE%\Downloads
echo   to:   %APP%
echo   ----------------------------------------------------------------------
echo.

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
