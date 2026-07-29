$ErrorActionPreference = "Stop"
$taskName = "Twin Visit Logger Sandbox"
$runner = Join-Path $PSScriptRoot "run-once.cmd"

if (-not (Test-Path $runner)) {
  throw "Runner not found: $runner"
}

$taskCommand = '"' + $runner + '"'
& schtasks.exe /Create /SC MINUTE /MO 5 /TN $taskName /TR $taskCommand /F
if ($LASTEXITCODE -ne 0) {
  throw "Windows Task Scheduler creation failed with exit code $LASTEXITCODE."
}

Write-Host "Created Windows task: $taskName"
Write-Host "It runs every five minutes while the Windows user has access to the local OAuth token and REI sandbox profile."
