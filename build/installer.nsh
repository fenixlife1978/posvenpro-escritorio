; POSVEN Pro: habilitar acceso solo en perfil de red privada.
; El servidor LAN usa TCP 9002. No se abre el puerto en redes públicas.
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="POSVEN Pro LAN Server" dir=in action=allow protocol=TCP localport=9002 profile=private'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="POSVEN Pro LAN Server"'
  Pop $0
!macroend
