/** Noms des canaux IPC. Partages par le processus principal et le preload. */
export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsReset: 'settings:reset',

  preflightGet: 'preflight:get',
  preflightRefresh: 'preflight:refresh',
  urlsGet: 'urls:get',

  mediamtxStart: 'mediamtx:start',
  mediamtxStop: 'mediamtx:stop',
  mediamtxRestart: 'mediamtx:restart',
  mediamtxStatus: 'mediamtx:status',

  obsLaunch: 'obs:launch',
  toolsDetect: 'tools:detect',
  toolsBrowse: 'tools:browse',
  mediamtxDownload: 'mediamtx:download',
  mediamtxCheckUpdate: 'mediamtx:check-update',
  appCheckUpdate: 'app:check-update',

  // --- Verrouillage --------------------------------------------------------
  lockState: 'lock:state',
  lockSetPassword: 'lock:set-password',
  lockNow: 'lock:now',
  lockUnlock: 'lock:unlock',
  obsUseStreamControl: 'obs:use-stream-control',
  obsShowStream: 'obs:show-stream',
  obsStudioMode: 'obs:studio-mode',
  obsPreviewScene: 'obs:preview-scene',
  obsTransition: 'obs:transition',
  obsSetTransition: 'obs:set-transition',
  obsSetTransitionDuration: 'obs:set-transition-duration',
  obsCreateScene: 'obs:create-scene',
  obsConfigureScene: 'obs:configure-scene',
  obsSceneStreams: 'obs:scene-streams',

  obsConnect: 'obs:connect',
  obsDisconnect: 'obs:disconnect',
  obsSetScene: 'obs:set-scene',
  obsToggleStreaming: 'obs:toggle-streaming',
  obsToggleRecording: 'obs:toggle-recording',
  obsStatus: 'obs:status',

  // --- Adresses de diffusion -----------------------------------------------
  streamsList: 'streams:list',
  streamCreate: 'streams:create',
  streamUpdate: 'streams:update',
  streamDelete: 'streams:delete',
  streamStatus: 'streams:status',
  streamOpenWindow: 'streams:open-window',
  streamCloseWindow: 'streams:close-window',
  /** Active ou desactive l'enregistrement d'un flux, a chaud. */
  streamSetRecording: 'streams:set-recording',
  /** Dossier des enregistrements : etat, ouverture, choix. */
  recordingProbe: 'recording:probe',
  recordingOpen: 'recording:open',
  recordingPickDir: 'recording:pick-dir',

  // --- StreamControl Remote -----------------------------------------------
  /** Demandes d'appairage en attente, pour la pop-up du poste. */
  remotePending: 'remote:pending',
  /** Accepter ou refuser une demande d'appairage. */
  remoteApprove: 'remote:approve',
  /** Retirer un appareil autorise. */
  remoteForget: 'remote:forget',
  /** Definir ou retirer le mot de passe du panneau distant. */
  remoteSetPassword: 'remote:set-password',
  eventRemotePairRequest: 'remote:pair-request',
  /** Notification produite par une macro (action « notifier »). */
  eventMacroNotice: 'macro:notice',
  /** Son a jouer, produit par une macro (action « jouer un son »). */
  eventMacroPlaySound: 'macro:play-sound',

  // --- Automatisation : macros ---------------------------------------------
  macrosList: 'macros:list',
  macroCreate: 'macros:create',
  macroUpdate: 'macros:update',
  macroDelete: 'macros:delete',
  macroRun: 'macros:run',
  macroStop: 'macros:stop',
  macrosRunning: 'macros:running',
  /** Dupliquer une macro. */
  macroDuplicate: 'macros:duplicate',
  /** Journal d'execution des macros. */
  macroHistory: 'macros:history',
  macroHistoryClear: 'macros:history-clear',
  /** Import / export des macros (JSON). */
  macroExport: 'macros:export',
  macroImport: 'macros:import',
  /** Cree une macro a partir d'un modele pret a l'emploi. */
  macroFromTemplate: 'macros:from-template',
  /** Choix d'un fichier ou d'un dossier, pour les champs « fichier » des blocs. */
  macroPickPath: 'macros:pick-path',
  /** Lecture d'un fichier de son choisi, pour le jouer dans l'interface. */
  macroReadSound: 'macros:read-sound',

  // --- Conducteur de spectacle ---------------------------------------------
  showList: 'show:list',
  showAdd: 'show:add',
  showUpdate: 'show:update',
  showDelete: 'show:delete',
  showReset: 'show:reset',
  showNext: 'show:next',

  // --- Surveillance et analyse ---------------------------------------------
  watchAlerts: 'watch:alerts',
  watchAcknowledge: 'watch:acknowledge',
  watchReset: 'watch:reset',
  diagnosticsList: 'diagnostics:list',

  // --- Replay instantane ---------------------------------------------------
  replaySave: 'replay:save',
  replayAvailable: 'replay:available',
  replayOpenFolder: 'replay:open-folder',

  // --- Rangement des fichiers ---------------------------------------------
  storageList: 'storage:list',
  storagePickDir: 'storage:pick-dir',
  storageOpen: 'storage:open',
  pathsGet: 'paths:get',

  logsGet: 'logs:get',
  logsClear: 'logs:clear',

  clipboardWrite: 'shell:clipboard-write',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',

  // --- Pare-feu Windows ---------------------------------------------------
  firewallOpenPorts: 'firewall:open-ports',

  eventLogEntry: 'log:entry',
  eventServiceStatus: 'service:status',
  eventObsStatus: 'obs:status',
  eventSettingsChanged: 'settings:changed',
  eventPreflightUpdate: 'preflight:update',
  eventStreamsChanged: 'streams:changed',
  eventStreamStatus: 'stream:status',
  eventDeviceConnected: 'device:connected',
  eventDeviceDisconnected: 'device:disconnected',
} as const;
