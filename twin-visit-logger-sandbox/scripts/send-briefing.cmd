@echo off
rem Send the visit briefing to Google Chat for a lead that is already booked. Double-click this file.
rem
rem It asks who it is for, then posts the PROPERTY INSPECTION block to Chat so you can copy it into the
rem visit's WhatsApp group.
rem
rem Why it is needed: the briefing normally goes out at the moment a booking is first processed. A visit
rem booked last week - or booked on a PC that has since been replaced - never gets another one, and a message
rem posted three days ago sits above hundreds of others. This asks for it on demand.
rem
rem The text comes from the calendar event's own description, which is what the visitor is already reading.
rem No REI browser, so it works in a second and works even when REI is logged out.
setlocal
cd /d "%~dp0.."

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

rem ======================================================================================================
rem  A NUMBERED CHOICE, not a free-text prompt.
rem
rem  The prompt asked "Who is it for?" and expected the words `today` or `tomorrow` typed exactly. The
rem  client ran it, nothing was sent, and what came back was the script's own usage text - three lines of
rem  `node scripts/send-briefing.mjs --tomorrow` - which reads like an error rather than an instruction.
rem  Their question was simply "what is this?", which is the right question to ask of it.
rem
rem  Almost everything else in this project is a double-click, and the two commonest answers here are
rem  today and tomorrow. So they are keys, and there is no way to type something that matches nothing.
rem
rem  --force on every path: somebody who has just asked for a briefing wants it now, whether or not one
rem  went out this morning. The de-duplication exists for the TIMER, which fires whether anybody asked.
rem ======================================================================================================
echo.
echo   SEND A VISIT BRIEFING TO GOOGLE CHAT
echo.
echo   This posts the PROPERTY INSPECTION block to Chat for a visit that is
echo   already on the calendar. Copy it into the visit's WhatsApp group.
echo.
echo     [1]  Tomorrow's visits
echo     [2]  Today's visits
echo     [3]  One seller, by name
echo     [4]  Cancel
echo.
choice /C 1234 /N /M "  Pick 1, 2, 3 or 4: "

rem ======================================================================================================
rem  LABELS, NOT PARENTHESISED BLOCKS, and that is a correctness fix rather than a style one.
rem
rem  cmd expands %VAR% when it PARSES a block, not when it runs it - so `set /p WHO=` followed by `%WHO%`
rem  inside the same ( ) reads the value the variable had BEFORE anything was typed, which is empty. The
rem  first draft of this menu had exactly that, and would have reported "nothing typed" at whatever name
rem  was entered. Delayed expansion would also fix it; a goto avoids needing to remember it at all.
rem
rem  Tested in descending order because `if errorlevel N` means "N or higher".
rem ======================================================================================================
if errorlevel 4 goto cancel
if errorlevel 3 goto byname
if errorlevel 2 goto todayvisits
goto tomorrowvisits

:tomorrowvisits
echo.
"%NODE%" scripts\send-briefing.mjs --tomorrow --force
goto done

:todayvisits
echo.
"%NODE%" scripts\send-briefing.mjs --today --force
goto done

:byname
echo.
set "WHO="
set /p WHO=  Seller name (or part of the address): 
if "%WHO%"=="" goto nothingtyped
"%NODE%" scripts\send-briefing.mjs "%WHO%" --force
goto done

:nothingtyped
echo.
echo   Nothing typed - nothing sent.
goto done

:cancel
echo.
echo   Cancelled - nothing sent.
goto done

:done
echo.
pause
endlocal
