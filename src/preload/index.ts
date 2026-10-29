import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';
import type {
  AppPaths,
  AppSettings,
  AppUpdateInfo,
  DetectionKind,
  DetectedTool,
  FirewallResult,
  GatherResult,
  LockState,
  LogEntry,
  Macro,
  MacroRunEntry,
  ObsStatus,
  PreflightReport,
  ServiceActionResult,
  ServiceStatus,
  StreamControlApi,
  StreamControlEvents,
  StorageEntry,
  StreamEndpointView,
  StreamMutationResult,
  StreamStatus,
  StreamDiagnostics,
  StreamUrls,
  UpdateResult,
  WatchAlert,
  ShowStep,
  Unsubscribe,
} from '../shared/types';

/** La version de l'application est transmise via additionalArguments. */
function readVersionFromArgs(): string {
  const prefix = '--streamcontrol-version=';
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : '0.0.0';
}

const EVENT_CHANNELS = new Set<string>([
  CHANNELS.eventLogEntry,
  CHANNELS.eventServiceStatus,
  CHANNELS.eventObsStatus,
  CHANNELS.eventSettingsChanged,
  CHANNELS.eventPreflightUpdate,
  CHANNELS.eventStreamsChanged,
  CHANNELS.eventStreamStatus,
  CHANNELS.eventDeviceConnected,
  CHANNELS.eventDeviceDisconnected,
  CHANNELS.eventRemotePairRequest,
  CHANNELS.eventMacroNotice,
  CHANNELS.eventMacroPlaySound,
]);

