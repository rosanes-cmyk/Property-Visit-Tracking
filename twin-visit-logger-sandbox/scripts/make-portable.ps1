# Build the portable app folder: everything needed to run, on a PC with nothing installed.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\make-portable.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\make-portable.ps1 -Out D:\build -Zip
#
# WHY THIS RUNS ON WINDOWS AND NOT IN THE REPO
#
# The client asked for an installable app: "can we make it into app? so it can just tranfer on evry pc".
# The pieces that make the folder self-contained — node.exe and Playwright's Chromium — are Windows binaries
# that exist on THIS machine and nowhere in source control. They are hundreds of megabytes and platform
# specific, so they cannot be committed. This script packages the working install rather than downloading
# anything, which also means the produced folder is a copy of something already proven to work.
#
# WHAT COMES OUT
#
#   TwinVisitLogger\
#     SET-UP-THIS-PC.cmd        <- the only thing anyone runs
#     runtime\node.exe          <- so no Node install is needed
#     browsers\chromium-*\      <- so no browser download is needed
#     src\ scripts\ config\ node_modules\
#     config\workbook.json      <- the spreadsheet ID, which is not a secret
#
# WHAT IS DELIBERATELY LEFT OUT, and this is the part worth reading:
#
#   .env                  the Chat webhook is a credential
#   credentials\          the Google client secret and the signed-in token
#   browser-data\         the live REI session - a copy of this IS being logged in as you
#   logs\ debug\ data\    seller names, addresses, screenshots of REI pages
#
# Any of those inside the package would make the package itself a credential: a copy on a USB stick, in a
# Drive folder or attached to an email would hand over the account. The setup wizard collects them on the
# new PC instead, which costs two sign-ins and removes the whole category of problem.
param(
  [string]$Out = "$env:USERPROFILE\Desktop\TwinVisitLogger-package",
  [string]$SpreadsheetId = "",
  [switch]$Zip,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$name = "TwinVisitLogger"
$dest = Join-Path $Out $name

Write-Host ""
Write-Host "Building the portable app"
Write-Host "  from: $root"
Write-Host "  to:   $dest"
Write-Host ""

if (Test-Path $dest) {
  if (-not $Force) { throw "$dest already exists. Delete it, or re-run with -Force." }
  Remove-Item -Recurse -Force $dest
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# ---------------------------------------------------------------- the code itself
#
# An allow-list, not a deny-list. A deny-list is one forgotten folder away from shipping the REI session or
# the Google token, and the failure is silent - the package works perfectly and is a credential. Naming what
# goes IN means a new folder of seller data added next year is excluded by default rather than by memory.
$include = @("src", "scripts", "config", "node_modules", "package.json", "package-lock.json",
             "SET-UP-THIS-PC.cmd", "README.md")
foreach ($item in $include) {
  $from = Join-Path $root $item
  if (-not (Test-Path $from)) { Write-Host "  (skipped, not present: $item)"; continue }
  Copy-Item -Recurse -Force $from (Join-Path $dest $item)
  Write-Host "  + $item"
}

# The secrets must not have arrived by another route - a stray copy inside config\ or scripts\, for example.
# Checked rather than assumed, because "I am fairly sure it is not in there" is not good enough for a folder
# that gets emailed around.
$forbidden = @(".env", "token.json", "credentials.json")
$leaks = Get-ChildItem -Path $dest -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $forbidden -contains $_.Name -or $_.FullName -match "\\browser-data\\" }
if ($leaks) {
  Write-Host ""
  Write-Host "REFUSING TO CONTINUE - these must never be packaged:" -ForegroundColor Red
  $leaks | ForEach-Object { Write-Host ("    " + $_.FullName.Substring($dest.Length + 1)) }
  Remove-Item -Recurse -Force $dest
  throw "Secrets found inside the package. Nothing was written."
}

# ------------------------------------------------------------------------- node.exe
#
# node.exe alone, not the whole Node installation. npm is not needed: node_modules is packaged, so nothing is
# ever installed on the target machine - which is also what makes the package work with no internet.
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { throw "Node is not on PATH here, so there is nothing to package. Install Node and re-run." }
New-Item -ItemType Directory -Force -Path (Join-Path $dest "runtime") | Out-Null
Copy-Item -Force $nodeExe (Join-Path $dest "runtime\node.exe")
$nodeVer = & node --version
Write-Host "  + runtime\node.exe  ($nodeVer)"

# ------------------------------------------------------------------------ Chromium
#
# Playwright keeps browsers in %LOCALAPPDATA%\ms-playwright. Copying it in and pointing
# PLAYWRIGHT_BROWSERS_PATH at the copy is what stops the target PC downloading 150 MB on first run - which it
# would otherwise attempt, on a machine that may have no internet and certainly has nobody watching.
$pwHome = if ($env:PLAYWRIGHT_BROWSERS_PATH) { $env:PLAYWRIGHT_BROWSERS_PATH }
          else { Join-Path $env:LOCALAPPDATA "ms-playwright" }
if (-not (Test-Path $pwHome)) {
  throw "No Playwright browsers found at $pwHome. Run 'npm run install-browser' here first."
}
# Chromium only. The folder also holds firefox and webkit if anyone has ever installed them, and this project
# drives Chromium exclusively - shipping the other two would triple the package for nothing.
$chromiumDirs = Get-ChildItem $pwHome -Directory | Where-Object { $_.Name -like "chromium*" }
if (-not $chromiumDirs) { throw "No chromium build under $pwHome. Run 'npm run install-browser'." }
New-Item -ItemType Directory -Force -Path (Join-Path $dest "browsers") | Out-Null
foreach ($d in $chromiumDirs) {
  Copy-Item -Recurse -Force $d.FullName (Join-Path $dest "browsers\$($d.Name)")
  Write-Host "  + browsers\$($d.Name)"
}

# ------------------------------------------------------- which workbook, baked in
#
# The ONE value the package carries, and it is not a secret: a spreadsheet ID is in the URL of the sheet and
# grants nothing without permission to open it. Everything else - the tracker tab, the calendar, the Chat
# webhook - is read from the workbook after the Google sign-in, so the package holds no credential at all.
if (-not $SpreadsheetId) {
  $envFile = Join-Path $root ".env"
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*SPREADSHEET_ID\s*=\s*(.+)$' | Select-Object -First 1
    if ($line) { $SpreadsheetId = $line.Matches[0].Groups[1].Value.Trim() }
  }
}
New-Item -ItemType Directory -Force -Path (Join-Path $dest "config") | Out-Null
if ($SpreadsheetId) {
  @{ spreadsheetId = $SpreadsheetId } | ConvertTo-Json |
    Set-Content -Encoding UTF8 (Join-Path $dest "config\workbook.json")
  Write-Host "  + config\workbook.json  ($SpreadsheetId)"
} else {
  Write-Host "  (no spreadsheet ID found - setup will ask for the sheet link on the new PC)"
}

