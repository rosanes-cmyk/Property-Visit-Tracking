# Build the one-file Windows installer, end to end.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
#
# Does both steps: packages the portable folder, then compiles it into TwinVisitLogger-Setup.exe. Two steps
# rather than one script that does everything, because the portable folder is useful on its own — it is what
# goes on a USB stick — and because the compile needs a tool that may not be installed.
#
# NEEDS: Inno Setup, once, free, from https://jrsoftware.org/isdl.php
#
# If it is not installed this stops with that link and leaves the portable folder in place, which is a
# perfectly good deliverable on its own: copy it and double-click SET-UP-THIS-PC.cmd inside. The installer only
# adds a Start-menu entry, a proper uninstaller, and the setup wizard launching by itself.
param(
  [string]$Work = "$env:USERPROFILE\Desktop\TwinVisitLogger-package",
  [string]$SpreadsheetId = "",
  [switch]$SkipPackage
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$folder = Join-Path $Work "TwinVisitLogger"

if (-not $SkipPackage) {
  Write-Host ""
  Write-Host "STEP 1 of 2 - packaging the portable folder"
  $args = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $root "scripts\make-portable.ps1"),
            "-Out", $Work, "-Force")
  if ($SpreadsheetId) { $args += @("-SpreadsheetId", $SpreadsheetId) }
  & powershell.exe @args
  if ($LASTEXITCODE -ne 0) { throw "Packaging failed. Nothing was compiled." }
} else {
  Write-Host "STEP 1 skipped (-SkipPackage)"
}

if (-not (Test-Path (Join-Path $folder "SET-UP-THIS-PC.cmd"))) {
  throw "No packaged folder at $folder. Run without -SkipPackage."
}

Write-Host ""
Write-Host "STEP 2 of 2 - compiling the installer"

# Inno Setup's compiler, in the places it actually installs to. Checked rather than assumed on PATH, because
# it is not added to PATH by default and "iscc is not recognised" sends people looking for the wrong problem.
$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) { $iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source }

if (-not $iscc) {
  Write-Host ""
  Write-Host "Inno Setup is not installed, so the .exe cannot be built here." -ForegroundColor Yellow
  Write-Host "  Get it once (free):  https://jrsoftware.org/isdl.php"
  Write-Host "  Then run this again."
  Write-Host ""
  Write-Host "The portable folder is ready and works on its own:"
  Write-Host "  $folder"
  Write-Host "  Copy it to any PC and double-click SET-UP-THIS-PC.cmd inside it."
  exit 2
}

$iss = Join-Path $root "installer\TwinVisitLogger.iss"
& $iscc $iss "/DSourceDir=$folder"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }

$out = Join-Path $root "installer\Output\TwinVisitLogger-Setup.exe"
Write-Host ""
if (Test-Path $out) {
  $mb = [math]::Round((Get-Item $out).Length / 1MB, 0)
  Write-Host "DONE: $out  ($mb MB)"
  Write-Host ""
  Write-Host "Copy that one file to any Windows PC and run it. It installs per-user (no administrator"
  Write-Host "prompt), puts Twin Visit Logger in the Start menu, and offers to set the PC up at the end."
} else {
  Write-Host "Inno Setup reported success but $out is missing. Check the log above."
}
Write-Host ""
