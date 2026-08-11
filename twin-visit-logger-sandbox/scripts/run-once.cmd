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

rem Rotate the log once it passes ~5 MB so a frequent schedule cannot grow it forever.
if exist "logs\scheduled-task.log" (
  for %%A in ("logs\scheduled-task.log") do if %%~zA GTR 5000000 (
    if exist "logs\scheduled-task.prev.log" del "logs\scheduled-task.prev.log"
    move /y "logs\scheduled-task.log" "logs\scheduled-task.prev.log" >nul
  )
)

rem Call node directly rather than through npm: fewer moving parts in an unattended run.
"%NODE%" src\run-once.mjs >> "logs\scheduled-task.log" 2>&1
endlocal
