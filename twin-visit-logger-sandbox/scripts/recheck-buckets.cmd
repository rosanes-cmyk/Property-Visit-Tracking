@echo off
setlocal
cd /d "%~dp0.."

rem The bundled runtime, when this is the packaged app.
rem
rem Without this, an install from the portable folder looks perfect and every scheduled job fails SILENTLY:
rem the packaged folder deliberately carries no Node on PATH, so a bare "node" is not found, and Task
rem Scheduler reports the task as having run. The same reasoning covers Chromium - Playwright would try to
rem download 150 MB on a machine with nobody watching and possibly no internet.
set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
if exist "%~dp0..\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
if not exist logs mkdir logs

rem The hourly sweep: only the leads on the 3pm card. Everything else is covered by the ordinary
rem 20-minute recheck.cmd, so the dashboard still fills in for the whole book, just slower.
if exist "logs\bucket-task.log" (
  for %%A in ("logs\bucket-task.log") do if %%~zA GTR 5000000 (
    if exist "logs\bucket-task.prev.log" del "logs\bucket-task.prev.log"
    move /y "logs\bucket-task.log" "logs\bucket-task.prev.log" >nul
  )
)

echo. >> "logs\bucket-task.log"
echo ==== %DATE% %TIME% ==== >> "logs\bucket-task.log"
rem --wait, unlike recheck.cmd which stands down when REI is busy.
rem
rem The two jobs share one browser profile and one lock, and the 20-minute whole-book re-check gets
rem there first often enough that the sweep skipped TWICE IN A ROW on the client's machine — scheduled,
rem started, found the door locked, gave up. For the whole-book job that is free: it runs three times an
rem hour and the next one picks up whatever accumulated. For this one it is not. This is the job that
rem makes the 11am and 3pm cards true, it runs once an hour, and a skip means the card is posted from
rem stale data with nothing on screen to say so.
rem
rem Queueing is affordable here because this sweep is SMALL — only the leads on the card, 7 of them
rem today, not the 149 the whole-book job walks. The re-check holds the lock about five minutes in
rem twenty, and the wait gives up after twelve, so it takes its turn rather than stacking browsers.
"%NODE%" scripts\recheck-rei.mjs --buckets --limit 40 --wait --yes >> "logs\bucket-task.log" 2>&1
endlocal
