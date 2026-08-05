@echo off
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

rem Rotate at ~5 MB so a recurring schedule cannot grow the log forever.
if exist "logs\audit-notes.log" (
  for %%A in ("logs\audit-notes.log") do if %%~zA GTR 5000000 (
    if exist "logs\audit-notes.prev.log" del "logs\audit-notes.prev.log"
    move /y "logs\audit-notes.log" "logs\audit-notes.prev.log" >nul
  )
)

rem --yes, for the same reason the REI re-check applies: a dry run on a timer reports the same drift
rem every hour forever and corrects none of it.
echo. >> "logs\audit-notes.log"
echo ==== %DATE% %TIME% ==== >> "logs\audit-notes.log"
node scripts\audit-notes.mjs --yes >> "logs\audit-notes.log" 2>&1
endlocal
