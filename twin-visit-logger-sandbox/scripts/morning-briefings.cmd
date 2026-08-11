@echo off
rem Post the visit briefing for every visit on TODAY's calendar. Runs itself each morning on a timer.
rem
rem The client, after being shown how to ask for one by hand: "its already added in the gc i shuould be this
rem autmatic at all i dont need to open or type."
rem
rem Right. The briefing used to go out only at the moment a booking was first processed, which meant a visit
rem booked last week - or booked on a PC that has since been replaced - produced nothing, and somebody had to
rem know a command existed. Now the day's briefings are simply waiting in Chat before the shift starts.
rem
rem It sends one per lead per day: a lead already briefed this morning is skipped, so a PC that restarts or a
rem run somebody kicks off by hand cannot put the same briefing in the space twice.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

if exist "logs\briefings.log" (
  for %%A in ("logs\briefings.log") do if %%~zA GTR 5000000 (
    if exist "logs\briefings.prev.log" del "logs\briefings.prev.log"
    move /y "logs\briefings.log" "logs\briefings.prev.log" >nul
  )
)

echo. >> "logs\briefings.log"
echo ==== %DATE% %TIME% ==== >> "logs\briefings.log"
"%NODE%" scripts\send-briefing.mjs --today >> "logs\briefings.log" 2>&1
endlocal
