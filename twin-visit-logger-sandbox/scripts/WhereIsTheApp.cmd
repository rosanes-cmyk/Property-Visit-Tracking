@echo off
rem Print the folder the scheduled tasks ACTUALLY run the automation from, and which PC this is.
rem
rem A launcher only. The work is in WhereIsTheApp.ps1 next to this file, because the first version was one
rem `powershell -Command` with twenty ^-continued lines escaping pipes and quotes past cmd's parser - and it
rem got its own answer wrong twice, which is the worst thing a diagnostic can do.
rem
rem ASCII ONLY IN THIS FILE, including the comments. The console runs in codepage 437, so a UTF-8 em-dash
rem printed here arrived on the client's screen as three garbage characters in the middle of a sentence.
rem A plain hyphen reads correctly everywhere. (The first draft of this very comment quoted those garbage
rem characters, which put them straight back into the file.)
rem
rem The name has no hyphen on purpose - this client's browser strips hyphens from downloaded filenames.
setlocal

set "PS1=%~dp0WhereIsTheApp.ps1"
if not exist "%PS1%" (
  echo.
  echo   WhereIsTheApp.ps1 is missing from this scripts folder.
  echo   Download it alongside WhereIsTheApp.cmd - they are a pair.
  echo.
  echo   Looked for: %PS1%
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

echo   ----------------------------------------------------------------------
echo   Run the CopyUpdates.cmd shown next to "RUN THIS" above.
echo.
echo   If no task was found but a folder IS listed, that folder is a working
echo   install - the automation is just not SCHEDULED on this PC. Check the
echo   machine name in the Chat cards against "THIS PC" above.
echo.
pause
endlocal
