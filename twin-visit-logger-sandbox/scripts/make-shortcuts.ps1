# Put the handful of things a person ever needs to click on the Desktop.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\make-shortcuts.ps1
#
# The client, after being handed a full path to paste for the third time: "but thewhy do i need to type
# that?" They do not, and they never should have.
#
# installer\TwinVisitLogger.iss already creates exactly these shortcuts — but the installer was never built,
# so this PC was set up by unzipping a folder into C:\TwinVisitLogger\..., which produces no Start-menu entry
# and no icons. The scripts have always been double-clickable; there was simply nothing anywhere pointing at
# them, so every instruction became a 120-character path pasted into a black window, and one of those pastes
# duplicated itself into "hostnamehostname".
#
# Nothing here is new capability. It is the same .cmd files, findable.
#
# Numbered, because the order matters on the one day anybody opens this folder: a signed-out REI is the cause
# of most of what goes wrong, and the sweep and the pending bookings are what you run after fixing it.

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktop = [Environment]::GetFolderPath("Desktop")
$folder = Join-Path $desktop "Twin Visit Logger"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# name -> the runner it points at. Kept in step with the [Icons] section of the installer on purpose: two
# lists of shortcuts that disagree is worse than one list, because the wrong one is always the one in front
# of somebody.
$links = [ordered]@{
  "1 - Sign in to REI"          = "scripts\login-rei.cmd"
  "2 - Sweep REI now"           = "scripts\recheck-buckets.cmd"
  # FinishBookings.cmd, NOT fill-pending.cmd. The latter is the scheduler's copy: it waits 90 seconds,
  # exits 0 when it gives up, and hides its output in a log — so a person double-clicking it saw a blank
  # window close itself and report success while two bookings stayed stuck for six hours.
  "3 - Finish pending bookings" = "scripts\FinishBookings.cmd"
  "Dashboard - is it working"   = "scripts\dashboard.cmd"
  "Health check"                = "scripts\status.cmd"
  "Check for an update"         = "scripts\update-app.cmd"
}

$shell = New-Object -ComObject WScript.Shell
$made = 0
foreach ($name in $links.Keys) {
  $target = Join-Path $root $links[$name]
  # A shortcut to a file that is not there is worse than no shortcut: it looks like the feature exists and
  # fails only when somebody is relying on it.
  if (-not (Test-Path $target)) {
    Write-Warning ("Skipped '{0}' - {1} is not in this folder." -f $name, $links[$name])
    continue
  }
  $lnk = $shell.CreateShortcut((Join-Path $folder ($name + ".lnk")))
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $root      # every runner does cd /d "%~dp0.." itself, but be explicit
  $lnk.Description = "Twin Visit Logger - " + $name
  $lnk.Save()
  $made++
}

Write-Host ""
Write-Host ("Made {0} shortcut(s) in:" -f $made)
Write-Host ("  {0}" -f $folder)
Write-Host ""
Write-Host "That folder is on your Desktop. Nothing here needs a path typed again."
Write-Host ""
Write-Host "The usual fix, in order:"
Write-Host "  1 - Sign in to REI            when a booking says it could not be logged"
Write-Host "  2 - Sweep REI now             when the work queue says it is being held back"
Write-Host "  3 - Finish pending bookings   when a card sits in BEING ADDED"
