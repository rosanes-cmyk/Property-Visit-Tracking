# Install the Windows scheduled tasks so everything runs without opening PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1 -IntervalMinutes 2 -WhatsAppIntervalMinutes 5
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1 -SkipWhatsApp
#
# TWO tasks, on purpose, because they are two different jobs:
#
#   "Twin Visit Logger Sandbox"   every 2 min   REI email -> scrape -> sheet -> Juan's calendar
#   "Twin Visit Logger WhatsApp"  every 2 min   create the WhatsApp group for any new visit
#
# The WhatsApp one used to default to 15 minutes, on the reasoning that it drives a second browser and
# that hammering WhatsApp Web attracts attention. That reasoning was wrong, and the code says so: the
# watcher reads the calendar, and if there is no new visit it RETURNS BEFORE OPENING WHATSAPP AT ALL.
# An idle run costs one Calendar API call. WhatsApp Web is only opened when a group genuinely needs
# creating, which is a handful of times a week no matter how often the timer fires. So there was
# nothing to save, and a quarter of an hour of pointless delay between the calendar event and the
# group. Both run every 2 minutes now.
#
# Overlap is handled: each runner takes a NAMED lock, so a second launch while one is still working
# exits immediately instead of two browsers fighting over the same profile.
#
# Both run hidden (run-hidden.vbs) and only while this Windows user is logged on - the runs need this
# user's Google OAuth token, REI browser profile and WhatsApp session.
#
# INTERVAL NOTE: one REI run takes roughly 1.5-2 minutes because it drives a real browser. A
# 1-minute interval overlaps itself; the named run lock makes the extra launch exit immediately
# rather than duplicating work, so nothing breaks - it just wastes launches.
param(
  [int]$IntervalMinutes = 2,
  [int]$WhatsAppIntervalMinutes = 2,
  # How often to go back to REI for leads already in the tracker. Two hours matches the short clock in
  # recheck.mjs for a visit whose date has passed while the row still says Scheduled — the case where the
  # board is actively wrong about today. Anything much tighter just opens browsers for no reason.
  [int]$RecheckIntervalMinutes = 20,
  # How often to re-read the tracker's OWN notes for outcomes a colleague has written. Hourly, not every
  # 20 minutes: this needs no browser and reads the whole sheet in one API call, but notes do not change
  # minute to minute, and it is the only job here that can touch all 378 rows rather than the 102 with a
  # REI link. It is how "Cancelled the property visit" and "Pending reschedule" reached the board at all.
  [int]$NotesIntervalMinutes = 60,
  [switch]$SkipNotes,
  [switch]$SkipRecheck,
  [switch]$SkipWhatsApp
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1 -or $IntervalMinutes -gt 1439) {
  throw "IntervalMinutes must be between 1 and 1439."
}
if ($RecheckIntervalMinutes -lt 5 -or $RecheckIntervalMinutes -gt 1439) {
  throw "RecheckIntervalMinutes must be between 5 and 1439. Each run opens a REI browser page per lead."
}
if ($NotesIntervalMinutes -lt 10 -or $NotesIntervalMinutes -gt 1439) {
  throw "NotesIntervalMinutes must be between 10 and 1439. Each run reads the whole tab."
}
if ($WhatsAppIntervalMinutes -lt 1 -or $WhatsAppIntervalMinutes -gt 1439) {
  throw "WhatsAppIntervalMinutes must be between 1 and 1439."
}

$launcher = Join-Path $PSScriptRoot "run-hidden.vbs"
if (-not (Test-Path $launcher)) { throw "Hidden launcher not found: $launcher" }

function New-VisitTask {
  param([string]$Name, [string]$Runner, [int]$Every, [string]$What)

  $runnerPath = Join-Path $PSScriptRoot $Runner
  if (-not (Test-Path $runnerPath)) { throw "Runner not found: $runnerPath" }

  # The runner name is passed to the launcher, so one .vbs serves both tasks.
  $command = 'wscript.exe "' + $launcher + '" "' + $Runner + '"'
  & schtasks.exe /Create /SC MINUTE /MO $Every /TN $Name /TR $command /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Creating scheduled task '$Name' failed with exit code $LASTEXITCODE."
  }
  Write-Host ("  {0,-30} every {1,3} min   {2}" -f $Name, $Every, $What)
}

Write-Host ""
Write-Host "Created:"
New-VisitTask -Name "Twin Visit Logger Sandbox" -Runner "run-once.cmd" `
  -Every $IntervalMinutes -What "REI -> sheet -> Juan's calendar"

if (-not $SkipWhatsApp) {
  New-VisitTask -Name "Twin Visit Logger WhatsApp" -Runner "whatsapp-watch.cmd" `
    -Every $WhatsAppIntervalMinutes -What "create the WhatsApp group"
} else {
  Write-Host "  (WhatsApp task skipped: -SkipWhatsApp)"
}

if (-not $SkipRecheck) {
  New-VisitTask -Name "Twin Visit Logger REI Recheck" -Runner "recheck.cmd" `
    -Every $RecheckIntervalMinutes -What "re-read REI for leads already logged"
} else {
  Write-Host "  (REI re-check task skipped: -SkipRecheck)"
}

if (-not $SkipNotes) {
  New-VisitTask -Name "Twin Visit Logger Notes Audit" -Runner "audit-notes.cmd" `
    -Every $NotesIntervalMinutes -What "read the tracker's own notes for visit outcomes"
} else {
  Write-Host "  (notes audit task skipped: -SkipNotes)"
}

Write-Host ""
Write-Host "Logs:"
Write-Host "  logs\scheduled-task.log     the REI runs"
if (-not $SkipWhatsApp) { Write-Host "  logs\whatsapp-task.log      the WhatsApp runs" }
if (-not $SkipRecheck) { Write-Host "  logs\recheck-task.log       the REI re-checks" }
if (-not $SkipNotes) { Write-Host "  logs\audit-notes.log        the notes audit" }
Write-Host ""
Write-Host "Check them with:   Get-Content logs\scheduled-task.log -Tail 30"
Write-Host "See the tasks:     schtasks /Query /TN `"Twin Visit Logger Sandbox`""
Write-Host "Remove them:       powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1"
Write-Host ""
Write-Host "These only run while you are logged in to Windows. If the PC sleeps, nothing runs -"
Write-Host "the next run after it wakes picks up whatever accumulated."
