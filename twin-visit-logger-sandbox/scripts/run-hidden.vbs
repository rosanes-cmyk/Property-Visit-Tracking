' Launch one of the project's .cmd runners with no visible console window.
' Used by the Windows scheduled tasks so an automatic run never steals focus or flashes a window.
'
'   wscript run-hidden.vbs                     -> run-once.cmd        (REI -> sheet -> calendar)
'   wscript run-hidden.vbs fill-pending.cmd    -> finish rows added on the board
'
' NOTHING IN HERE MAY EVER OPEN A DIALOG, and that rule is written the hard way.
'
' This script used to report a missing runner with WScript.Echo. Under cscript that prints a line; under
' WSCRIPT - which is what every scheduled task here uses - it opens a modal message box and waits for
' somebody to click OK. On a scheduled run there is nobody, and no visible desktop to click on. So the
' task sat at Status: Running for ever, the .cmd never launched, and not one line reached any log.
'
' On the client's PC that cost two days. "Board Intake" showed Running with Last Result 0x800710E0 - the
' operator refused the request - because Windows kept trying to start a second copy while the first was
' still holding a dialog nobody could see. Ending the task just produced a new one that hung the same way.
' Bookings piled up on the board, and every other job kept running, so the morning health check said
' "All clear" throughout.
'
' A scheduled script has no user. Everything it wants to say goes to a FILE.
Option Explicit
Dim fso, shell, scripts, target, runner, logFile, stream

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scripts = fso.GetParentFolderName(WScript.ScriptFullName)

target = "run-once.cmd"
If WScript.Arguments.Count > 0 Then target = WScript.Arguments(0)
runner = scripts & "\" & target

If Not fso.FileExists(runner) Then
  ' Say which file is missing, in the one place a scheduled run can be read afterwards. Never a dialog.
  logFile = fso.GetParentFolderName(scripts) & "\logs\launcher.log"
  On Error Resume Next
  If Not fso.FolderExists(fso.GetParentFolderName(logFile)) Then
    fso.CreateFolder fso.GetParentFolderName(logFile)
  End If
  Set stream = fso.OpenTextFile(logFile, 8, True)   ' 8 = append, True = create if absent
  stream.WriteLine Now & "  run-hidden.vbs: runner not found: " & runner
  stream.WriteLine "  The scheduled task points at a file that is not there. Check the task's argument" 
  stream.WriteLine "  and that the app folder still holds scripts\" & target
  stream.Close
  On Error Goto 0
  WScript.Quit 1
End If

' 0 = hidden window, False = do not wait for it to finish.
shell.Run """" & runner & """", 0, False
