@echo off
rem Show what has been happening to the REI browser session. Double-click this after a logout.
rem
rem REI signs this machine out roughly daily. An evening of theorising ruled out two explanations and
rem produced no answer, so the runs now write down what actually happens and this file reads it back.
rem
rem WHAT TO LOOK FOR, in the lines below:
rem
rem   an OPEN with no CLOSE before the next OPEN
rem       the browser was killed. A killed Chromium never writes its cookies to disk, so the next run
rem       starts signed out. Look at what stopped it: the PC sleeping, or a task being cut off.
rem
rem   OPEN ... reiCookies=0
rem       the session was already gone BEFORE this run started. The loss happened earlier; keep reading
rem       upwards to the run that lost it.
rem
rem   OPEN ... sessionCookies=1 or more, followed by AUTH REI showed a login page
rem       the cookies were there and REI rejected them anyway. That is REI ending the session at its end,
rem       and it is a completely different problem from the two above.
rem
rem The name has no hyphen on purpose: this client's browser strips hyphens from downloaded filenames.
setlocal
cd /d "%~dp0.."

set "LOG=logs\rei-session.log"
echo.
echo   REI SESSION LOG  -  the last 40 entries
echo   %CD%\%LOG%
echo   ----------------------------------------------------------------------
echo.
if not exist "%LOG%" (
  echo   Nothing recorded yet. This starts filling in on the next run that opens REI.
  echo   If it is still empty tomorrow, the runs are not reaching the browser at all.
  echo.
  pause
  endlocal
  exit /b 0
)

rem Last 40 lines. PowerShell rather than a batch loop: this has to be readable, not clever.
powershell -NoProfile -Command "Get-Content -Path '%LOG%' -Tail 40"

echo.
echo   ----------------------------------------------------------------------
echo   An OPEN with no CLOSE after it = the browser was killed and the login was lost.
echo   OPEN with reiCookies=0        = it was already signed out before that run started.
echo   Cookies present but AUTH says login page = REI ended the session at its end.
echo.
pause
endlocal
