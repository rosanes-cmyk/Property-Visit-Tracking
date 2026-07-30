' Launch run-once.cmd with no visible console window.
' Used by the Windows scheduled task so an automatic run never steals focus or flashes a window.
Option Explicit
Dim fso, shell, projectScripts, runner
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectScripts = fso.GetParentFolderName(WScript.ScriptFullName)
runner = projectScripts & "\run-once.cmd"
' 0 = hidden window, False = do not wait for it to finish.
shell.Run """" & runner & """", 0, False
