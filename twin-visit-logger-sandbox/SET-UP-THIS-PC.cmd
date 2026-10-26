@echo off
rem ======================================================================
rem  TWIN VISIT LOGGER - set this PC up. Double-click this file.
rem ======================================================================
rem
rem The only thing anyone runs on a new machine. It prepares Windows, signs you in to Google and to REI,
rem claims this PC as the active one, schedules the jobs, checks that it works, and then makes the jobs
rem survive a reboot so nobody ever has to be signed in.
rem
rem It is safe to run again. Every step skips what is already done, so a run that stopped half way can be
rem repeated once the problem it reported is fixed.
rem
rem It lives in the FOLDER ROOT rather than in scripts\ on purpose: this is the file a person is looking
rem for when they open the folder for the first time, and burying it among forty others is how somebody
rem ends up double-clicking recheck.cmd to "get started".
rem
rem WHY IT ASKS FOR ADMINISTRATOR
rem
rem Two of the steps need it: letting Windows sign back in by itself after a restart, and registering the
rem jobs to run with nobody logged on. Both are the difference between a server that recovers from a 2am
rem Windows Update and one that sits dead until somebody walks over. Asking once here is better than a
rem person discovering "Access is denied" three commands in, which is exactly how the last move went.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   This needs administrator rights. Approving the prompt that is about to appear.
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  exit /b
)

rem The bundled Node when this is the packaged app; otherwise whatever is installed.
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

rem Playwright looks here for Chromium. Set for the packaged folder so nothing is ever downloaded.
if exist "%~dp0browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"

if not exist "%~dp0node_modules" (
  echo.
  echo   This folder has no node_modules, so it is the source checkout rather than the packaged app.
  echo   Run:  npm install
  echo   Then double-click this file again.
  echo.
  pause
  exit /b 1
)

rem ----------------------------------------------------------------- 1 of 3
rem Prepare Windows. Refuses a folder under Downloads or OneDrive, clears the Mark of the Web from every
rem file, checks credentials.json is here, stops the machine sleeping, and lets Windows sign back in after
rem a restart. -SkipInstall because the packaged folder already carries node_modules and the browser.
echo.
echo   [1 of 3]  Preparing Windows...
powershell -ExecutionPolicy Bypass -File ".\scripts\move-to-this-pc.ps1" -SkipInstall
if errorlevel 1 (
  echo.
  echo   Preparation stopped. Fix what it reported above, then double-click this file again.
  echo.
  pause
  exit /b 1
)

rem ----------------------------------------------------------------- 2 of 3
rem The two sign-ins and the scheduling. A browser opens twice; neither can be automated, and the REI one
rem is a refusal rather than a limitation - storing that password would copy it onto every PC this is ever
rem installed on.
echo.
echo   [2 of 3]  Signing in and scheduling the jobs...
echo.
"%NODE%" scripts\setup-app.mjs %*
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
  echo.
  echo   Setup did not finish. Read the "--^>" lines above - each one says what to do.
  echo   Nothing is half-written; fix the problem and double-click this file again.
  echo.
  pause
  exit /b %RC%
)

rem ----------------------------------------------------------------- 3 of 3
rem The step that ends the fault every outage so far has had. Without it the jobs run only while somebody
rem is signed in to Windows, so a 2am update reboot stops everything while Task Scheduler still reports
rem Ready and Last Result 0 - a task that never fired cannot fail.
echo.
echo   [3 of 3]  Making the jobs survive a restart.
echo.
echo   Windows needs this PC's password so it can sign the account in by itself after a reboot.
echo   It is stored by Windows, encrypted, and never written to a file or the repository.
echo.
echo   Press Enter to do this now, or close this window to skip it - the jobs will work either
echo   way, but they will stop whenever nobody is signed in.
echo.
pause >nul
powershell -ExecutionPolicy Bypass -File ".\scripts\run-without-login.ps1" -All

echo.
echo ======================================================================
echo   THIS PC IS SET UP.
echo ======================================================================
echo.
echo   Check it in an hour:   "%NODE%" scripts\health-check.mjs
echo   "All clear" means every job has run on its own.
echo.
echo   Lock the screen with Win+L when you walk away. Do not sign out.
echo.
pause
endlocal