const api: StreamControlApi = {
  getSettings: () => ipcRenderer.invoke(CHANNELS.settingsGet) as Promise<AppSettings>,
  saveSettings: (patch) => ipcRenderer.invoke(CHANNELS.settingsSave, patch) as Promise<AppSettings>,
  resetSettings: () => ipcRenderer.invoke(CHANNELS.settingsReset) as Promise<AppSettings>,

  getPreflight: () => ipcRenderer.invoke(CHANNELS.preflightGet) as Promise<PreflightReport>,
  refreshPreflight: (verbose = false) =>
    ipcRenderer.invoke(CHANNELS.preflightRefresh, verbose) as Promise<PreflightReport>,
  getUrls: () => ipcRenderer.invoke(CHANNELS.urlsGet) as Promise<StreamUrls>,

  startMediamtx: () => ipcRenderer.invoke(CHANNELS.mediamtxStart) as Promise<ServiceActionResult>,
  stopMediamtx: () => ipcRenderer.invoke(CHANNELS.mediamtxStop) as Promise<ServiceActionResult>,
  restartMediamtx: () => ipcRenderer.invoke(CHANNELS.mediamtxRestart) as Promise<ServiceActionResult>,
  getMediamtxStatus: () => ipcRenderer.invoke(CHANNELS.mediamtxStatus) as Promise<ServiceStatus>,

  launchObs: () => ipcRenderer.invoke(CHANNELS.obsLaunch) as Promise<ServiceActionResult>,
  detectTools: () => ipcRenderer.invoke(CHANNELS.toolsDetect) as Promise<DetectedTool[]>,
  browseForExecutable: (kind: DetectionKind) =>
    ipcRenderer.invoke(CHANNELS.toolsBrowse, kind) as Promise<string | null>,
  downloadMediamtx: () => ipcRenderer.invoke(CHANNELS.mediamtxDownload) as Promise<UpdateResult>,
  checkMediamtxUpdate: () =>
    ipcRenderer.invoke(CHANNELS.mediamtxCheckUpdate) as Promise<{ version: string } | { error: string }>,

  checkAppUpdate: (force = false) =>
    ipcRenderer.invoke(CHANNELS.appCheckUpdate, force) as Promise<AppUpdateInfo | null>,

  obsUseStreamControl: () =>
    ipcRenderer.invoke(CHANNELS.obsUseStreamControl) as Promise<{ ok: boolean; message: string }>,
  obsShowStream: (id) =>
    ipcRenderer.invoke(CHANNELS.obsShowStream, id) as Promise<{ ok: boolean; message: string }>,
  obsSetStudioMode: (enabled) => ipcRenderer.invoke(CHANNELS.obsStudioMode, enabled) as Promise<ObsStatus>,
  obsSetPreviewScene: (name) => ipcRenderer.invoke(CHANNELS.obsPreviewScene, name) as Promise<ObsStatus>,
  obsTransition: () => ipcRenderer.invoke(CHANNELS.obsTransition) as Promise<ObsStatus>,
  obsSetTransition: (name) => ipcRenderer.invoke(CHANNELS.obsSetTransition, name) as Promise<ObsStatus>,
  obsSetTransitionDuration: (ms) =>
    ipcRenderer.invoke(CHANNELS.obsSetTransitionDuration, ms) as Promise<ObsStatus>,
  obsCreateScene: (name) =>
    ipcRenderer.invoke(CHANNELS.obsCreateScene, name) as Promise<{ ok: boolean; message: string }>,
  obsConfigureScene: (sceneName, ids) =>
    ipcRenderer.invoke(CHANNELS.obsConfigureScene, sceneName, ids) as Promise<{
      ok: boolean;
      message: string;
    }>,
  obsSceneStreams: (sceneName) =>
    ipcRenderer.invoke(CHANNELS.obsSceneStreams, sceneName) as Promise<string[]>,

  lockState: () => ipcRenderer.invoke(CHANNELS.lockState) as Promise<LockState>,
  lockSetPassword: (password, hint) =>
    ipcRenderer.invoke(CHANNELS.lockSetPassword, password, hint) as Promise<LockState>,
  lockNow: () => ipcRenderer.invoke(CHANNELS.lockNow) as Promise<LockState>,
  unlock: (password) =>
    ipcRenderer.invoke(CHANNELS.lockUnlock, password) as Promise<{
      ok: boolean;
      state: LockState;
      message?: string;
    }>,

  obsConnect: () => ipcRenderer.invoke(CHANNELS.obsConnect) as Promise<ObsStatus>,
  obsDisconnect: () => ipcRenderer.invoke(CHANNELS.obsDisconnect) as Promise<ObsStatus>,
  obsSetScene: (name: string) => ipcRenderer.invoke(CHANNELS.obsSetScene, name) as Promise<ObsStatus>,
  obsToggleStreaming: () => ipcRenderer.invoke(CHANNELS.obsToggleStreaming) as Promise<ObsStatus>,
  obsToggleRecording: () => ipcRenderer.invoke(CHANNELS.obsToggleRecording) as Promise<ObsStatus>,
  obsGetStatus: () => ipcRenderer.invoke(CHANNELS.obsStatus) as Promise<ObsStatus>,

  streamsList: () => ipcRenderer.invoke(CHANNELS.streamsList) as Promise<StreamEndpointView[]>,
  streamCreate: (input) => ipcRenderer.invoke(CHANNELS.streamCreate, input) as Promise<StreamMutationResult>,
  streamUpdate: (id, patch) =>
    ipcRenderer.invoke(CHANNELS.streamUpdate, id, patch) as Promise<StreamMutationResult>,
  streamDelete: (id) => ipcRenderer.invoke(CHANNELS.streamDelete, id) as Promise<StreamMutationResult>,
  streamStatus: (id) => ipcRenderer.invoke(CHANNELS.streamStatus, id) as Promise<StreamStatus>,
  openStreamWindow: (id) => ipcRenderer.invoke(CHANNELS.streamOpenWindow, id) as Promise<boolean>,
  closeStreamWindow: (id) => ipcRenderer.invoke(CHANNELS.streamCloseWindow, id) as Promise<boolean>,
  streamSetRecording: (id, record) =>
    ipcRenderer.invoke(CHANNELS.streamSetRecording, id, record) as Promise<StreamMutationResult>,

  recordingProbe: () =>
    ipcRenderer.invoke(CHANNELS.recordingProbe) as Promise<{
      ok: boolean;
      directory: string;
      message: string;
    }>,
  recordingOpen: () => ipcRenderer.invoke(CHANNELS.recordingOpen) as Promise<GatherResult>,
  recordingPickDir: () => ipcRenderer.invoke(CHANNELS.recordingPickDir) as Promise<string | null>,

  remotePending: () =>
    ipcRenderer.invoke(CHANNELS.remotePending) as Promise<
      Array<{ id: string; name: string; address: string; at: number }>
    >,
  remoteApprove: (id, accept) =>
    ipcRenderer.invoke(CHANNELS.remoteApprove, id, accept) as Promise<{ ok: boolean }>,
  remoteForget: (token) =>
    ipcRenderer.invoke(CHANNELS.remoteForget, token) as Promise<{ ok: boolean }>,
  remoteSetPassword: (password) =>
    ipcRenderer.invoke(CHANNELS.remoteSetPassword, password) as Promise<{
      ok: boolean;
      hasPassword: boolean;
      message?: string;
    }>,

  macrosList: () => ipcRenderer.invoke(CHANNELS.macrosList) as Promise<Macro[]>,
  macroCreate: (name) => ipcRenderer.invoke(CHANNELS.macroCreate, name) as Promise<Macro>,
  macroUpdate: (id, patch) => ipcRenderer.invoke(CHANNELS.macroUpdate, id, patch) as Promise<Macro | null>,
  macroDelete: (id) => ipcRenderer.invoke(CHANNELS.macroDelete, id) as Promise<{ ok: boolean }>,
  macroRun: (id) =>
    ipcRenderer.invoke(CHANNELS.macroRun, id) as Promise<{ ok: boolean; executed: number; message?: string }>,
  macroStop: (id) => ipcRenderer.invoke(CHANNELS.macroStop, id) as Promise<{ ok: boolean }>,
  macrosRunning: () => ipcRenderer.invoke(CHANNELS.macrosRunning) as Promise<{ running: string[] }>,
  macroDuplicate: (id) => ipcRenderer.invoke(CHANNELS.macroDuplicate, id) as Promise<Macro | null>,
  macroHistory: () => ipcRenderer.invoke(CHANNELS.macroHistory) as Promise<MacroRunEntry[]>,
  macroHistoryClear: () => ipcRenderer.invoke(CHANNELS.macroHistoryClear) as Promise<{ ok: boolean }>,
  macroExport: () => ipcRenderer.invoke(CHANNELS.macroExport) as Promise<string>,
  macroImport: (raw) =>
    ipcRenderer.invoke(CHANNELS.macroImport, raw) as Promise<{ imported: number; message?: string }>,
  macroFromTemplate: (id, name) =>
    ipcRenderer.invoke(CHANNELS.macroFromTemplate, id, name) as Promise<Macro | null>,
  macroPickPath: (kind) =>
    ipcRenderer.invoke(CHANNELS.macroPickPath, kind) as Promise<string | null>,
  macroReadSound: (filePath) =>
    ipcRenderer.invoke(CHANNELS.macroReadSound, filePath) as Promise<string | null>,

  showList: () => ipcRenderer.invoke(CHANNELS.showList) as Promise<ShowStep[]>,
  showAdd: (name, at, notes) =>
    ipcRenderer.invoke(CHANNELS.showAdd, name, at, notes) as Promise<ShowStep>,
  showUpdate: (id, patch) => ipcRenderer.invoke(CHANNELS.showUpdate, id, patch) as Promise<{ ok: boolean }>,
  showDelete: (id) => ipcRenderer.invoke(CHANNELS.showDelete, id) as Promise<{ ok: boolean }>,
  showReset: () => ipcRenderer.invoke(CHANNELS.showReset) as Promise<{ ok: boolean }>,
  showNext: () =>
    ipcRenderer.invoke(CHANNELS.showNext) as Promise<{ ok: boolean; step?: ShowStep; message?: string }>,

  watchAlerts: () => ipcRenderer.invoke(CHANNELS.watchAlerts) as Promise<WatchAlert[]>,
  watchAcknowledge: () => ipcRenderer.invoke(CHANNELS.watchAcknowledge) as Promise<{ ok: boolean }>,
  watchReset: () => ipcRenderer.invoke(CHANNELS.watchReset) as Promise<{ ok: boolean }>,
  diagnosticsList: () => ipcRenderer.invoke(CHANNELS.diagnosticsList) as Promise<StreamDiagnostics[]>,

  replaySave: (id) => ipcRenderer.invoke(CHANNELS.replaySave, id) as Promise<string | null>,
  replayAvailable: (id) =>
    ipcRenderer.invoke(CHANNELS.replayAvailable, id) as Promise<{ seconds: number }>,
  replayOpenFolder: () => ipcRenderer.invoke(CHANNELS.replayOpenFolder) as Promise<GatherResult>,

  storageList: () => ipcRenderer.invoke(CHANNELS.storageList) as Promise<StorageEntry[]>,
  storagePickDir: () => ipcRenderer.invoke(CHANNELS.storagePickDir) as Promise<string | null>,
  storageOpen: (directory?: string) =>
    ipcRenderer.invoke(CHANNELS.storageOpen, directory) as Promise<GatherResult>,
  getPaths: () => ipcRenderer.invoke(CHANNELS.pathsGet) as Promise<AppPaths>,

  getLogs: () => ipcRenderer.invoke(CHANNELS.logsGet) as Promise<LogEntry[]>,
  clearLogs: () => ipcRenderer.invoke(CHANNELS.logsClear) as Promise<void>,

  copyToClipboard: (text: string) => ipcRenderer.invoke(CHANNELS.clipboardWrite, text) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<void>,
  openPath: (target: string) => ipcRenderer.invoke(CHANNELS.openPath, target) as Promise<void>,

  openFirewallPorts: () =>
    ipcRenderer.invoke(CHANNELS.firewallOpenPorts) as Promise<FirewallResult>,

  on: <K extends keyof StreamControlEvents>(
    channel: K,
    listener: (payload: StreamControlEvents[K]) => void,
  ): Unsubscribe => {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`Canal d'evenement inconnu : ${String(channel)}`);
    }
    const wrapped = (_event: unknown, payload: unknown) => {
      listener(payload as StreamControlEvents[K]);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  platform: process.platform,
  appVersion: readVersionFromArgs(),
};

contextBridge.exposeInMainWorld('streamcontrol', api);
