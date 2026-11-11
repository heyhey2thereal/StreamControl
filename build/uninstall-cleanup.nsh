; Nettoyage a la desinstallation.
;
; Par defaut, electron-builder ne supprime que les fichiers programmes. Or
; StreamControl laisse derriere lui des donnees utiles au quotidien
; (parametres, journaux, enregistrements, tampon de replay) : sans proposition
; de nettoyage, elles restent indefiniment sur le poste.
;
; On demande donc a l'utilisateur, une seule fois, s'il veut tout supprimer.
; Par defaut (option /SD), la reponse est NON : un clic trop rapide ne doit pas
; effacer des enregistrements.
;
; Contraintes de forme, apprises a la dure :
; - ce fichier ne contient QUE de l'ASCII. Un accent ou un guillemet typographique
;   (encodage UTF-8) est mal lu par le makensis 3.0.4 embarque, qui prend alors
;   le texte du message pour une etiquette et refuse de compiler ;
; - l'option /SD vient APRES le texte du message (position imposee par NSIS).

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Supprimer aussi les donnees de StreamControl ? (parametres, journaux, enregistrements et tampon de replay). Choisissez Non pour les conserver." /SD IDNO IDNO streamcontrol_keep_data

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
