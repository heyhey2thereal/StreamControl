import { app, BrowserWindow, dialog, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { Logger } from './logger';
import { MediamtxManager } from './mediamtx-manager';
import { getNetworkInfo } from './network';
import { ObsController } from './obs-controller';
import { SettingsStore } from './settings';
import { LockManager } from './lock-manager';
import { StreamController } from './stream-controller';
import { StreamRegistry } from './stream-registry';
import { WebPagesServer } from './web-pages';
import { RemoteManager } from './remote';
import { Automation } from './automation';
import { StreamWatcher } from './watcher';
import { DiagnosticsTracker } from './diagnostics';
import { CHANNELS } from '../shared/channels';
import type { AppSettings } from '../shared/types';
import { resolveRecordingDir } from './recording';
import { replayBufferDir } from './replay';
import { resolveStorageDir } from './storage';
import { readSoundFile } from './sound';

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.STREAMCONTROL_DEV_SERVER ?? 'http://127.0.0.1:5173';

/** Nom lisible du systeme, pour la variable `{poste_systeme}`. */
function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform;
  }
}

/** Nom d'utilisateur du poste, sans jamais faire echouer une macro. */
function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

// Une seule instance : deux processus se disputeraient les ports de MediaMTX.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// En developpement, la sortie console aide ; dans l'EXE, elle est inutile et
// coute une ecriture par entree. On ne la garde donc que hors paquet.
const logger = new Logger({ mirrorToConsole: isDev });
const settings = new SettingsStore(logger);
const mediamtx = new MediamtxManager(logger, settings);
const obs = new ObsController(logger, settings);
const lock = new LockManager(logger, settings);

// Panneau de controle distant : appairage valide sur le poste.
const remote = new RemoteManager(logger, settings);

// MediaMTX est le seul serveur de flux : il recoit les publications et les
// redistribue en RTMP, HLS, WebRTC, RTSP et SRT.
const registry = new StreamRegistry();

// Port retenu au demarrage, ecrit dans les parametres s'il differe du reglage.
let activeWebPagesPort = 0;

const streams = new StreamController({
  logger,
  settings,
  registry,
  mediamtx,
  getNetwork: () => getNetworkInfo(settings.get().network.overrideIPv4),
  // Toujours le port enregistre : il est mis a jour si un port de secours a
  // ete necessaire au demarrage.
  getWebPagesPort: () => settings.get().mediamtx.webPagesPort,
  appVersion: app.getVersion(),
});

// Pages web servies depuis un autre poste. Elles ne produisent aucun flux :
// elles listent les adresses et renvoient vers les URL de MediaMTX. Elles
// refusent de repondre tant que MediaMTX est arrete.
const webPages = new WebPagesServer({
  logger,
  streams,
  // Les pages web suivent la langue de l'interface.
  getLanguage: () => settings.get().ui.language,
  isMediamtxRunning: () => mediamtx.isRunning,
  getMediamtxPorts: () => {
    const { hlsPort, webrtcPort } = settings.get().mediamtx;
    return { hlsPort, webrtcPort };
  },
  getActivePort: () => settings.get().mediamtx.webPagesPort,
  appVersion: app.getVersion(),
  remote,
  obs,
  // Actions du poste declenchables depuis le telephone. Elles passent par les
  // controleurs existants : le telephone ne fait que les declencher.
  remoteActions: {
    lockWorkstation: async () => {
      await lock.lock();
      mainWindow?.webContents.send(CHANNELS.eventSettingsChanged, settings.get());
    },
    setStreamRecording: async (id, record) => streams.update(id, { record }),
    restartMediamtx: () => mediamtx.restart(),
    runMacro: (id) => automation.runMacro(id, 'remote'),
    listMacros: () =>
      settings.get().macros.filter((macro) => !macro.disabled).map((macro) => ({ id: macro.id, name: macro.name })),
  },
});

