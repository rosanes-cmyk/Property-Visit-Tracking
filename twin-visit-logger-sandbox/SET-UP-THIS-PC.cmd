@echo off
rem ======================================================================
rem  TWIN VISIT LOGGER - set this PC up. Double-click this file.
rem ======================================================================
rem
rem This is the only thing anyone needs to run on a new machine. It reads its settings out of the workbook,
rem signs you in to Google and to REI, claims this PC as the active one, schedules the eight jobs, and
rem checks that it works.
rem
rem It is safe to run again. Every step skips what is already done, so a run that stopped half way can
rem simply be repeated once the problem it reported is fixed.
rem
rem It lives in the FOLDER ROOT rather than in scripts\ on purpose: this is the file a person is looking
rem for when they open the folder for the first time, and burying it among forty others is how somebody
rem ends up double-clicking recheck.cmd to "get started".
setlocal
cd /d "%~dp0"

rem The bundled Node when this is the packaged app; otherwise whatever is installed.
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

rem Playwright looks here for Chromium. Set for the packaged folder so nothing is ever downloaded.
if exist "%~dp0browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"

rem Mark of the Web. A file that arrived in a zip from the internet is blocked, and a BLOCKED script fails
rem silently when Windows runs it on a schedule - the task reports success and does nothing. It cost a full
rem debugging session once already, so clearing it is part of setup rather than a note in a document.
powershell -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -Path '%~dp0' -Recurse -Include *.cmd,*.ps1,*.vbs,*.mjs,*.js,*.json -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

if not exist "%~dp0node_modules" (
  echo.
  echo   This folder has no node_modules, so it is the source checkout rather than the packaged app.
  echo   Run:  npm install
  echo   Then double-click this file again.
  echo.
  pause
  exit /b 1
)

"%NODE%" scripts\setup-app.mjs %*
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
  echo   Setup finished. You can close this window.
) else (
  echo   Setup did not finish. Read the "--->" lines above - each one says what to do.
  echo   Nothing is half-written; fix the problem and double-click this file again.
)
echo.
pause
endlocal
