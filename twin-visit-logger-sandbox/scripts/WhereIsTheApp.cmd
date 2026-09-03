@echo off
rem Print the folder the scheduled tasks ACTUALLY run the automation from.
rem
rem WHY THIS EXISTS. A live update copied nine files, reported COPIED for every one of them, and installed
rem none of them where they mattered:
rem
rem     to:   C:\Users\bryan\Downloads\twin-visit-logger-sandbox\twin-visit-logger-sandbox
rem
rem A freshly unzipped archive in Downloads, nested twice. CopyUpdates.cmd had been run from ITS scripts
rem folder, so it faithfully copied into it — and the app the timers run was never touched. Every line said
rem success. The fix appeared to install and changed nothing.
rem
rem There is no reason anybody should have to know which of several identical-looking folders is the real
rem one. Windows already knows: the scheduled task stores the full path it launches. This asks it.
rem
rem CopyUpdates.cmd now refuses a folder with no .env, or one under Downloads, and points here.
rem
rem The name has no hyphen on purpose — this client's browser strips hyphens from downloaded filenames.
setlocal

echo.
echo   WHERE IS THE AUTOMATION ACTUALLY INSTALLED?
echo   ----------------------------------------------------------------------
echo.

rem The task's action is:  wscript.exe "<APP>\scripts\run-hidden.vbs" "run-once.cmd"
rem so the app folder is two levels up from the path inside it. PowerShell does the string work, because
rem cmd's own parsing of a quoted path out of schtasks output is not worth reading later.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$names = @('Twin Visit Logger Sandbox','Twin Visit Logger Bucket Sweep','Twin Visit Logger Board Intake','Twin Visit Logger REI Recheck');" ^
  "$found = $false;" ^
  "foreach ($n in $names) {" ^
  "  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue;" ^
  "  if (-not $t) { continue }" ^
  "  foreach ($a in $t.Actions) {" ^
  "    $args = [string]$a.Arguments;" ^
  "    $m = [regex]::Match($args, '\"\"?(?<p>[A-Za-z]:\\\\[^\"\"]*run-hidden\.vbs)\"\"?');" ^
  "    if (-not $m.Success) { continue }" ^
  "    $app = Split-Path (Split-Path $m.Groups['p'].Value);" ^
  "    $found = $true;" ^
  "    Write-Host ('  TASK   ' + $n);" ^
  "    Write-Host ('  APP    ' + $app);" ^
  "    if (Test-Path (Join-Path $app '.env')) { Write-Host '         .env is there - this is a configured install' }" ^
  "    else { Write-Host '         ** no .env here - the task points at an unconfigured folder **' }" ^
  "    Write-Host ('  UPDATE ' + (Join-Path $app 'scripts\CopyUpdates.cmd'));" ^
  "    Write-Host '';" ^
  "  }" ^
  "}" ^
  "if (-not $found) {" ^
  "  Write-Host '  No Twin Visit Logger scheduled task was found on this PC.';" ^
  "  Write-Host '';" ^
  "  Write-Host '  Either the tasks were never installed, or they are under a different Windows user.';" ^
  "  Write-Host '  Folders on this machine that look like an install:';" ^
  "  Write-Host '';" ^
  "  $hits = Get-ChildItem -Path $env:USERPROFILE -Filter '.env' -Recurse -Force -ErrorAction SilentlyContinue -Depth 5 |" ^
  "    Where-Object { Test-Path (Join-Path $_.DirectoryName 'scripts\run-hidden.vbs') } | Select-Object -First 10;" ^
  "  if ($hits) { foreach ($h in $hits) { Write-Host ('    ' + $h.DirectoryName) } }" ^
  "  else { Write-Host '    (none found under ' + $env:USERPROFILE + ')' }" ^
  "}"

echo   ----------------------------------------------------------------------
echo   Run the CopyUpdates.cmd shown above — the one inside the APP folder.
echo   A copy sitting in Downloads is not the app, however right it looks.
echo.
pause
endlocal
