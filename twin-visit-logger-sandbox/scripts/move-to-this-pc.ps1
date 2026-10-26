<#
.SYNOPSIS
  Prepare THIS Windows PC to take over the automation, then hand off to the app's own setup.

.DESCRIPTION
  Everything the last two moves needed a person to remember, in one command. None of it is clever; all of
  it is a thing that went wrong once and cost a day.

  WHAT THIS DOES, AND WHY EACH ONE IS HERE

   1. Refuses to run from Downloads, OneDrive or a Temp folder. The app was once installed under
      Downloads, where Windows treats everything as internet-downloaded and a cleanup can delete the lot.
   2. Unblock-File over the whole folder. Files copied from a browser, a USB stick or a zip carry the
      Mark of the Web, and a .cmd carrying it shows "Open File - Security Warning" when it runs. Launched
      by a hidden scheduled task, that dialog appears where nobody can click it and the task hangs for
      ever at Running / 0x800710E0. That was a two-day outage, and the cause was invisible.
   3. Deletes credentials/token.json IF IT CAME ACROSS. This is a rule, not a preference: a Google token
      belongs to the machine that signed in. Copying it between PCs is how two machines end up holding the
      same session and one of them quietly invalidates the other. credentials.json is the opposite - it
      MUST come across, and this says so if it is missing.
   4. Stops the machine sleeping. A server that sleeps runs nothing and reports nothing.
   5. Turns on automatic sign-in after a restart. Three outages came from Windows rebooting for an update
      at 2am and landing on the sign-in screen with every job stopped and every task still reading Ready.
   6. npm install and the browser download, because a copied node_modules is not portable.

  WHAT IT DOES NOT DO, ON PURPOSE

  Google consent and the REI password both need a person. The Google one is the consent that makes the
  token yours. The REI one is a refusal the project has held from the start: storing that password would
  put it in a file that gets copied to every PC that ever runs this.

  AFTERWARDS it prints the two commands that finish the move, in order.

.PARAMETER SheetUrl
  The Property Visit Tracking spreadsheet address. Paste the whole URL from the browser; it is passed
  straight to setup-app.mjs, which takes a URL rather than asking anyone to find an ID inside one.

.PARAMETER SkipInstall
  Skip npm install and the browser download, for a folder that already has both.

.NOTES
  Run from an Administrator PowerShell, in the app folder:
     powershell -ExecutionPolicy Bypass -File .\scripts\move-to-this-pc.ps1
#>
param(
  [string]$SheetUrl = '',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host ''
Write-Host ('=' * 72)
Write-Host "  MOVING THE AUTOMATION TO $env:COMPUTERNAME"
Write-Host ('=' * 72)
Write-Host ''
Write-Host "App folder: $app"
Write-Host ''

# ---------------------------------------------------------------- 1. where it lives
<#
  Downloads is where the app was installed the first time, and Windows treats that folder as hostile:
  every file in it is flagged as internet-downloaded, and Storage Sense will delete things in it without
  asking. OneDrive is worse again -- it can make a file "online only", and a scheduled task cannot wait
  for a download at 2am.
#>
$bad = @('\Downloads', '\OneDrive', '\AppData\Local\Temp', '\Temp')
foreach ($b in $bad) {
  if ($app -like "*$b*") {
    throw @"
This folder is inside $b, which is not a safe home for the automation.

  Now: $app

Move the whole folder somewhere plain, for example C:\TwinVisitLogger, and run this again.
Windows flags everything under Downloads as internet-downloaded, and OneDrive can turn a file this
needs into a placeholder that a 2am scheduled task cannot wait for.
"@
  }
}
Write-Host '  OK  the folder is in a safe location'

# ---------------------------------------------------------------- 2. mark of the web
$blocked = 0
Get-ChildItem -Path $app -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  if (Get-Item -Path $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) {
    Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue
    $blocked++
  }
}
Write-Host ("  OK  unblocked {0} file(s) carrying the Mark of the Web" -f $blocked)

# ---------------------------------------------------------------- 3. credentials
$cred  = Join-Path $app 'credentials\credentials.json'
$token = Join-Path $app 'credentials\token.json'
if (-not (Test-Path $cred)) {
  Write-Warning 'credentials\credentials.json is MISSING.'
  Write-Host '      Copy it across from the old PC before the Google step below, or Google sign-in will fail.'
} else {
  Write-Host '  OK  credentials.json is present'
}
if (Test-Path $token) {
  <#
    Never copied between machines. A token belongs to the PC that signed in; two machines holding one
    session ends with one of them silently losing it, and that failure looks like "Google stopped working"
    rather than "somebody copied a file".
  #>
  Remove-Item -Path $token -Force
  Write-Host '  OK  removed a copied token.json - this PC signs in for itself in a moment'
}

