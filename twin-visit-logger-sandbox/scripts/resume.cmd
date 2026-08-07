@echo off
REM Resume the automation paused by scripts\pause.cmd.
cd /d "%~dp0.."
if exist data\PAUSED del /q data\PAUSED
echo.
echo   Pause file removed.
echo.
findstr /i /r "^AUTOMATION_PAUSED *= *\(1\|true\|yes\|on\)" .env >nul 2>&1
if %ERRORLEVEL%==0 (
  echo   STILL PAUSED: .env also sets AUTOMATION_PAUSED.
  echo   Open .env in Notepad and delete that line, then run this again.
) else (
  echo   AUTOMATION RESUMED. The next scheduled run will do its work as normal.
)
echo.
pause
