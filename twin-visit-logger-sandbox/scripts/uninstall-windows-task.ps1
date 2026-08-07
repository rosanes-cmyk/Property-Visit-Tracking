# Remove the Windows scheduled tasks.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
#
# Deletes both tasks. Missing ones are reported, not treated as an error - the point is to end up
# with none of them, and failing because one was already gone would be unhelpful.
$ErrorActionPreference = "Continue"

# ALL FOUR the installer creates. This listed two, so "Nothing is scheduled any more" was untrue: the REI
# re-check and the hourly notes audit carried on running, and the notes audit writes Visit Status and
# Current Stage. Somebody who ran this to stop the automation still had their sheet changing under them.
foreach ($name in @("Twin Visit Logger Sandbox", "Twin Visit Logger WhatsApp",
                    "Twin Visit Logger REI Recheck", "Twin Visit Logger Notes Audit")) {
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
