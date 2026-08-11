@echo off
rem Check the leads somebody parked - Lost / Closed Out and Long-Term Nurture - and report any that look
rem alive again in REI. Runs itself once a day; this file is for running it by hand.
rem
rem It WRITES NOTHING. Moving a lead out of Lost / Closed Out is a business decision, not a regex one, so it
rem tells you and you decide. Finding out within a week instead of never is the whole point.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
if exist "%~dp0..\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"

if exist "logs\parked-sweep.log" (
  for %%A in ("logs\parked-sweep.log") do if %%~zA GTR 5000000 (
    if exist "logs\parked-sweep.prev.log" del "logs\parked-sweep.prev.log"
    move /y "logs\parked-sweep.log" "logs\parked-sweep.prev.log" >nul
  )
)

echo. >> "logs\parked-sweep.log"
echo ==== %DATE% %TIME% ==== >> "logs\parked-sweep.log"
"%NODE%" scripts\sweep-parked.mjs %* >> "logs\parked-sweep.log" 2>&1
endlocal
