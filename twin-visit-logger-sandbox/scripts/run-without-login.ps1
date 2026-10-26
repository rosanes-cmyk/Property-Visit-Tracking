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

<#
  STOP AT THE FIRST CREDENTIAL FAILURE. NEVER LOOP.

  This used to try the same password against every task in turn. One mistyped character therefore became
  TEN failed logon attempts against the Windows account in a couple of seconds -- and on the client's
  server that tripped the account lockout policy:

      FAILED  Twin Visit Logger Notes Audit: The referenced account is currently locked out
              and may not be logged on to.

  which is far worse than the problem the script exists to fix: with the account locked, nobody can sign
  in to that machine at all until the lockout expires. A wrong password is a user slip; turning it into a
  lockout was a bug in this loop.

  One password, one attempt. If Windows refuses it, nothing else is tried.
#>
$ok = 0; $failed = @(); $reasons = @(); $credBad = $false
foreach ($t in $targets) {
  if ($credBad) { break }
  try {
    # LogonType Password is what "run whether user is logged on or not" means underneath. Everything else
    # about the task -- its schedule, the 20-minute kill limit, the battery flags -- is left untouched.
    Set-ScheduledTask -TaskName $t.TaskName -User $me -Password $plain -ErrorAction Stop | Out-Null
    Write-Host ("  converted  {0}" -f $t.TaskName) -ForegroundColor Green
    $ok++
  } catch {
    $msg = $_.Exception.Message
    Write-Warning ("  FAILED     {0}: {1}" -f $t.TaskName, $msg)
    $failed += $t.TaskName
    $reasons += $msg
    if ($msg -match 'user name or password is incorrect|logon failure|password is incorrect|locked out') {
      $credBad = $true
      Write-Host ''
      Write-Host '  Stopping here rather than trying the other tasks with the same password:' -ForegroundColor Yellow
      Write-Host '  repeating it would count as another failed sign-in and can lock the Windows account.'
    }
  }
}
$plain = $null; [GC]::Collect()

Write-Host ''
Write-Host "Converted $ok task(s)." -ForegroundColor Green
if ($failed.Count) {
  <#
    NAME THE REAL CAUSE, not the usual one.

    This printed "the usual cause is that this PowerShell is not elevated" whatever Windows had actually
    said -- and the first time it fired, Windows had said "The user name or password is incorrect" on all
    ten lines. Sending somebody to re-open PowerShell as administrator when the real answer is "you typed
    one character too many" is the same class of fault this whole script exists to end: a confident
    message pointing at the wrong thing.
  #>
  $joined = ($reasons -join ' ')
  Write-Host ''
  if ($joined -match 'locked out') {
    Write-Warning 'The Windows account is locked out. Nothing was changed.'
    Write-Host ''
    Write-Host '  DO NOT SIGN OUT of this machine while it is locked -- you may not be able to sign back in.'
    Write-Host ''
    Write-Host '  It clears by itself. To see how long:   net accounts'
    Write-Host '  Look for "Lockout duration (minutes)" -- usually 10 to 30. Wait that long, then retry.'
    Write-Host ''
    Write-Host '  To clear it now, as an administrator:'
    Write-Host '    1. Start menu -> type: lusrmgr.msc -> Enter'
    Write-Host '    2. Users -> right-click the account -> Properties'
    Write-Host '    3. Untick "Account is locked out" -> OK'
    Write-Host ''
    Write-Host '  Check the password before running this again:  it is the one you use to sign in to Windows.'
  }
  elseif ($joined -match 'user name or password is incorrect|logon failure|password is incorrect') {
    Write-Warning 'The password was not accepted, so nothing was changed.'
    Write-Host ''
    Write-Host "  Windows checked it against the account $me and refused it."
    Write-Host '  Nothing shows on screen as you type, so an extra keystroke is easy to miss -- press'
    Write-Host '  Backspace a few times before you start, then type it slowly and run this again.'
    Write-Host ''
    Write-Host '  If the account has no password at all, Windows will not run a task signed out with it.'
    Write-Host '  Set one on the account first, or keep the jobs as they are.'
  }
  elseif ($joined -match 'Access is denied|not authorized|requires elevation') {
    Write-Warning 'Windows refused the change, so nothing was converted.'
    Write-Host ''
    Write-Host '  This PowerShell is not running as administrator.'
    Write-Host '  Start menu -> type: powershell -> right-click -> Run as administrator, then run again.'
  }
  else {
    Write-Warning 'Some tasks could not be converted. Windows gave the reason on each line above.'
    Write-Host '  The two usual ones are a mistyped password, and a PowerShell that is not elevated.'
  }
  <#
    A failed run must not print the celebratory next steps underneath its own warning. It did, and the
    screen read as though it had worked.
  #>
  if ($ok -eq 0) {
    Write-Host ''
    Write-Host 'Nothing was changed. The jobs are exactly as they were.' -ForegroundColor Yellow
    Write-Host ''
    return
  }
}

Write-Host ''
<#
  DO NOT TELL ANYONE TO SIGN OUT.

  This used to say "sign out of Windows completely (not just lock)" as the way to prove the change had
  worked. That advice was wrong twice over.

  It is UNNECESSARY: a task with LogonType Password already runs in a background session, whether or not
  anybody is signed in. The behaviour being tested is therefore happening on every fire from the moment
  it is converted, and signing out proves nothing a wait does not.

  It is also DANGEROUS on a real machine. The client's server runs an unrelated automation in the
  signed-in session; following this instruction would have killed it. A script cannot know what else
  lives on the PC it is changing, so it must not ask for something that stops everything on it.
#>
if ($All) {
  Write-Host 'WHAT TO DO NOW' -ForegroundColor Cyan
  Write-Host '  Nothing. These now run in a background session whether anybody is signed in or not,'
  Write-Host '  so a restart, a power cut or a sign-out no longer stops them.'
  Write-Host ''
  Write-Host '  DO NOT sign out to "test" it. That is not needed, and on a PC running anything else in'
  Write-Host '  the signed-in session it would stop that too. Lock the screen with Win+L instead.'
  Write-Host ''
  Write-Host '  To confirm, in an hour:   node scripts\health-check.mjs'
  Write-Host '  All clear means every job has run on its own. This is finished.'
  Write-Host ''
  Write-Host '  For real proof, restart the PC when it suits you and leave it at the sign-in screen.'
  Write-Host '  The jobs run there. Check the health check afterwards.'
} else {
  Write-Host 'WHAT TO DO NOW' -ForegroundColor Cyan
  Write-Host '  Wait 30 minutes - the re-check runs every 20 - then:'
  Write-Host '     node scripts\coverage-doctor.mjs'
  Write-Host '  If "read in the last hour" is no longer 0, the browser works with no desktop.'
  Write-Host ''
  Write-Host '  You do NOT need to sign out to test this. The converted task already runs in a'
  Write-Host '  background session, so it is being exercised on every fire from now on.'
  Write-Host ''
  Write-Host '  Then convert the rest:'
  Write-Host '     powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -All'
}
Write-Host ''
Write-Host 'If anything misbehaves, one command puts it all back:' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -Undo'
Write-Host ''
