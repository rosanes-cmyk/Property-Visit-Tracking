@echo off
rem Make THIS PC the one that runs the automation. Double-click it.
rem
rem This is the whole recovery procedure. If the PC that normally runs the automation is broken, off, or
rem being replaced, walk to another one that has the app installed, double-click this, and it takes over.
rem
rem Why it is not automatic: two PCs driving REI on the same account is what kept logging REI out. So the
rem workbook records which machine is the active one, every scheduled job checks it, and a spare machine
rem stands down quietly instead of fighting. Moving it is a deliberate act, which is this file.
setlocal
cd /d "%~dp0.."

set "NODE=node"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"

"%NODE%" scripts\make-this-pc-active.mjs %*
echo.
pause
endlocal
