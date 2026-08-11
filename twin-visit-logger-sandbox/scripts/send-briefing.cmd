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

echo.
echo   SEND A VISIT BRIEFING TO GOOGLE CHAT
echo.
echo   Type a seller name (or part of an address).
echo   Or type  today     for every visit on today's calendar.
echo   Or type  tomorrow  for tomorrow's.
echo.
set "WHO="
set /p WHO=  Who is it for?

if /i "%WHO%"=="today"    ( "%NODE%" scripts\send-briefing.mjs --today    & goto done )
if /i "%WHO%"=="tomorrow" ( "%NODE%" scripts\send-briefing.mjs --tomorrow & goto done )
if "%WHO%"=="" (
  echo.
  echo   Nothing typed - nothing sent.
  goto done
)
"%NODE%" scripts\send-briefing.mjs "%WHO%"

:done
echo.
pause
endlocal
