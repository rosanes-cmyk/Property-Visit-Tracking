# One screen that answers "is it working?"
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
#   scripts\status.cmd
#
# The client asked it three times in a day, and every honest answer was "read four different log files and
# the Task Scheduler window". That is not an answer somebody checks on a Saturday, so nobody checks, and a
# job that quietly stopped a week ago looks exactly like a job that is working.
#
# Deliberately read-only: it opens no browser, touches no sheet, and takes no lock. It can be run at any
# time, including while a sweep is mid-flight, without disturbing anything.

$ErrorActionPreference = "SilentlyContinue"
Set-Location (Split-Path $PSScriptRoot -Parent)

$now = Get-Date
Write-Host ""
Write-Host "TWIN VISIT LOGGER - STATUS   $($now.ToString('ddd dd MMM, h:mm tt'))" -ForegroundColor Cyan
Write-Host ("-" * 64)

# ---- 1. Is it switched on at all? -------------------------------------------------
# Checked first because everything below is meaningless if the answer is no. A paused system still has
# tasks that "ran successfully" — they ran, saw the pause, and exited.
if (Test-Path "data\PAUSED") {
  Write-Host "  PAUSED  - the file data\PAUSED exists. Run scripts\resume.cmd" -ForegroundColor Yellow
} else {
  Write-Host "  RUNNING - not paused" -ForegroundColor Green
}

# ---- 2. Is anything working right now? --------------------------------------------
# A lock older than about half an hour is a run that died holding it, not a run still going.
if (Test-Path "data\run.lock") {
  $age = [int]((Get-Date) - (Get-Item "data\run.lock").LastWriteTime).TotalMinutes
  if ($age -gt 30) {
    Write-Host "  STUCK   - a REI run has held the lock for $age min. It probably died." -ForegroundColor Red
    Write-Host "            Close any automation browser, then: del data\run.lock"
  } else {
    Write-Host "  BUSY    - a REI run is working now (started $age min ago)" -ForegroundColor Green
  }
} else {
  Write-Host "  IDLE    - no REI run in progress"
}

# ---- 3. Did each timer fire, and did it end cleanly? ------------------------------
Write-Host ""
Write-Host "SCHEDULED TASKS" -ForegroundColor Cyan
$tasks = Get-ScheduledTask -TaskName "Twin Visit Logger*"
if (-not $tasks) {
  Write-Host "  NONE INSTALLED - run scripts\install-windows-task.ps1 as Administrator" -ForegroundColor Red
}
foreach ($t in $tasks) {
  $info = $t | Get-ScheduledTaskInfo
  $last = if ($info.LastRunTime.Year -lt 2000) { "never" } else { $info.LastRunTime.ToString("ddd h:mm tt") }
  # 0 is success. 267009 is "currently running", which is not a failure and must not be shown as one.
  $verdict = switch ($info.LastTaskResult) {
    0       { "ok" }
    267009  { "running now" }
    267011  { "not run yet" }
    default { "FAILED ($($info.LastTaskResult))" }
  }
  $colour = if ($verdict -like "FAILED*") { "Red" } else { "Gray" }
  Write-Host ("  {0,-34} last {1,-16} {2}" -f $t.TaskName, $last, $verdict) -ForegroundColor $colour
}

# ---- 4. Did the work actually happen? ---------------------------------------------
# "The task ran" and "the job did something" are different claims. The task result only proves the first.
Write-Host ""
Write-Host "LAST TIME EACH JOB ACTUALLY RAN" -ForegroundColor Cyan
$jobs = @(
  @{ name = "booking intake"; log = "logs\scheduled-task.log" },
  @{ name = "REI re-check";   log = "logs\recheck-task.log" },
  @{ name = "bucket sweep";   log = "logs\bucket-task.log" },
  @{ name = "notes audit";    log = "logs\audit-notes.log" }
)
foreach ($j in $jobs) {
  if (Test-Path $j.log) {
    $stamp = (Select-String -Path $j.log -Pattern '^==== ' | Select-Object -Last 1).Line
    if ($stamp) { $stamp = $stamp.Replace('====', '').Trim() } else { $stamp = "(no dated entry)" }
    Write-Host ("  {0,-16} {1}" -f $j.name, $stamp)
  } else {
    Write-Host ("  {0,-16} no log yet - has never run" -f $j.name) -ForegroundColor Yellow
  }
}

# ---- 5. The two failures that look like success -----------------------------------
# Both of these exit 0 and leave a full-looking log, so neither shows up anywhere above.
Write-Host ""
Write-Host "PROBLEMS IN THE LAST 200 LINES" -ForegroundColor Cyan
$found = $false
foreach ($j in $jobs) {
  if (-not (Test-Path $j.log)) { continue }
  $tail = Get-Content $j.log -Tail 200
  if ($tail -match 'logged out|log in again|npm run login:rei') {
    Write-Host "  $($j.name): REI is LOGGED OUT - run: npm run login:rei" -ForegroundColor Red
    $found = $true
  }
  if ($tail -match 'skipped, to avoid two browsers') {
    Write-Host "  $($j.name): skipped because another REI run held the lock" -ForegroundColor Yellow
    $found = $true
  }
  if ($tail -match 'stayed busy for 12 minutes') {
    Write-Host "  $($j.name): waited 12 min and gave up - something is holding the lock" -ForegroundColor Red
    $found = $true
  }
}
if (-not $found) { Write-Host "  none" -ForegroundColor Green }

Write-Host ""
Write-Host "See the detail with:  Get-Content logs\bucket-task.log -Tail 40"
Write-Host ""