# ---------------------------------------------------------------- 4. never sleep
try {
  powercfg /change standby-timeout-ac 0   | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0   | Out-Null
  Write-Host '  OK  this PC will not sleep on mains power'
} catch {
  Write-Warning ('  could not change the power settings: {0}' -f $_.Exception.Message)
}

# ---------------------------------------------------------------- 5. sign back in after a restart
<#
  0 means ENABLED. Windows signs the last user back in after a restart and locks the screen, so the
  scheduled jobs resume with nobody in the office. On Windows 11 the Settings toggle
  (Accounts -> Sign-in options) also has to be on; this clears the policy side, which is the half that
  can be switched off without anybody noticing.
#>
try {
  $k = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
  if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
  Set-ItemProperty -Path $k -Name 'DisableAutomaticRestartSignOn' -Value 0 -Type DWord
  Write-Host '  OK  Windows may sign back in automatically after a restart'
  Write-Host '      Also tick: Settings > Accounts > Sign-in options >'
  Write-Host '      "Use my sign-in info to automatically finish setting up after an update or restart"'
} catch {
  Write-Warning ('  could not set the restart sign-on policy: {0}' -f $_.Exception.Message)
  Write-Host '      This usually means PowerShell is not running as administrator.'
}

# ---------------------------------------------------------------- 6. node and the browser
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  throw @"
Node.js is not installed on this PC.

Install it from https://nodejs.org (the LTS version), then run this script again.
If PowerShell refuses to run scripts at all, first run, as administrator:
  Set-ExecutionPolicy RemoteSigned -Scope LocalMachine
"@
}
Write-Host ("  OK  Node {0}" -f (& node --version))

if (-not $SkipInstall) {
  Push-Location $app
  try {
    Write-Host ''
    Write-Host '  Installing packages (a few minutes)...'
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    Write-Host '  Downloading the browser...'
    & npm run install-browser
    if ($LASTEXITCODE -ne 0) { throw "npm run install-browser failed with exit code $LASTEXITCODE" }
    Write-Host '  OK  packages and browser installed'
  } finally { Pop-Location }
}

# ---------------------------------------------------------------- what is left for a person
Write-Host ''
Write-Host ('=' * 72)
Write-Host '  THIS PC IS PREPARED. TWO COMMANDS LEFT, IN THIS ORDER.'
Write-Host ('=' * 72)
Write-Host ''
Write-Host '  1. Claim the automation and schedule the jobs:'
Write-Host ''
if ($SheetUrl) {
  Write-Host ("       node scripts\setup-app.mjs --sheet `"{0}`" --take-over" -f $SheetUrl)
} else {
  Write-Host '       node scripts\setup-app.mjs --sheet "<paste the sheet URL>" --take-over'
}
Write-Host ''
Write-Host '     It opens a browser twice - once for Google (click Allow) and once for REI (type the'
Write-Host '     password). Neither can be automated, and the REI one is deliberate: storing that'
Write-Host '     password would put it in a file that gets copied to every PC that ever runs this.'
Write-Host ''
Write-Host '  2. Make the jobs survive a reboot, so nobody has to be signed in:'
Write-Host ''
Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -Test'
Write-Host '       ...then, once that works:'
Write-Host '       powershell -ExecutionPolicy Bypass -File .\scripts\run-without-login.ps1 -All'
Write-Host ''
Write-Host '  THEN, ON THE OLD PC - it must stop driving REI, or two machines fight over one login:'
Write-Host ''
Write-Host '       schtasks /Query /FO TABLE /TN "Twin Visit Logger*"'
Write-Host '       schtasks /Change /DISABLE /TN "Twin Visit Logger Sandbox"'
Write-Host '       ...and the same for every other Twin Visit Logger task it lists.'
Write-Host ''
Write-Host '  The take-over above already tells the workbook this PC is in charge, so the old one stands'
Write-Host '  down by itself even if a task is missed. Disabling them is belt and braces.'
Write-Host ''
Write-Host '  Finally, check it:   node scripts\health-check.mjs'
Write-Host ''
