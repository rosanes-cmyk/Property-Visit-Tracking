<#
  Which folder do the scheduled tasks actually run the automation from -- and is this even the right PC?

  WHY THIS EXISTS. An update copied nine files, reported COPIED for every one, and installed none of them
  where they mattered: it had been run from a copy of the app sitting in Downloads. Every line said success.
  Nobody should have to know which of several identical-looking folders is the real one, and Windows already
  knows -- the scheduled task stores the full path it launches. This asks it.

  WHY IT IS A .ps1 AND NOT A ONE-LINER INSIDE THE .cmd. The first version was a single `powershell -Command`
  with twenty `^`-continued lines, and it had to escape pipes and quotes to survive cmd's parser. That is
  exactly the kind of code that half-works, and a diagnostic that reports the wrong state is worse than no
  diagnostic -- this project has the scar: whatsapp-doctor once said "looks logged in" on a logout page and
  sent somebody to fix selectors while the real answer was to stop.

  TWO CLAIMS IT MUST NEVER CONFUSE, and the first version did:

    "no task is installed"     something to fix
    "I could not check"        something else entirely

  Get-ScheduledTask can fail outright -- an old build, a policy, a missing module -- and with
  -ErrorAction SilentlyContinue that failure is indistinguishable from an empty result. So it falls back to
  schtasks.exe, which ships with every Windows, and only says "not installed" when a query actually ran and
  came back empty.
#>

$ErrorActionPreference = 'Continue'

function Line($text) { Write-Host $text }

Line ''
Line '  WHERE IS THE AUTOMATION ACTUALLY INSTALLED?'
Line '  ----------------------------------------------------------------------'
Line ''
Line ("  THIS PC     {0}   (Windows user: {1})" -f $env:COMPUTERNAME, $env:USERNAME)
Line ''

# ---------------------------------------------------------------------------------------------------
# Find the tasks. Two ways, because the first can fail in a way that looks like "none".
# ---------------------------------------------------------------------------------------------------
$actions = @()          # each entry: @{ Name = ...; Arguments = ... }
$queried = $false       # did a query genuinely run and return an answer?
$why = ''

try {
  $all = Get-ScheduledTask -ErrorAction Stop
  $queried = $true
  foreach ($t in $all) {
    if ($t.TaskName -notlike '*Twin Visit*') { continue }
    foreach ($a in $t.Actions) {
      $actions += @{ Name = $t.TaskName; Arguments = [string]$a.Arguments + ' ' + [string]$a.Execute }
    }
  }
} catch {
  $why = $_.Exception.Message
}

if (-not $queried) {
  Line '  (Get-ScheduledTask was not available here, so asking schtasks instead.)'
  if ($why) { Line ("   reason: {0}" -f $why) }
  Line ''
  $raw = & schtasks.exe /Query /FO CSV /V 2>$null
  if ($LASTEXITCODE -eq 0 -and $raw) {
    $queried = $true
    $rows = $raw | ConvertFrom-Csv
    foreach ($r in $rows) {
      if ([string]$r.TaskName -notlike '*Twin Visit*') { continue }
      $actions += @{ Name = [string]$r.TaskName; Arguments = [string]$r.'Task To Run' }
    }
  }
}

# ---------------------------------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------------------------------
if (-not $queried) {
  <#
    NEITHER WAY WORKED. This is the case the first version got wrong by printing "the tasks were never
    installed" -- a claim it had no basis for, which would send somebody to reinstall tasks that may be
    running perfectly.
  #>
  Line '  ** COULD NOT CHECK THE SCHEDULED TASKS ON THIS PC. **'
  Line ''
  Line '  This does NOT mean they are missing - it means Windows would not answer. Try again from an'
  Line '  Administrator Command Prompt:'
  Line ''
  Line '      Start menu -> type: cmd -> right-click Command Prompt -> Run as administrator'
  Line ''
} elseif ($actions.Count -eq 0) {
  Line '  No scheduled task with "Twin Visit" in its name exists on this PC.'
  Line ''
  Line '  Windows answered, so this is a real answer: the automation is not scheduled HERE.'
  Line ''
  Line '  The Chat cards name the machine the automation runs on. If that name is not the one shown'
  Line '  above, you are at the wrong PC and copying files here changes nothing.'
  Line ''
} else {
  foreach ($x in $actions) {
    $m = [regex]::Match([string]$x.Arguments, '(?<p>[A-Za-z]:\\[^"]*?run-hidden\.vbs)')
    if (-not $m.Success) {
      Line ("  TASK        {0}" -f $x.Name)
      Line ("              (could not read an app path out of: {0})" -f $x.Arguments)
      Line ''
      continue
    }
    $app = Split-Path (Split-Path $m.Groups['p'].Value)
    Line ("  TASK        {0}" -f $x.Name)
    Line ("  APP         {0}" -f $app)
    if (Test-Path (Join-Path $app '.env')) {
      Line '              .env is here - this is a configured install'
    } else {
      Line '              ** no .env here - this task points at an unconfigured folder **'
    }
    Line ("  RUN THIS    {0}" -f (Join-Path $app 'scripts\CopyUpdates.cmd'))
    Line ''
  }
}

# ---------------------------------------------------------------------------------------------------
# Always list the installs on disk, whatever the tasks said.
#
# Printed even when a task WAS found, because the two can disagree - a second copy of the app is exactly
# how nine files went into Downloads - and seeing both is what makes that visible.
# ---------------------------------------------------------------------------------------------------
Line '  Folders on this PC that are configured installs (.env + scripts\run-hidden.vbs):'
Line ''
$hits = Get-ChildItem -Path $env:USERPROFILE -Filter '.env' -Recurse -Force -ErrorAction SilentlyContinue -Depth 5 |
  Where-Object { Test-Path (Join-Path $_.DirectoryName 'scripts\run-hidden.vbs') } |
  Select-Object -First 10
if ($hits) {
  foreach ($h in $hits) {
    $d = $h.DirectoryName
    $note = ''
    <#
      A folder under Downloads is a REAL install if it has a .env - it is not disqualified, and saying so
      was the first version's second mistake. What is true is that Downloads is a bad place to keep it:
      browsers, disk-cleanup and "clear downloads" all delete from there, and it is where an unzipped copy
      lands, so it is easy to end up with two.
    #>
    if ($d -like '*\Downloads*') { $note = '   <- works, but Downloads is risky: cleanup tools delete from there' }
    Line ("    {0}{1}" -f $d, $note)
  }
} else {
  Line ("    (none found under {0})" -f $env:USERPROFILE)
}
Line ''
