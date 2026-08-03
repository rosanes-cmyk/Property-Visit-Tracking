@echo off
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

rem Rotate at ~5 MB so a recurring schedule cannot grow the log forever.
if exist "logs\whatsapp-task.log" (
  for %%A in ("logs\whatsapp-task.log") do if %%~zA GTR 5000000 (
    if exist "logs\whatsapp-task.prev.log" del "logs\whatsapp-task.prev.log"
    move /y "logs\whatsapp-task.log" "logs\whatsapp-task.prev.log" >nul
  )
)

rem --yes: the scheduled run is the real thing. A dry run on a timer would report forever and
rem never create a group.
node src\whatsapp\watch.mjs --yes >> "logs\whatsapp-task.log" 2>&1
endlocal
