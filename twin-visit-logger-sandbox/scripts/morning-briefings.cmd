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
rem
rem TOMORROW'S VISITS GO OUT TOO, and that is the day-before reminder the client asked for: "for tommorw when
rem if the visit wll hapened it will notif again".
rem
rem It needs no second timer and no new file. send-briefing keys what it has sent on the ROW plus the DAY IT
rem WAS SENT, so a visit on Saturday is briefed once on Friday morning and again on Saturday morning - two
rem different keys, two deliberate sends. A team member therefore learns about a visit a full day ahead and
rem is reminded on the morning itself, which is the pattern they asked for.
rem
rem Two separate runs rather than one: --today and --tomorrow are separate selections inside send-briefing,
rem and a single process cannot be both. The second is skipped entirely on a day with no visits tomorrow.
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

echo. >> "logs\briefings.log"
echo ---- tomorrow's visits, a day's notice ---- >> "logs\briefings.log"
"%NODE%" scripts\send-briefing.mjs --tomorrow >> "logs\briefings.log" 2>&1
endlocal
