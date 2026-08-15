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
  # The hourly sweep of the leads on the 3pm card. These are the ones somebody is actually working, so a
  # stale row costs something; the rest rotate through the ordinary re-check. The client: "we need to
  # prioritise those 8 buckets... time to time check in the REI of those every hour."
  [int]$BucketIntervalMinutes = 60,
  # How often to finish the rows a colleague added on the board. TWO minutes, matching the email intake:
  # the client's instruction was "work all ASAP", the person who typed it is watching that record, and a
  # run with nothing pending costs one Sheets read and never opens a browser at all.
  [int]$PendingIntervalMinutes = 2,
  [switch]$SkipPending,
  [switch]$SkipBuckets,
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
    # "ERROR: Access is denied." on /Create /F almost always means the task ALREADY EXISTS and was
    # created from an elevated prompt: overwriting it needs the same elevation that made it. Nothing is
    # wrong with the runner or the path, so say the one thing that fixes it rather than an exit code.
    # The same machine answered "Access is denied" to schtasks /Change /DISABLE for the same reason.
    throw @"
Creating scheduled task '$Name' failed with exit code $LASTEXITCODE.

If the line above says "Access is denied", the task already exists and was created from an
Administrator prompt. Re-run this installer the same way:

  Start menu -> type: powershell -> right-click "Windows PowerShell" -> Run as administrator
  cd "$((Resolve-Path (Join-Path $PSScriptRoot '..')).Path)"
  powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1 -SkipWhatsApp

The tasks still run as this Windows user either way - elevation only decides who may REPLACE them.
"@
  }
  Set-VisitTaskSettings -Name $Name
  Write-Host ("  {0,-30} every {1,3} min   {2}" -f $Name, $Every, $What)
}

<#
.SYNOPSIS
  Undo the three schtasks defaults that quietly stop an hourly task on a real laptop.

.DESCRIPTION
  This is the fault that took the automation down for two days. `schtasks /Create` was given no power or
  recovery flags, so the task inherited Windows' defaults, and `schtasks /query /v` showed exactly what they
  cost:

      Last Run Time:   8/14/2026 4:07:01 PM      <- ran, and succeeded
      Next Run Time:   8/14/2026 5:07:00 PM      <- never happened, and never rescheduled
      Power Management: Stop On Battery Mode, No Start On Batteries

  Three defaults, each individually reasonable:

    DisallowStartIfOnBatteries  the task will not START on battery
    StopIfGoingOnBatteries      a running task is KILLED the moment the charger comes out
    StartWhenAvailable = false  a run missed while the machine slept is skipped, not caught up

  Together, on a laptop that gets unplugged or closed at the end of a day, the hourly schedule simply stops
  and does not resume. Nothing errors. Last Result stays 0. The task still reads "Ready" and "Enabled" —
  which is why two days of looking at the sheet, the triggers and the Chat card found nothing: every one of
  those was working correctly and faithfully reporting that no sweep had happened.

  Set on the EXISTING settings object rather than a fresh New-ScheduledTaskSettingsSet, which would discard
  the 72-hour execution limit and everything else schtasks configured.

  Never fatal. A machine where this cannot be applied still has working tasks — worse ones, plugged in.
#>
function Set-VisitTaskSettings {
  param([string]$Name)
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries     = $false
    $task.Settings.StartWhenAvailable         = $true
    Set-ScheduledTask -TaskName $Name -Settings $task.Settings -ErrorAction Stop | Out-Null
  } catch {
    Write-Warning ("Could not set battery/catch-up options on '{0}': {1}" -f $Name, $_.Exception.Message)
    Write-Warning "  The task will still run, but only while plugged in, and a run missed while the"
    Write-Warning "  machine slept will be skipped rather than caught up."
  }
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

