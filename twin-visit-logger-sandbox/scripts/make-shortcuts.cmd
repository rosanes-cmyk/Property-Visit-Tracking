@echo off
rem Double-click this ONCE and you never type a path again.
rem
rem A .cmd wrapper because the thing it fixes is "I had to type something": telling somebody to run a
rem PowerShell file with -ExecutionPolicy Bypass to stop having to type long commands would be a joke.
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcuts.ps1"
echo.
pause
endlocal
