@echo off
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

rem Rotate the log once it passes ~5 MB so a frequent schedule cannot grow it forever.
if exist "logs\scheduled-task.log" (
  for %%A in ("logs\scheduled-task.log") do if %%~zA GTR 5000000 (
    if exist "logs\scheduled-task.prev.log" del "logs\scheduled-task.prev.log"
    move /y "logs\scheduled-task.log" "logs\scheduled-task.prev.log" >nul
  )
)

rem Call node directly rather than through npm: fewer moving parts in an unattended run.
node src\run-once.mjs >> "logs\scheduled-task.log" 2>&1
endlocal
