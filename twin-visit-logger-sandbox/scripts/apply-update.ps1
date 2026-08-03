# Extract an update zip into THIS project and prove it landed.
#
#   powershell -ExecutionPolicy Bypass -File scripts\apply-update.ps1 -Zip "$HOME\Downloads\tvlnote4.zip"
#
# NOTE: this script ships INSIDE the update zips, so it cannot install the zip that first delivers it.
# The first time, do it by hand — three lines, no wrapper folder, Expand-Archive does not nest:
#   Expand-Archive "$HOME\Downloads\<zip>" "$env:TEMP\tvl" -Force
#   Copy-Item "$env:TEMP\tvl\*" . -Recurse -Force
#   Select-String src\whatsapp\watch.mjs -Pattern "^const BUILD"
# After that this script is present and handles every later update.
#
# Why this exists: four wrong diagnoses in this project traced back to a zip extracted somewhere other
# than the folder Node loads from — Windows nests it in a subfolder named after the zip, or the files
# go to Downloads and the old code keeps running while the new behaviour is looked for. This puts the
# files in the right place and then READS BACK the build stamp, so there is no doubt either way.

param(
  [Parameter(Mandatory = $true)][string]$Zip
)

$ErrorActionPreference = 'Stop'

# The project root is the parent of this script's folder, whatever the current directory happens to be.
$root = Split-Path -Parent $PSScriptRoot
Write-Host "Project:  $root"
Write-Host "Update:   $Zip`n"

if (-not (Test-Path $Zip)) { throw "That zip does not exist: $Zip" }
if (-not (Test-Path (Join-Path $root 'package.json'))) { throw "This does not look like the project: no package.json in $root" }

$staging = Join-Path $env:TEMP ("tvl-update-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
Expand-Archive -Path $Zip -DestinationPath $staging -Force

# Windows sometimes wraps everything in one folder named after the zip. Step into it if so, otherwise
# every file lands one directory too deep and nothing changes.
$top = Get-ChildItem $staging
$source = if ($top.Count -eq 1 -and $top[0].PSIsContainer -and -not (Test-Path (Join-Path $staging 'src'))) {
  $top[0].FullName
} else { $staging }

Write-Host "Copying from $source"
Copy-Item -Path (Join-Path $source '*') -Destination $root -Recurse -Force
Remove-Item $staging -Recurse -Force

# Read the build stamp out of the file that will actually run. This is the proof.
$watch = Join-Path $root 'src\whatsapp\watch.mjs'
$build = (Select-String -Path $watch -Pattern "^const BUILD = '(.+)';" ).Matches.Groups[1].Value
Write-Host "`nInstalled build: $build"

foreach ($f in @('src\whatsapp\post-gate.mjs', 'src\whatsapp\note.mjs', 'src\whatsapp\client.mjs')) {
  $present = Test-Path (Join-Path $root $f)
  Write-Host ("{0}  {1}" -f $(if ($present) { 'OK      ' } else { 'MISSING ' }), $f)
}

Write-Host "`nNow run:"
Write-Host '  node src\whatsapp\watch.mjs --yes --only "Test"'
Write-Host "The first line it prints is the build. If it does not say $build, the update did not land."
