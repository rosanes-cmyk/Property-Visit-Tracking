@echo off
setlocal
cd /d "%~dp0.."
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
node scripts\fill-pending-rei.mjs --yes --scheduled >> "logs\fill-pending.log" 2>&1
endlocal
