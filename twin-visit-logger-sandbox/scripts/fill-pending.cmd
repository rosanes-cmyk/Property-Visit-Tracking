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

rem Finish the rows a colleague added on the board — the ones parked with "PENDING REI LOOKUP".
rem
rem --wait, for the same reason the bucket sweep waits: a colleague is watching that record on the board,
rem so "skipped, try again later" is a person staring at a row that never completes. The runs are short —
rem usually no pending rows at all, in which case it never opens a browser.
if exist "logs\fill-pending.log" (
  for %%A in ("logs\fill-pending.log") do if %%~zA GTR 5000000 (
    if exist "logs\fill-pending.prev.log" del "logs\fill-pending.prev.log"
    move /y "logs\fill-pending.log" "logs\fill-pending.prev.log" >nul
  )
)

echo. >> "logs\fill-pending.log"
echo ==== %DATE% %TIME% ==== >> "logs\fill-pending.log"
"%NODE%" scripts\fill-pending-rei.mjs --yes --scheduled >> "logs\fill-pending.log" 2>&1
endlocal
