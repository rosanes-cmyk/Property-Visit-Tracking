# Install the Windows scheduled task that processes REI bookings automatically.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1 -IntervalMinutes 1
#
# Runs hidden (via run-hidden.vbs) so no console window appears, and only while this Windows user is
# logged on - the run needs that user's Google OAuth token and REI browser profile.
#
# NOTE ON INTERVAL: one run takes roughly 1.5-2 minutes, because it drives a real browser through
# REI. A 1-minute interval therefore overlaps itself; the run lock makes the extra launch exit
# immediately rather than duplicating work, so nothing breaks - it just wastes launches. 2-3 minutes
# gives the same practical freshness with no collisions.
param(
  [int]$IntervalMinutes = 2
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1 -or $IntervalMinutes -gt 1439) {
  throw "IntervalMinutes must be between 1 and 1439."
}

$taskName = "Twin Visit Logger Sandbox"
$launcher = Join-Path $PSScriptRoot "run-hidden.vbs"
$runner = Join-Path $PSScriptRoot "run-once.cmd"

if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }
if (-not (Test-Path $launcher)) { throw "Hidden launcher not found: $launcher" }

$taskCommand = 'wscript.exe "' + $launcher + '"'
& schtasks.exe /Create /SC MINUTE /MO $IntervalMinutes /TN $taskName /TR $taskCommand /F
if ($LASTEXITCODE -ne 0) {
  throw "Windows Task Scheduler creation failed with exit code $LASTEXITCODE."
}

Write-Host ""
Write-Host "Created scheduled task '$taskName' - runs every $IntervalMinutes minute(s), hidden."
Write-Host ""
Write-Host "Log:     logs\scheduled-task.log"
Write-Host "Status:  schtasks /Query /TN `"$taskName`""
Write-Host "Run now: schtasks /Run /TN `"$taskName`""
Write-Host "Remove:  powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1"
Write-Host ""
Write-Host "Requirements: this Windows user stays logged on, the machine stays awake, and the REI"
Write-Host "session stays valid (re-run 'node scripts\rei-login.mjs' when REI logs you out)."
Write-Host "Tip: set REI_HEADLESS=true in .env so the browser does not appear on every run."
