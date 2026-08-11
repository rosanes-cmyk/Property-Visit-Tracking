@echo off
rem Check for an update and install it. Double-click this file.
rem
rem   update-app.cmd                just look, and say what it found
rem   update-app.cmd --install      fetch it and swap it in
rem   update-app.cmd --rollback     put the previous version back
rem
rem Updates arrive through a folder in YOUR Google Drive called "Twin Visit Logger Updates". The app reads it
rem with the Google login it already has, so there is no password to store anywhere and nothing to host.
rem
rem KEEP THAT FOLDER PRIVATE TO YOU. Anything in it gets RUN on this PC, as this Windows user, with the
rem Google token and the REI session sitting right there. Anyone you give edit access to can run code on this
rem machine. Not shared with the team, not "anyone with the link".
rem
rem It is a button rather than an automatic overnight thing on purpose - a bad version installing itself while
rem nobody is watching is how an automation stops for a day before anyone notices.
setlocal
cd /d "%~dp0.."

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

"%NODE%" scripts\update-app.mjs %*
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
  echo   Nothing further to do here.
) else (
  echo   The update did not go ahead. Your app is untouched and still running.
)
echo.
pause
endlocal