if (-not $SkipBuckets) {
  New-VisitTask -Name "Twin Visit Logger Bucket Sweep" -Runner "recheck-buckets.cmd" `
    -Every $BucketIntervalMinutes -What "re-check the 8 work-queue buckets in REI"

  <#
    Three extra sweeps, timed 15 minutes AHEAD of the 9am, 11am and 4pm Chat cards.

    The hourly sweep alone was not enough, and the client said why: "im asking why did the sysytem nofit
    the gc nit cheking of those?" — a card went out claiming nobody had recorded five outcomes their
    colleague had written up in REI that morning. The sweep and the card were on separate clocks with
    nothing between them, so whether the card was fresh was luck.

    These make it deliberate. Fixed daily times rather than an interval, because they exist to sit in
    front of a specific posting. The hourly sweep stays for the rest of the day, and a sweep with nothing
    due exits in seconds without opening a browser.
  #>
  <#
    The day's visit briefings, waiting in Chat before anybody starts.

    The client, after being shown the command that asks for one: "its already added in the gc i shuould be
    this autmatic at all i dont need to open or type." Right - a feature you have to know the name of is a
    feature most of the team will never use.

    07:30, half an hour before the 8am shift, so the visitor has the property, the numbers and the call in
    front of them before the day begins rather than while they are driving to it.

    It sends one briefing per lead per day, so this firing twice cannot double-post.
  #>
  <#
    The parked leads - Lost / Closed Out and Long-Term Nurture - on a slow clock.

    The client asked whether these should join the ordinary auto-check. Both extremes are wrong: adding ~214
    mostly-dead leads to the 20-minute rotation roughly doubles REI page loads (the thing that keeps logging
    this account out) and puts them in front of a booking a colleague is watching. Never reading them is also
    wrong - Long-Term Nurture is DEFINED as "check back later", and a closed lead somebody reopens in REI
    would say Lost on the board for ever.

    So: once a day, forty leads, oldest-checked first. Every parked lead comes round about weekly for roughly
    twenty minutes of browser time a day. It writes nothing and reports what looks alive again.

    13:00 - the middle of the day, after the 10:45 sweep and well before the 15:45 one, so it is not queued
    behind anything that matters. And it does not wait for the lock: it is the lowest-priority job here, so
    if REI is busy it stands down and tomorrow will do.
  #>
  $parkedAt = "13:00"
  $parkedName = "Twin Visit Logger Parked Leads"
  $parkedCmd = 'wscript.exe "' + $launcher + '" "sweep-parked.cmd"'
  & schtasks.exe /Create /SC DAILY /ST $parkedAt /TN $parkedName /TR $parkedCmd /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Creating scheduled task '$parkedName' failed with exit code $LASTEXITCODE." }
  Set-VisitTaskSettings -Name $parkedName
  Write-Host ("  {0,-38} daily at {1}   closed/nurture leads that look alive again" -f $parkedName, $parkedAt)

  $briefAt = "07:30"
  $briefName = "Twin Visit Logger Morning Briefings"
  $briefCmd = 'wscript.exe "' + $launcher + '" "morning-briefings.cmd"'
  & schtasks.exe /Create /SC DAILY /ST $briefAt /TN $briefName /TR $briefCmd /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Creating scheduled task '$briefName' failed with exit code $LASTEXITCODE." }
  Set-VisitTaskSettings -Name $briefName
  Write-Host ("  {0,-38} daily at {1}   today's visit briefings to Chat" -f $briefName, $briefAt)

  foreach ($at in @("08:45", "10:45", "15:45")) {
    $name = "Twin Visit Logger Sweep Before $($at -replace ':', '')"
    $cmd = 'wscript.exe "' + $launcher + '" "recheck-buckets.cmd"'
    & schtasks.exe /Create /SC DAILY /ST $at /TN $name /TR $cmd /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Creating scheduled task '$name' failed with exit code $LASTEXITCODE." }
    Set-VisitTaskSettings -Name $name
    Write-Host ("  {0,-38} daily at {1}   sweep before the Chat card" -f $name, $at)
  }
} else {
  Write-Host "  (bucket sweep skipped: -SkipBuckets)"
}

if (-not $SkipPending) {
  New-VisitTask -Name "Twin Visit Logger Board Intake" -Runner "fill-pending.cmd" `
    -Every $PendingIntervalMinutes -What "finish rows added on the board (REI lookup)"
} else {
  Write-Host "  (board intake skipped: -SkipPending)"
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
if (-not $SkipPending) { Write-Host "  logs\fill-pending.log       rows added on the board" }
Write-Host ""
Write-Host "Check them with:   Get-Content logs\scheduled-task.log -Tail 30"
Write-Host "See the tasks:     schtasks /Query /TN `"Twin Visit Logger Sandbox`""
Write-Host "Remove them:       powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1"
Write-Host ""
Write-Host "These only run while you are logged in to Windows. If the PC sleeps, nothing runs -"
Write-Host "the next run after it wakes picks up whatever accumulated."
