# Remove the Windows scheduled tasks.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
#
# Deletes every task. Missing ones are reported, not treated as an error - the point is to end up
# with none of them, and failing because one was already gone would be unhelpful.
#
# It does NOT release this PC's claim on the automation, and that is deliberate: this script is what somebody
# runs to STOP THE SCHEDULE on a machine they are keeping, which is not the same as handing the automation to
# another PC. Handing over is scripts\make-this-pc-active.mjs --release, and the uninstaller calls that
# separately.
$ErrorActionPreference = "Continue"

# ALL NINE names the installer can create - the six New-VisitTask calls plus the three fixed pre-card sweeps.
# This listed two, so "Nothing is scheduled any more" was untrue: the REI re-check and the hourly notes audit
# carried on running, and the notes audit writes Visit Status and Current Stage. Somebody who ran this to stop
# the automation still had their sheet changing under them.
foreach ($name in @("Twin Visit Logger Sandbox", "Twin Visit Logger WhatsApp",
                    "Twin Visit Logger REI Recheck", "Twin Visit Logger Board Intake",
  "Twin Visit Logger Sweep Before 0845", "Twin Visit Logger Sweep Before 1045",
  "Twin Visit Logger Sweep Before 1545",
  "Twin Visit Logger Morning Briefings",
  "Twin Visit Logger Notes Audit",
                    "Twin Visit Logger Bucket Sweep")) {
  & schtasks.exe /Query /TN $name > $null 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  not present: $name"
    continue
  }
  & schtasks.exe /Delete /TN $name /F | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "  removed: $name" }
  else { Write-Host "  COULD NOT REMOVE: $name (exit $LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Nothing is scheduled any more. Run by hand with:"
Write-Host "  node src\run-once.mjs"
Write-Host "  node src\whatsapp\watch.mjs --yes"
