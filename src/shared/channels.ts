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
