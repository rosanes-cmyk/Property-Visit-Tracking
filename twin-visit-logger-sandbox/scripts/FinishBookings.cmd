@echo off
rem Finish the bookings sitting in BEING ADDED. Double-click this one.
rem
rem WHY THIS EXISTS SEPARATELY FROM fill-pending.cmd
rem
rem fill-pending.cmd is the SCHEDULER's copy, and it is right for the scheduler: it passes --scheduled,
rem which waits only 90 seconds for the browser (comfortably inside its own 2-minute period, so copies
rem cannot stack) and exits 0 when it gives up, because another run is along in two minutes.
rem
rem Every one of those choices is wrong for a person, and the client hit all three in one afternoon with
rem two bookings stuck on the board:
rem
rem   - it waited 90 seconds, lost the race to a scheduled run, and gave up
rem   - it exited 0 and printed "Finished.", so it reported success having done nothing
rem   - it redirected everything to a log, so the window sat BLANK and then closed itself instantly
rem
rem A person watching that has no way to tell it from working. They ran it repeatedly and the cards stayed
rem stuck for six hours.
rem
rem So this file is the same job with the opposite defaults: wait the full twelve minutes, print to the
rem SCREEN so the waiting is visible, and stay open at the end so the result can be read. fill-pending.cmd
rem is deliberately left exactly as it is - the scheduled task runs it every two minutes and must keep its
rem short wait, so this could not be a flag on the same file without the risk of the installer not being
rem re-run and scheduled copies stacking up.
rem
rem The name has no hyphen on purpose. This client's browser strips hyphens out of downloaded filenames,
rem which has broken half a dozen copy-paste instructions in this project already.
setlocal
cd /d "%~dp0.."

rem The bundled runtime, when this is the packaged app. Without it a bare "node" is not found and the run
rem fails for a reason that has nothing to do with REI.
set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
if exist "%~dp0..\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"

echo.
echo   FINISHING PENDING BOOKINGS
echo.
echo   These are the cards sitting under BEING ADDED on the board.
echo.
echo   If a scheduled run is using the browser, this WAITS for it - up to 12 minutes -
echo   and says so every 30 seconds. A quiet gap is normal. Leave this window open.
echo.
echo   ----------------------------------------------------------------------
echo.

rem No --scheduled: the full 12-minute wait, and a non-zero exit if it genuinely could not run.
rem No redirect: the point of this file is that a person can SEE it working.
"%NODE%" scripts\fill-pending-rei.mjs --yes
set RC=%ERRORLEVEL%

echo.
echo   ----------------------------------------------------------------------
echo.
if %RC%==0 (
  echo   DONE. Refresh the board - the cards above should be gone.
  echo.
  echo   If a card is still there, it is not a browser problem: send me this window.
) else (
  echo   IT DID NOT FINISH - exit code %RC%.
  echo.
  echo   Read the lines above: they say why. The two usual reasons are that REI has
  echo   signed itself out - run scripts\login-rei.cmd and sign in - or that a run has
  echo   been holding the browser for over 12 minutes, which means something is stuck.
  echo.
  echo   Either way, send me this window.
)
echo.
pause
endlocal
