@echo off
setlocal
cd /d "%~dp0.."
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
node scripts\recheck-rei.mjs --buckets --limit 40 --yes >> "logs\bucket-task.log" 2>&1
endlocal
