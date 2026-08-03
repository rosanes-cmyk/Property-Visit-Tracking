# Remove the Windows scheduled tasks.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
#
# Deletes both tasks. Missing ones are reported, not treated as an error - the point is to end up
# with none of them, and failing because one was already gone would be unhelpful.
$ErrorActionPreference = "Continue"

foreach ($name in @("Twin Visit Logger Sandbox", "Twin Visit Logger WhatsApp")) {
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
