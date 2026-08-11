@echo off
rem Sign in to REI. Double-click this - no terminal, no npm, no typed commands.
rem
rem This is the ONE thing about the automation that a person has to redo from time to time. REI ends the
rem session on its own; it always has, and it is why the browser lock exists. When it happens the sweep
rem reads nothing, the work-queue cards go stale, and Chat now says so by name:
rem
rem   REI is LOGGED OUT on <this-pc> - the sweep read 0 of 12 lead(s)
rem
rem The fix is this file. A browser window opens on REI, you sign in, you close it. The scheduled runs
rem pick the session up on their own - nothing needs restarting, and nothing was lost: a lead that failed
rem to be read is never recorded as checked, so it goes straight back to the front of the queue.
rem
rem The password is NOT stored anywhere by this project, deliberately. It would have to sit in a file that
rem gets copied to every PC and onto whatever stick carries the installer, and a leaked REI password is a
rem different order of problem from a spreadsheet nobody swept for an afternoon.
setlocal
cd /d "%~dp0.."

rem The bundled Node, when this is the packaged app; otherwise whatever is on PATH.
set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

rem And the bundled Chromium. This file OPENS A BROWSER, so without it Playwright would try to download one
rem - on the machine of somebody who is only trying to sign in again after REI logged them out.
if exist "%~dp0..\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"

echo.
echo   Opening REI so you can sign in.
echo.
echo   1. Sign in as normal.
echo   2. Wait until you can see your dashboard.
echo   3. Close the browser window.
echo.
echo   That is all. The scheduled runs take it from there.
echo.

"%NODE%" scripts\rei-login.mjs
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
  echo   SIGNED IN. The next scheduled run will read REI normally.
) else (
  echo   Something went wrong - exit code %RC%.
  echo   Try again, and if it keeps failing, run scripts\status.cmd and send me what it says.
)
echo.
pause
endlocal