// Surveillance des flux et analyse technique : ils observent l'etat a chaque
// rafraichissement, sans rien modifier.
const watcher = new StreamWatcher(logger, settings);
const diagnostics = new DiagnosticsTracker();

// Automatisation : macros et conducteur de spectacle. Les actions passent par
// les controleurs existants, jamais directement par le systeme.
const automation = new Automation(logger, settings, {
  setScene: async (sceneName) => {
    await obs.setScene(sceneName);
  },
  transition: async () => {
    await obs.transition();
  },
  toggleStreaming: async (start) => {
    const status = obs.getStatus();
    if (status.streaming !== start) await obs.toggleStreaming();
  },
  toggleObsRecording: async (start) => {
    const status = obs.getStatus();
    if (status.recording !== start) await obs.toggleRecording();
  },
  setStreamRecording: async (streamId, record) => {
    streams.update(streamId, { record });
  },
  lock: async () => {
    await lock.lock();
  },
  restartMediamtx: async () => {
    await mediamtx.restart();
  },
  saveReplay: async (streamId) => {
    await streams.saveReplay(streamId);
  },
  createStream: async (name, path) => streams.create({ name, path }),
  deleteStream: async (streamId) => streams.remove(streamId),
  startMediamtx: async () => {
    await mediamtx.start();
  },
  stopMediamtx: async () => {
    await mediamtx.stop();
  },
  setPreviewScene: async (sceneName) => {
    await obs.setPreviewScene(sceneName);
  },
  setTransition: async (name) => {
    await obs.setTransition(name);
  },
  setTransitionDuration: async (ms) => {
    await obs.setTransitionDuration(ms);
  },
  setStudioMode: async (enabled) => {
    await obs.setStudioMode(enabled);
  },
  createScene: async (name) => {
    await obs.createScene(name);
  },
  isObsConnected: () => obs.getStatus().connected,
  isMediamtxRunning: () => mediamtx.isRunning,
  isStreamLive: (streamId) => {
    const list = streams.list();
    if (!streamId) return list.some((entry) => entry.status.publishing);
    return list.find((entry) => entry.id === streamId)?.status.publishing === true;
  },
  isRecording: () => obs.getStatus().recording,
  isStreaming: () => obs.getStatus().streaming,
  checkPassword: (password) => lock.checkPassword(password),
  // Les modeles de macro se construisent avec les scenes reellement presentes.
  obsScenes: () => obs.getStatus().scenes.map((scene) => scene.name),

  // --- Actions OBS supplementaires ---------------------------------------
  deleteScene: async (name) => {
    await obs.removeScene(name);
  },
  renameScene: async (from, to) => {
    await obs.renameScene(from, to);
  },
  setSourceVisible: async (source, visible) => {
    await obs.setSourceVisible(source, visible);
  },
  setSourceMuted: async (source, muted) => {
    await obs.setSourceMuted(source, muted);
  },
  setSourceVolume: async (source, volume) => {
    await obs.setSourceVolume(source, volume);
  },
  listSources: () => obs.getStatus().sources ?? [],
  toggleStreamingAuto: async () => {
    await obs.toggleStreaming();
  },
  toggleObsRecordingAuto: async () => {
    await obs.toggleRecording();
  },
  pauseObsRecording: async () => {
    await obs.pauseRecording();
  },
  resumeObsRecording: async () => {
    await obs.resumeRecording();
  },
  splitObsRecording: async () => {
    await obs.splitRecording();
  },

  // --- Flux --------------------------------------------------------------
  saveReplayAll: async () => {
    const live = streams.list().filter((entry) => entry.status.publishing);
    let saved = 0;
    for (const entry of live) {
      if (await streams.saveReplay(entry.id)) saved += 1;
    }
    return saved;
  },
  setStreamEnabled: async (streamId, enabled) => {
    streams.update(streamId, { enabled });
  },

  // --- Alertes et systeme ------------------------------------------------
  log: (level, text) => {
    // Le message part dans le journal de l'application, avec le niveau
    // demande : l'operateur le retrouve dans l'onglet Journaux.
    if (level === 'error') logger.error('macro', text);
    else if (level === 'warn') logger.warn('macro', text);
    else logger.info('macro', text);
  },
  notify: (text, toast = true) => {
    // Le journal garde toujours une trace : c'est ce qui permet de relire ce qui
    // s'est passe, meme si la bulle a disparu.
    logger.info('macro', text);
    // La bulle n'est envoyee que si la coche le demande. Sans elle, le message
    // reste dans le journal.
    if (toast) mainWindow?.webContents.send(CHANNELS.eventMacroNotice, text);
  },
  popup: (text, confirmLabel, requireConfirmation) =>
    showMacroPopup(text, confirmLabel, requireConfirmation),
  playSound: async (filePath, volume) => {
    const target = filePath.trim();
    // Chemin vide : bip systeme. C'est le comportement par defaut du bloc.
    if (!target) {
      shell.beep();
      return;
    }
    // Un fichier choisi est transmis au rendu, qui le joue : Electron n'offre
    // cote principal qu'un bip systeme, sans lecteur audio.
    const dataUrl = await readSoundFile(target);
    if (!dataUrl) {
      // Fichier illisible : on le dit dans le journal, puis on retombe sur le
      // bip pour que l'alerte reste audible.
      logger.warn('macro', `Son introuvable ou illisible : ${target}`);
      shell.beep();
      return;
    }
    mainWindow?.webContents.send(CHANNELS.eventMacroPlaySound, {
      dataUrl,
      label: target,
      // Le volume vient du bloc ; absent, on joue a plein volume.
      volume: typeof volume === 'number' ? Math.max(0, Math.min(100, volume)) : 100,
    });
  },
  openFolder: async (target) => {
    const directory = target.trim() || resolveRecordingDir(settings.get().recording.path);
    await mkdir(directory, { recursive: true }).catch(() => undefined);
    await shell.openPath(directory);
  },
  openUrl: async (url) => {
    await shell.openExternal(url);
  },
  httpGet: async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { ok: response.ok, message: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
  /**
   * Contexte des variables de macro, relu a chaque action.
   *
   * Il est reconstruit a chaque appel : une scene changee par le bloc precedent
   * est donc vue par le suivant, et `{date}`/`{heure}` donnent l'instant exact
   * de l'action.
   */
  variables: () => {
    const current = settings.get();
    const obsStatus = obs.getStatus();
    const mediamtxStatus = mediamtx.getStatus();
    const endpoints = streams.list();
    const network = getNetworkInfo(current.network.overrideIPv4);
    const activePort = current.mediamtx.webPagesPort;

    /** Convertit un flux affiche en flux vu par les variables. */
    const toVariableStream = (endpoint: (typeof endpoints)[number]) => ({
      id: endpoint.id,
      name: endpoint.name,
      path: endpoint.path,
      live: endpoint.status.publishing,
      width: endpoint.status.videoWidth,
      height: endpoint.status.videoHeight,
      hasAudio: endpoint.status.hasAudio,
      bitrateKbps: endpoint.status.bitrateKbps,
      viewers: endpoint.status.viewers,
      startedAt: endpoint.status.startedAt,
      publisher: endpoint.status.publisher,
      recording: endpoint.status.recording,
      recordingPath: endpoint.status.recordingPath,
      urls: endpoint.urls,
    });

    return {
      // Sans flux designe (macro lancee a la main), on prend le premier flux en
      // direct : c'est ce que l'operateur veut dire par « le flux courant ».
      flux: (() => {
        const live = endpoints.find((endpoint) => endpoint.status.publishing);
        const chosen = live ?? endpoints[0];
        return chosen ? toVariableStream(chosen) : undefined;
      })(),
      streams: endpoints.map(toVariableStream),
      obs: {
        connected: obsStatus.connected,
        version: obsStatus.version,
        host: obsStatus.host,
        port: obsStatus.port,
        currentScene: obsStatus.currentScene,
        previewScene: obsStatus.previewScene,
        studioMode: obsStatus.studioMode,
        currentTransition: obsStatus.currentTransition,
        transitionDurationMs: obsStatus.transitionDurationMs,
        streaming: obsStatus.streaming,
        recording: obsStatus.recording,
        scenes: obsStatus.scenes.map((scene) => scene.name),
        sources: obsStatus.sources ?? [],
      },
      mediamtx: {
        state: mediamtxStatus.state,
        running: mediamtx.isRunning,
        rtmpPort: current.mediamtx.rtmpPort,
        hlsPort: current.mediamtx.hlsPort,
        webrtcPort: current.mediamtx.webrtcPort,
        rtspPort: current.mediamtx.rtspPort,
        apiPort: current.mediamtx.apiPort,
        webPagesPort: activePort,
        streamPath: current.mediamtx.streamPath,
      },
      poste: {
        hostname: network.hostname,
        ip: network.primaryIPv4 ?? '127.0.0.1',
        ipLocal: '127.0.0.1',
        system: platformLabel(process.platform),
        platform: process.platform,
        user: safeUserName(),
        locked: settings.get().ui.locked,
        userDataDir: app.getPath('userData'),
        storageDir: resolveStorageDir(current.files.storagePath),
        recordingsDir: resolveRecordingDir(current.recording.path),
        replayDir: replayBufferDir(current.replay.path),
      },
      app: {
        name: 'StreamControl',
        version: app.getVersion(),
        language: current.ui.language,
        theme: current.ui.theme,
      },
    };
  },
});

// Les alertes de surveillance peuvent declencher des macros.
watcher.on('alert', (alert: { kind: string; path: string }) => {
  void automation.onAlert(alert.kind, alert.path);
});

/**
 * Toute modification des reglages remonte a la fenetre.
 *
 * C'est ce qui fait apparaitre l'ecran de verrouillage quand le poste est
 * verrouille ailleurs que dans le formulaire : une macro « verrouiller le
 * poste », le panneau distant, ou le deverrouillage. Sans ce relais, les
 * donnees changeaient mais l'interface ne le savait pas — le poste se croyait
 * deverrouille alors qu'il ne l'etait plus, ou l'inverse.
 */
settings.on('changed', (current: AppSettings) => {
  mainWindow?.webContents.send(CHANNELS.eventSettingsChanged, current);
});

// Le conducteur horaire est verifie chaque minute.
const scheduleTimer = setInterval(() => void automation.onSchedule(), 60_000);
scheduleTimer.unref?.();

// Une connexion de flux peut declencher une macro (regle explicite).
streams.on('device-connected', (device: { path: string }) => {
  void automation.onStreamConnected(device.path);
});

let mainWindow: BrowserWindow | null = null;

/**
 * Affiche une pop-up sur le poste, pour une action de macro.
 *
 * Avec confirmation, la macro attend la reponse : c'est une validation humaine
 * au milieu d'une sequence. Sans confirmation, elle informe et continue.
 */
async function showMacroPopup(
  text: string,
  confirmLabel: string,
  requireConfirmation: boolean,
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'StreamControl',
    message: text,
    buttons: requireConfirmation ? [confirmLabel, 'Annuler'] : ['OK'],
    defaultId: 0,
    cancelId: requireConfirmation ? 1 : 0,
    noLink: true,
  };
  const window = mainWindow;
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return !requireConfirmation || result.response === 0;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'StreamControl',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      additionalArguments: [`--streamcontrol-version=${app.getVersion()}`],
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // La fenetre peut rester ouverte des heures pendant une diffusion. Quand elle
  // est masquee ou reduite, on laisse Chromium reduire son activite : c'est de
  // la memoire et du processeur rendus a la regie.
  mainWindow.on('hide', () => mainWindow?.webContents.setBackgroundThrottling(true));
  mainWindow.on('show', () => mainWindow?.webContents.setBackgroundThrottling(false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Les liens externes s'ouvrent dans le navigateur, jamais dans une fenetre Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Bloque toute navigation hors de l'application.
  // Seule l'origine de l'application est autorisee a naviguer dans la fenetre.
  const allowedOrigin = isDev ? DEV_SERVER_URL : 'file://';
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(allowedOrigin)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  await settings.load();
  logger.setMaxEntries(settings.get().ui.maxLogLines);

  registerIpcHandlers({
    logger,
    settings,
    mediamtx,
    obs,
    streams,
    webPages,
    lock,
    remote,
    automation,
    watcher,
    diagnostics,
    getWindow: () => mainWindow,
  });

  // Les adresses sauvegardees sont chargees avant l'ouverture de la fenetre,
  // pour que l'interface affiche un etat reel.
  await streams.initialize();

  // Les pages web ne servent que quand MediaMTX tourne ; le serveur peut donc
  // etre demarre tout de suite, il repondra 503 tant qu'il est arrete.
  const current = settings.get();
  try {
    activeWebPagesPort = await webPages.start(current.mediamtx.webPagesPort);
    // Le port retenu est enregistre : les URL affichees, la fenetre de lecture
    // et le pare-feu doivent tous viser le meme. Sans cela, un port de secours
    // resterait invisible et la fenetre s'ouvrirait sur un port ferme.
    if (activeWebPagesPort !== current.mediamtx.webPagesPort) {
      await settings.save({ mediamtx: { ...settings.get().mediamtx, webPagesPort: activeWebPagesPort } });
    }
  } catch (error) {
    logger.errorFrom('app', error, 'Pages web non demarrees');
  }

  // Le pare-feu n'est PLUS modifie au demarrage.
  //
  // Cette modification lancait PowerShell avec une commande encodee pour
  // ajouter des regles de pare-feu et en supprimer d'autres. Pour un antivirus,
  // c'est la signature exacte d'un logiciel malveillant : un programme non
  // signe qui ouvre PowerShell de facon obfusquee pour toucher au pare-feu.
  // Norton le bloquait, puis fermait l'application.
  //
  // L'autorisation reste possible, mais uniquement sur action explicite de
  // l'utilisateur, depuis les Parametres.

  createWindow();

  if (current.mediamtx.autoStart) {
    logger.info('app', 'Demarrage automatique de MediaMTX (reglage active).');
    const result = await mediamtx.start();
    if (!result.ok) logger.error('app', result.message ?? 'Demarrage automatique de MediaMTX impossible.');
  }

  if (current.obs.autoConnect) {
    logger.info('app', 'Connexion automatique a OBS (reglage active).');
    void obs.connect();
  }
}

app.whenReady().then(() => {
  logger.info('app', `StreamControl ${app.getVersion()} demarre.`);
  logger.info('app', `Parametres : ${settings.path}`);

  void bootstrap().catch((error: unknown) => {
    logger.errorFrom('app', error, 'Initialisation impossible');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Arret propre de MediaMTX et d'OBS avant de quitter.
let shuttingDown = false;
app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;

  logger.info('app', 'Fermeture : arret des services...');
  void (async () => {
    try {
      obs.dispose();
      streams.dispose();
      await webPages.stop();
      await mediamtx.dispose();
      // Un poste ferme verrouille doit se rouvrir deverrouille.
      await lock.releaseOnQuit();
    } catch (error) {
      logger.errorFrom('app', error, 'Erreur pendant la fermeture');
    } finally {
      app.quit();
    }
  })();
});

process.on('uncaughtException', (error) => {
  logger.errorFrom('app', error, 'Exception non geree');
});

process.on('unhandledRejection', (reason) => {
  logger.errorFrom('app', reason, 'Promesse rejetee non geree');
});