# ------------------------------------------------------------------ the read-me
$readme = @"
TWIN VISIT LOGGER
=================

TO SET UP THIS PC:  double-click  SET-UP-THIS-PC.cmd

That is the whole installation. It reads its settings from your workbook, signs you in to Google
and to REI, claims this PC as the active one, schedules the eight jobs, and checks that it works.

You will be asked to sign in TWICE - once to Google, once to REI. Everything else is automatic.

AFTERWARDS
----------
  scripts\dashboard.cmd            watch what it is doing, live
  scripts\status.cmd               a one-screen health check
  scripts\login-rei.cmd            sign in to REI again (it logs you out from time to time)
  scripts\make-this-pc-active.cmd  move the automation to this PC
  scripts\pause.cmd                stop everything running on its own
  scripts\resume.cmd               start it again

ONLY ONE PC AT A TIME
---------------------
Install this on as many machines as you like, but only one may RUN it: two PCs driving REI on the
same account is what logs REI out. The workbook records which machine is the active one; the others
stand down by themselves and say so. To move it, run make-this-pc-active.cmd on the new PC. If the
old PC is broken, release it from the sheet: menu "Twin Visit Logger" -> "Release the PC".

WHAT IS NOT IN THIS FOLDER
--------------------------
No passwords, no Google token, no REI session, no seller data. That is deliberate - it means a copy
of this folder on a USB stick or in an email is not a way into your accounts. The two sign-ins during
setup are what replace them.

Node $nodeVer and Chromium are included, so nothing is downloaded and nothing needs installing.
"@
Set-Content -Encoding UTF8 (Join-Path $dest "READ-ME-FIRST.txt") $readme
Write-Host "  + READ-ME-FIRST.txt"

# ------------------------------------------------------------------------- report
$size = [math]::Round(((Get-ChildItem $dest -Recurse -Force -File |
  Measure-Object -Property Length -Sum).Sum / 1GB), 2)
Write-Host ""
Write-Host "Built: $dest"
Write-Host "Size:  $size GB"

if ($Zip) {
  $zipPath = Join-Path $Out "$name.zip"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Write-Host ""
  Write-Host "Zipping (this takes a few minutes)..."
  Compress-Archive -Path $dest -DestinationPath $zipPath
  Write-Host "Zipped: $zipPath"
  # Mark of the Web: a folder extracted from a downloaded zip is BLOCKED, and a blocked script run by Task
  # Scheduler fails silently - the task reports success and does nothing. SET-UP-THIS-PC.cmd clears it as its
  # first act, which is why setup must always be the first thing run on a new machine.
  Write-Host ""
  Write-Host "On the new PC: extract the zip, then double-click SET-UP-THIS-PC.cmd inside it."
  Write-Host "It unblocks the extracted files itself - do not run anything else first."
}
Write-Host ""
