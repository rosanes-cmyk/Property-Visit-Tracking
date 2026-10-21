<#
.SYNOPSIS
  Make the scheduled jobs run whether anybody is signed in to Windows or not.

.DESCRIPTION
  THE FAULT THIS ENDS.

  Every outage this system has had -- three in one week, then another, then another -- has had the same
  cause, and it was never the code. `schtasks /Create` with no credentials registers a task as "Run only
  when the user is logged on". Windows then restarts itself at 2am for an update, lands on the sign-in
  screen, and every job stops. Not failed. Not errored. Task Scheduler still reports Ready and Last Result
  0, because a task that never fired cannot fail.

  Measured on the client's own server, 14 October:

      BOOTED:  Wednesday, October 14, 2026  2:15:52 AM
      REI Recheck    last ran 1:57 AM   (before the reboot)
      Bucket Sweep   last ran 1:17 AM   (before the reboot)
      Morning Briefings / Parked Leads / the three pre-card sweeps -- all MISSED that day
      Booking intake last ran 2:55 PM   (the moment a person signed in)

  Thirteen hours of nothing, with every task reading Ready.

  The Windows "sign me back in after a restart" setting helps, but only for update reboots, and it is one
  checkbox away from being off again. This removes the dependency instead of mitigating it.

.PARAMETER Test
  Convert ONE task -- the 20-minute REI re-check -- and leave the other ten alone. Run this first, lock
  the screen or sign out, and check in half an hour that it still ran. Nothing else is at risk meanwhile.

.PARAMETER All
  Convert every Twin Visit Logger task. Only do this once -Test has proved it works on this machine.

.PARAMETER Undo
  Put every task back to "run only when logged on", exactly as the installer created them.

.NOTES
  WHY THIS NEEDS YOUR PASSWORD. Windows will only run a task with nobody signed in if it can log the
  account on itself, and for that it needs the credential. It is stored by Windows in its own Credential
  Manager, encrypted, and is never written to this script, the repository, a log, or anywhere this project
  can read it.

  THE RISK, STATED PLAINLY. With nobody signed in there is no desktop. REI is read through a Chromium
  browser, and this only works because that browser already runs hidden (REI_HEADLESS=true). If headless
  Chromium cannot start in that mode on this machine, the jobs will fail -- loudly, in the logs, and the
  health check will say so within the hour. That is why -Test converts one job and not eleven.

  Run from an Administrator PowerShell:
     powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -Test
#>
[CmdletBinding(DefaultParameterSetName = 'Test')]
param(
  [Parameter(ParameterSetName = 'Test')][switch]$Test,
  [Parameter(ParameterSetName = 'All')][switch]$All,
  [Parameter(ParameterSetName = 'Undo')][switch]$Undo
)

$ErrorActionPreference = 'Stop'
$PREFIX   = 'Twin Visit Logger'
$TESTTASK = 'Twin Visit Logger REI Recheck'   # 20 minutes: proves itself fastest

function Get-OurTasks {
  Get-ScheduledTask | Where-Object { $_.TaskName -like "$PREFIX*" }
}

$tasks = Get-OurTasks
if (-not $tasks) {
  throw "No '$PREFIX' tasks found on this machine. Run scripts\install-windows-task.ps1 first."
}

Write-Host ''
Write-Host "Found $($tasks.Count) Twin Visit Logger task(s) on $env:COMPUTERNAME." -ForegroundColor Cyan

# How each task is currently registered. InteractiveToken is the fault; Password is the fix.
Write-Host ''
Write-Host 'Current state:'
foreach ($t in $tasks) {
  $lt = $t.Principal.LogonType
  $mark = if ($lt -eq 'Password' -or $lt -eq 'S4U') { 'runs signed out ' } else { 'NEEDS A LOGIN  ' }
  Write-Host ("  {0,-40} {1} ({2})" -f $t.TaskName, $mark, $lt)
}

