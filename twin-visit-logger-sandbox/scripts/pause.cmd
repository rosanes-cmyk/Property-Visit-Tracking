@echo off
REM Pause the automation. Nothing runs on its own until scripts\resume.cmd.
REM
REM This does NOT need administrator rights, which is the point: schtasks /Change /DISABLE
REM answered "Access is denied" on this machine, so the scheduler is not a reliable switch.
REM The scheduled tasks still fire; they now stop immediately and do nothing.
cd /d "%~dp0.."
if not exist data mkdir data
echo paused %DATE% %TIME% > data\PAUSED
echo.
echo   AUTOMATION PAUSED.
echo.
echo   The scheduled runs will start, see this, and stop without reading or writing anything.
echo   Nothing is posted to Chat by the Node side either.
echo.
echo   To run one command anyway:  add --force
echo      node scripts\recheck-rei.mjs --only "Walker" --yes --force
echo.
echo   To resume:  scripts\resume.cmd
echo.
echo   NOTE: the 11am and 3pm Chat digest is posted by Google Apps Script, not from this PC,
echo         so it is NOT affected. To stop that too, open the sheet, Extensions - Apps Script,
echo         click the clock icon (Triggers) and delete the two digest triggers.
echo.
pause
