@echo off
rem Watch the automation. Double-click this file.
rem
rem Shows what it is doing right now, which lead it is on, what is queued, whether REI is still signed in,
rem and whether the work-queue card can post. The window that opens is the dashboard's engine - leave it
rem open while you watch, and closing it closes only the dashboard. The automation runs on its own either
rem way; nothing here starts or stops it.
rem
rem It is only reachable from THIS PC (127.0.0.1). The page shows seller names and addresses, so it is
rem deliberately not published to the office network.
setlocal
cd /d "%~dp0.."

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

set "PORT=7777"
if not "%~1"=="" set "PORT=%~1"

rem Open the browser first, then start the server. The other order looks more logical and is worse: the
rem server never returns while it is listening, so the browser line would not run until somebody closed it.
rem A page that loads a second before its server is ready simply retries - it polls every three seconds.
start "" "http://127.0.0.1:%PORT%/"

echo.
echo   Dashboard running at http://127.0.0.1:%PORT%/
echo   Leave this window open. Close it to stop the dashboard - the automation is unaffected.
echo.

"%NODE%" scripts\dashboard.mjs --port %PORT%
endlocal
