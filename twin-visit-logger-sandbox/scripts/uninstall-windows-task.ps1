$ErrorActionPreference = "Stop"
$taskName = "Twin Visit Logger Sandbox"
& schtasks.exe /Delete /TN $taskName /F
if ($LASTEXITCODE -ne 0) {
  throw "Could not delete Windows task: $taskName"
}
Write-Host "Deleted Windows task: $taskName"