if ($Undo) {
  Write-Host ''
  Write-Host 'Putting every task back to "run only when logged on"...' -ForegroundColor Yellow
  $me = "$env:USERDOMAIN\$env:USERNAME"
  foreach ($t in $tasks) {
    try {
      Set-ScheduledTask -TaskName $t.TaskName -User $me -ErrorAction Stop | Out-Null
      Write-Host ("  reverted  {0}" -f $t.TaskName)
    } catch {
      Write-Warning ("  could not revert {0}: {1}" -f $t.TaskName, $_.Exception.Message)
    }
  }
  Write-Host ''
  Write-Host 'Done. The jobs again run only while somebody is signed in.' -ForegroundColor Yellow
  Write-Host 'Sign in and lock the screen (Win+L) -- do not sign out.'
  return
}

$targets = if ($All) { $tasks } else { $tasks | Where-Object { $_.TaskName -eq $TESTTASK } }
if (-not $targets) {
  throw "Task '$TESTTASK' was not found. Use -All, or check the name with: schtasks /Query /TN `"$TESTTASK`""
}

Write-Host ''
if ($All) {
  Write-Host "About to convert ALL $($targets.Count) tasks so they run with nobody signed in." -ForegroundColor Cyan
} else {
  Write-Host "About to convert ONE task -- $TESTTASK -- as a test." -ForegroundColor Cyan
  Write-Host 'The other jobs are left exactly as they are, so nothing else can break.'
}

$me = "$env:USERDOMAIN\$env:USERNAME"
Write-Host ''
Write-Host "Windows needs the password for $me so it can sign the account in by itself."
Write-Host 'It is stored by Windows, encrypted. It is never written to this script, a log or the repository.'
Write-Host ''
$secure = Read-Host -Prompt "Password for $me" -AsSecureString
$plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $plain) { throw 'No password entered - nothing was changed.' }

$ok = 0; $failed = @()
foreach ($t in $targets) {
  try {
    # LogonType Password is what "run whether user is logged on or not" means underneath. Everything else
    # about the task -- its schedule, the 20-minute kill limit, the battery flags -- is left untouched.
    Set-ScheduledTask -TaskName $t.TaskName -User $me -Password $plain -ErrorAction Stop | Out-Null
    Write-Host ("  converted  {0}" -f $t.TaskName) -ForegroundColor Green
    $ok++
  } catch {
    Write-Warning ("  FAILED     {0}: {1}" -f $t.TaskName, $_.Exception.Message)
    $failed += $t.TaskName
  }
}
$plain = $null; [GC]::Collect()

Write-Host ''
Write-Host "Converted $ok task(s)." -ForegroundColor Green
if ($failed.Count) {
  Write-Host ''
  Write-Warning 'Some tasks could not be converted. The usual cause is that this PowerShell is not elevated.'
  Write-Host '  Start menu -> type: powershell -> right-click -> Run as administrator, then run this again.'
}

Write-Host ''
if ($All) {
  Write-Host 'WHAT TO DO NOW' -ForegroundColor Cyan
  Write-Host '  1. Sign out of Windows completely (not just lock).'
  Write-Host '  2. Leave it an hour.'
  Write-Host '  3. Sign back in and run:  node scripts\health-check.mjs'
  Write-Host '     All clear means the jobs ran with nobody signed in. This is finished.'
} else {
  Write-Host 'WHAT TO DO NOW' -ForegroundColor Cyan
  Write-Host '  1. Sign out of Windows completely (not just lock).'
  Write-Host '  2. Leave it 30 minutes - the re-check runs every 20.'
  Write-Host '  3. Sign back in and run:  node scripts\coverage-doctor.mjs'
  Write-Host '     If "read in the last hour" is no longer 0, it worked with nobody signed in.'
  Write-Host ''
  Write-Host '  Then convert the rest:'
  Write-Host '     powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -All'
}
Write-Host ''
Write-Host 'If anything misbehaves, one command puts it all back:' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -Undo'
Write-Host ''
