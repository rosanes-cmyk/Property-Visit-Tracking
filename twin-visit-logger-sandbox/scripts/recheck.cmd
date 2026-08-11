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

rem Rotate at ~5 MB so a recurring schedule cannot grow the log forever.
if exist "logs\recheck-task.log" (
  for %%A in ("logs\recheck-task.log") do if %%~zA GTR 5000000 (
    if exist "logs\recheck-task.prev.log" del "logs\recheck-task.prev.log"
    move /y "logs\recheck-task.log" "logs\recheck-task.prev.log" >nul
  )
)

rem --yes: a scheduled run is the real thing. A dry run on a timer would report forever and never
rem correct anything, which is the failure this whole feature exists to fix.
echo. >> "logs\recheck-task.log"
echo ==== %DATE% %TIME% ==== >> "logs\recheck-task.log"
"%NODE%" scripts\recheck-rei.mjs --yes >> "logs\recheck-task.log" 2>&1
endlocal
