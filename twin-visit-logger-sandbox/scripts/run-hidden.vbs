' Launch one of the project's .cmd runners with no visible console window.
' Used by the Windows scheduled tasks so an automatic run never steals focus or flashes a window.
'
'   wscript run-hidden.vbs                     -> run-once.cmd        (REI -> sheet -> calendar)
'   wscript run-hidden.vbs whatsapp-watch.cmd  -> the WhatsApp watcher
Option Explicit
Dim fso, shell, scripts, target, runner
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scripts = fso.GetParentFolderName(WScript.ScriptFullName)

target = "run-once.cmd"
If WScript.Arguments.Count > 0 Then target = WScript.Arguments(0)
runner = scripts & "\" & target

If Not fso.FileExists(runner) Then
  ' Say which file is missing rather than failing silently on a schedule.
  WScript.Echo "Runner not found: " & runner
  WScript.Quit 1
End If

' 0 = hidden window, False = do not wait for it to finish.
shell.Run """" & runner & """", 0, False
