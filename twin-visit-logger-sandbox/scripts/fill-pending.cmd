@echo off
setlocal
cd /d "%~dp0.."

rem The bundled runtime, when this is the packaged app.
rem
rem Without this, an install from the portable folder looks perfect and every scheduled job fails SILENTLY:
rem the packaged folder deliberately carries no Node on PATH, so a bare "node" is not found, and Task
rem Scheduler reports the task as having run. The same reasoning covers Chromium - Playwright would try to
rem download 150 MB on a machine with nobody watching and possibly no internet.
set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
if exist "%~dp0..\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\browsers"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
if not exist logs mkdir logs

rem Finish the rows a colleague added on the board — the ones parked with "PENDING REI LOOKUP".
rem
rem --wait, for the same reason the bucket sweep waits: a colleague is watching that record on the board,
rem so "skipped, try again later" is a person staring at a row that never completes. The runs are short —
rem usually no pending rows at all, in which case it never opens a browser.
if exist "logs\fill-pending.log" (
  for %%A in ("logs\fill-pending.log") do if %%~zA GTR 5000000 (
    if exist "logs\fill-pending.prev.log" del "logs\fill-pending.prev.log"
    move /y "logs\fill-pending.log" "logs\fill-pending.prev.log" >nul
  )
)

rem A log a second run cannot write to must not stop that run.
rem
rem This is what the client saw when they ran it by hand while the 2-minute scheduled copy was mid-run:
rem
rem   The process cannot access the file because it is being used by another process.
rem   The process cannot access the file because it is being used by another process.
rem   The process cannot access the file because it is being used by another process.
rem
rem Three lines for the three redirections below - and the third one is the node command, so THE RUN NEVER
rem HAPPENED. A person trying to unstick two bookings got three copies of a Windows error, no output, and no
rem way to tell that nothing had run at all. Worse, a scheduled run that overlaps its predecessor fails the
rem same way and logs nothing, so the one place anybody would look for the reason stays empty.
rem
rem So: try the shared log, and if it is held open, use a per-process one and SAY SO. Two logs is a nuisance;
rem a run that silently does not happen is the thing that cost two days of looking in the wrong places.
set "LOG=logs\fill-pending.log"
(echo.>> "%LOG%") 2>nul || (
  set "LOG=logs\fill-pending-%RANDOM%.log"
  echo The usual log is in use by another run - writing to a separate one instead:
  echo   %CD%\logs
  echo A scheduled copy is probably running right now. That is not a failure; it means this run had to
  echo log elsewhere. Both files are worth reading.
)
echo ==== %DATE% %TIME% ==== >> "%LOG%"
"%NODE%" scripts\fill-pending-rei.mjs --yes --scheduled >> "%LOG%" 2>&1
rem The exit code, so a person running this by hand knows whether it did anything.
if errorlevel 1 (
  echo.
  echo It finished with an error. The reason is at the end of:
  echo   %CD%\%LOG%
) else (
  echo.
  echo Finished. What it did is at the end of:
  echo   %CD%\%LOG%
)
endlocal
