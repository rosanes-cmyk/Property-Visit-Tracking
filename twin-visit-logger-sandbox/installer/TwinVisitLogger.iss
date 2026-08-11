; Twin Visit Logger — Windows installer (Inno Setup)
;
; BUILD IT:
;   1. Build the portable folder first:
;        powershell -ExecutionPolicy Bypass -File .\scripts\make-portable.ps1 -Force
;   2. Install Inno Setup once (free): https://jrsoftware.org/isdl.php
;   3. Right-click this file -> "Compile"
;        or:  iscc installer\TwinVisitLogger.iss /DSourceDir="C:\path\to\TwinVisitLogger"
;
; Out comes  installer\Output\TwinVisitLogger-Setup.exe  — one file to copy to any PC.
;
; WHY AN INSTALLER AND NOT JUST THE FOLDER
;
; The client asked for an app: "can we make it into app? so it can just tranfer on evry pc" and "once i
; installed the application in one pc all must go on like automatic once intall the app". The folder alone
; already works — SET-UP-THIS-PC.cmd does the whole job — so this layer adds three specific things and nothing
; else: a Start-menu entry so nobody has to remember where the folder is, an uninstaller that removes the
; scheduled tasks properly, and the setup wizard launching by itself when the install finishes.
;
; WHERE IT INSTALLS, AND WHY NOT PROGRAM FILES
;
; %LOCALAPPDATA%, deliberately, and this is the one decision here worth understanding.
;
; Program Files needs administrator rights to WRITE, and this app writes constantly into its own folder: logs,
; the run lock, the heartbeat the dashboard reads, browser-data holding the REI session, and the whole folder
; being swapped by the updater. Under Program Files every one of those needs elevation — and the scheduled
; tasks do not run elevated, so they would fail silently, which is the exact failure this project has been
; bitten by twice. Installing per-user means no UAC prompt at install time, no elevation for the tasks, and an
; updater that can replace the folder. The trade is that it installs for THIS Windows user only, which is
; correct anyway: the automation needs this user's Google token and REI session.

#ifndef SourceDir
  #define SourceDir "..\..\TwinVisitLogger-package\TwinVisitLogger"
#endif

#define AppName "Twin Visit Logger"
#define AppVer "1.0.0"

[Setup]
AppId={{8E4C1F62-3B7A-4E59-9C1D-7A2F0B5D6E31}
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher=Twin Home Buyer
DefaultDirName={localappdata}\TwinVisitLogger
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; No admin rights needed or wanted — see the note above about Program Files.
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=TwinVisitLogger-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The package is around a gigabyte, so a 32-bit compressor would fail outright.
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Everything the portable builder produced. recursesubdirs for browsers\ and node_modules\, and
; createallsubdirs so empty folders the app expects (logs, data) exist rather than being made at first write.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; What a person actually wants to click, in the order they will want them.
Name: "{group}\Set up this PC"; Filename: "{app}\SET-UP-THIS-PC.cmd"; WorkingDir: "{app}"
Name: "{group}\Dashboard — is it working?"; Filename: "{app}\scripts\dashboard.cmd"; WorkingDir: "{app}"
Name: "{group}\Sign in to REI again"; Filename: "{app}\scripts\login-rei.cmd"; WorkingDir: "{app}"
Name: "{group}\Check for an update"; Filename: "{app}\scripts\update-app.cmd"; WorkingDir: "{app}"
Name: "{group}\Make this PC the active one"; Filename: "{app}\scripts\make-this-pc-active.cmd"; WorkingDir: "{app}"
Name: "{group}\Pause everything"; Filename: "{app}\scripts\pause.cmd"; WorkingDir: "{app}"
Name: "{group}\Resume"; Filename: "{app}\scripts\resume.cmd"; WorkingDir: "{app}"
Name: "{group}\Health check"; Filename: "{app}\scripts\status.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\Twin Visit Logger dashboard"; Filename: "{app}\scripts\dashboard.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Put the dashboard on my desktop"; GroupDescription: "Shortcuts:"

[Run]
; Setup runs at the end, unchecked-by-default nowhere: this IS the installation as far as the user is
; concerned, and an installer that finishes leaving the app unconfigured has not installed anything. It is
; shown as a checkbox rather than forced, so somebody installing onto a spare PC to leave on standby can
; decline and run it later.
Filename: "{app}\SET-UP-THIS-PC.cmd"; Description: "Set this PC up now (signs in to Google and REI)"; \
  Flags: postinstall shellexec skipifsilent

[UninstallRun]
; Hand the automation back BEFORE anything else, so another PC can take over without being forced to.
;
; Without this, uninstalling leaves the workbook still naming this machine as the active one — and the next PC
; would refuse to claim it, correctly, because from the sheet's point of view a live machine holds it. That is
; precisely the situation the client asked about ("what if my pc got damage"), so an uninstall that creates it
; would be a poor joke. Best effort only: it needs Google and a network, and an uninstall must not be blocked
; by either being unavailable. If it fails, the sheet menu still has "Release the PC".
Filename: "{app}\runtime\node.exe"; Parameters: "scripts\make-this-pc-active.mjs --release"; \
  WorkingDir: "{app}"; Flags: runhidden runascurrentuser skipifdoesntexist; RunOnceId: "ReleaseMachine"

; Then remove the scheduled tasks, BEFORE the files go — or Windows is left with eight tasks pointing at a
; folder that no longer exists, each firing on its timer and failing forever. runascurrentuser because the
; tasks were created as this user, and RunOnceId so it happens once even if uninstall is re-run.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-windows-task.ps1"""; \
  WorkingDir: "{app}"; Flags: runhidden runascurrentuser; RunOnceId: "RemoveTasks"

[UninstallDelete]
; Written after install, so Inno does not know about them and would otherwise leave the folder behind.
;
; NOTE what is NOT deleted: browser-data, credentials and .env are left alone on purpose. An uninstall that
; silently destroys the Google token and the REI session turns "reinstall to fix something" into "sign in to
; everything again", and this is a folder somebody may well remove and reinstall while debugging. Deleting
; them is a deliberate act — the folder is right there.
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\updates"
Type: filesandordirs; Name: "{app}\debug"

[Messages]
FinishedLabel=Twin Visit Logger is installed.%n%nIf you have not set this PC up yet, leave the box below ticked. You will be asked to sign in to Google once and to REI once — everything else is automatic.

[Code]
{ A single instance guard would be over-engineering here; what IS worth checking is that the source folder
  was actually built, because compiling against a missing folder produces a setup.exe containing nothing and
  the failure only shows up on the target machine. }
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
