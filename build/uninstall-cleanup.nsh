; Nettoyage a la desinstallation.
;
; Par defaut, electron-builder ne supprime que les fichiers programmes. Or
; StreamControl laisse derriere lui des donnees utiles au quotidien
; (parametres, journaux, enregistrements, tampon de replay) : sans proposition
; de nettoyage, elles restent indefiniment sur le poste.
;
; On demande donc a l'utilisateur, une seule fois, s'il veut tout supprimer.
; Par defaut (SD), la reponse est NON : un clic trop rapide ne doit pas effacer
; des enregistrements.
;
; Remarque : la ligne MessageBox tient sur UNE seule ligne. Une continuation de
; ligne (« \ ») casse sur un fichier converti en CRLF (Windows), et makensis
; prend alors le texte du message pour une etiquette.

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION /SD IDNO "Supprimer aussi les donnees de StreamControl ? (parametres, journaux, enregistrements et tampon de replay). Choisissez Non pour les conserver." IDNO streamcontrol_keep_data

  ; Donnees de l'application : %APPDATA%\StreamControl (parametres, journaux,
  ; enregistrements par defaut, tampon de replay).
  RMDir /r "$APPDATA\StreamControl"
  RMDir /r "$APPDATA\streamcontrol"

  ; Caches de mise a jour et donnees locales.
  RMDir /r "$LOCALAPPDATA\StreamControl"
  RMDir /r "$LOCALAPPDATA\streamcontrol"
  RMDir /r "$LOCALAPPDATA\streamcontrol-updater"

  streamcontrol_keep_data:
!macroend
