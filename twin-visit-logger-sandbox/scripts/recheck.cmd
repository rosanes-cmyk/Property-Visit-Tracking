@echo off
setlocal
cd /d "%~dp0.."
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
node scripts\recheck-rei.mjs --yes >> "logs\recheck-task.log" 2>&1
endlocal
