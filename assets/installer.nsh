; Remove the "Start with Windows" entry along with the app.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Petal"
!macroend
