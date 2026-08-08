@echo off
rem Double-click, or type scripts\status.cmd — no PowerShell knowledge needed.
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File "%~dp0status.ps1"
echo.
pause
