import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CHANNELS } from '../shared/channels';
import type {
  AppPaths,
  AppSettings,
  AppUpdateInfo,
  DetectionKind,
  DeviceEvent,
  DetectedTool,
  FirewallResult,
  GatherResult,
  LogEntry,
  ObsStatus,
  PreflightReport,
  ServiceActionResult,
  ServiceStatus,
  StorageEntry,
  StreamEndpoint,
  StreamEndpointView,
  StreamMutationResult,
  StreamStatus,
  StreamUrls,
  UpdateResult,
  LockState,
} from '../shared/types';
import { detectAllTools } from './detection';
import { checkAppUpdate } from './app-updater';
import type { LockManager } from './lock-manager';
import type { Logger } from './logger';
import type { MediamtxManager } from './mediamtx-manager';
import { downloadAndInstallMediamtx, fetchLatestRelease } from './mediamtx-updater';
import type { ObsController } from './obs-controller';
import { checkReachability } from './firewall';
import { getNetworkInfo } from './network';
import { buildPreflight } from './preflight';
import { listStorageEntries, resolveStorageDir } from './storage';
import type { SettingsStore } from './settings';
import type { StreamController } from './stream-controller';
import type { WebPagesServer } from './web-pages';

/** Schemas autorises pour shell.openExternal, afin d'eviter l'ouverture de protocoles arbitraires. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/** Types de fichiers proposes dans la boite de dialogue de selection. */
const BROWSE_FILTERS: Record<DetectionKind, Electron.FileFilter[]> = {
  mediamtx: [{ name: 'MediaMTX', extensions: ['exe'] }],
  obs: [{ name: 'OBS Studio', extensions: ['exe'] }],
  ffmpeg: [{ name: 'FFmpeg', extensions: ['exe'] }],
};

/**
 * Borne l'attente d'une promesse.
 * Retourne null si le delai est depasse, la valeur resolue sinon.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      // Le minuteur ne doit pas maintenir le processus en vie.
      timer.unref?.();
    }),
  ]).catch(() => null);
}

export interface IpcContext {
  logger: Logger;
  settings: SettingsStore;
  mediamtx: MediamtxManager;
  obs: ObsController;
  streams: StreamController;
  webPages: WebPagesServer;
  lock: LockManager;
  getWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(context: IpcContext): void {
  const { logger, settings, mediamtx, obs, streams, webPages, lock, getWindow } = context;

  /** Enveloppe un gestionnaire pour renvoyer une erreur lisible au rendu. */
  const handle = <T>(channel: string, handler: (...args: never[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await (handler as (...inner: unknown[]) => Promise<T> | T)(...args);
      } catch (error) {
        logger.errorFrom('ipc', error, `Echec du canal ${channel}`);
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    });
  };

  // Deux variantes : l'utilisateur declenche la premiere, le rafraichissement
  // periodique la seconde, qui reste silencieuse tant que rien ne change.
  const currentPreflight = (quiet = false): Promise<PreflightReport> =>
    buildPreflight(settings.get(), logger, quiet);
  const quietPreflight = (): Promise<PreflightReport> => currentPreflight(true);

  // --- Parametres ---------------------------------------------------------
  handle<AppSettings>(CHANNELS.settingsGet, () => settings.get());

  handle<AppSettings>(CHANNELS.settingsSave, async (patch: Partial<AppSettings>) => {
    const before = settings.get().mediamtx;
    const beforeMaxLogLines = settings.get().ui.maxLogLines;
    const saved = await settings.save(patch);
    const after = saved.mediamtx;

    // La borne du journal vit dans le processus principal : sans cela, le
    // reglage n'aurait aucun effet sur la memoire reellement occupee.
    if (saved.ui.maxLogLines !== beforeMaxLogLines) logger.setMaxEntries(saved.ui.maxLogLines);

    // Le rendu doit voir le changement, meme s'il ne l'a pas demande : la
    // langue et les bornes s'appliquent sans redemarrage.
    getWindow()?.webContents.send(CHANNELS.eventSettingsChanged, saved);

    // Un port modifie ne prend effet qu'au redemarrage de MediaMTX : le
    // processus ecoute encore sur l'ancien. On redemarre donc si besoin, et
    // l'interface est mise a jour dans tous les cas.
    const portsChanged =
      before.rtmpPort !== after.rtmpPort ||
      before.hlsPort !== after.hlsPort ||
      before.webrtcPort !== after.webrtcPort ||
      before.rtspPort !== after.rtspPort ||
      before.apiPort !== after.apiPort;

    if (portsChanged && mediamtx.isRunning) {
      logger.info('ipc', 'Ports modifies : redemarrage de MediaMTX.');
      await mediamtx.restart();
    }

    // Le port des pages web appartient a StreamControl : c'est son propre
    // serveur qui doit redemarrer, sinon l'ancien port reste le seul a repondre.
    if (before.webPagesPort !== after.webPagesPort) {
      logger.info('ipc', `Port des pages web modifie (${after.webPagesPort}) : redemarrage.`);
      await webPages.restart(after.webPagesPort);
    }

    getWindow()?.webContents.send(CHANNELS.eventStreamsChanged, streams.list());
    getWindow()?.webContents.send(CHANNELS.eventPreflightUpdate, await quietPreflight());
    return saved;
  });

  handle<AppSettings>(CHANNELS.settingsReset, async () => {
    const saved = await settings.reset();
    getWindow()?.webContents.send(CHANNELS.eventSettingsChanged, saved);
    getWindow()?.webContents.send(CHANNELS.eventPreflightUpdate, await quietPreflight());
    return saved;
  });

  // --- Etat de la machine -------------------------------------------------
  handle<PreflightReport>(CHANNELS.preflightGet, () => quietPreflight());
  handle<PreflightReport>(CHANNELS.preflightRefresh, (verbose = false) => currentPreflight(!verbose));
  handle<StreamUrls>(CHANNELS.urlsGet, async () => (await quietPreflight()).urls);

  // --- MediaMTX -----------------------------------------------------------
  const broadcastService = (name: 'mediamtx', status: ServiceStatus) => {
    getWindow()?.webContents.send(CHANNELS.eventServiceStatus, { name, status });
  };

  handle<ServiceActionResult>(CHANNELS.mediamtxStart, () => mediamtx.start());
  handle<ServiceActionResult>(CHANNELS.mediamtxStop, () => mediamtx.stop());
  handle<ServiceActionResult>(CHANNELS.mediamtxRestart, () => mediamtx.restart());
  handle<ServiceStatus>(CHANNELS.mediamtxStatus, () => mediamtx.getStatus());

  mediamtx.on('status', (status: ServiceStatus) => {
    broadcastService('mediamtx', status);
    if (status.state === 'running') {
      // MediaMTX demarre : on declare les chemins qui manqueraient, puis on
      // relit son etat.
      void streams.refreshLiveStatus();
      void quietPreflight().then((report) => {
        getWindow()?.webContents.send(CHANNELS.eventPreflightUpdate, report);
      });
    }
  });

  // --- Detection et installation -----------------------------------------
  handle<DetectedTool[]>(CHANNELS.toolsDetect, async () => {
    const current = settings.get();
    return detectAllTools(logger, {
      mediamtx: current.mediamtx.binaryPath,
      obs: current.obsExecutablePath,
    });
  });

  handle<string | null>(CHANNELS.toolsBrowse, async (kind: DetectionKind) => {
    const window = getWindow();
    const filters = BROWSE_FILTERS[kind] ?? [];
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Selectionner un executable',
          properties: ['openFile'],
          filters: [...filters, { name: 'Tous les fichiers', extensions: ['*'] }],
        })
      : await dialog.showOpenDialog({
          title: 'Selectionner un executable',
          properties: ['openFile'],
          filters: [...filters, { name: 'Tous les fichiers', extensions: ['*'] }],
        });

    if (result.canceled || result.filePaths.length === 0) return null;
    return path.resolve(result.filePaths[0]);
  });

  handle<UpdateResult>(CHANNELS.mediamtxDownload, async () => {
    const result = await downloadAndInstallMediamtx(logger);
    if (result.ok && result.binaryPath) {
      // La nouvelle version doit etre utilisee au prochain demarrage.
      await settings.save({ mediamtx: { ...settings.get().mediamtx, binaryPath: result.binaryPath } });
      getWindow()?.webContents.send(CHANNELS.eventPreflightUpdate, await quietPreflight());
    }
    return result;
  });

  handle<{ version: string } | { error: string }>(CHANNELS.mediamtxCheckUpdate, async () => {
    try {
      const release = await fetchLatestRelease();
      return { version: release.version };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- Mise a jour de StreamControl ---------------------------------------
  // `force` sert au bouton des Parametres : il ignore la version ecartee, pour
  // que l'utilisateur retrouve une mise a jour apres « Ne plus me rappeler ».
  handle<AppUpdateInfo | null>(CHANNELS.appCheckUpdate, (force = false) =>
    checkAppUpdate(logger, {
      currentVersion: app.getVersion(),
      dismissedVersion: settings.get().ui.dismissedUpdateVersion,
      force: force === true,
    }),
  );

  // --- Verrouillage du poste ----------------------------------------------
  handle<LockState>(CHANNELS.lockState, () => lock.getState());
  handle<LockState>(CHANNELS.lockSetPassword, (password: string, hint: string) =>
    lock.setPassword(String(password ?? ''), String(hint ?? '')),
  );
  handle<LockState>(CHANNELS.lockNow, () => lock.lock());
  handle<{ ok: boolean; state: LockState; message?: string }>(CHANNELS.lockUnlock, (password: string) =>
    lock.unlock(String(password ?? '')),
  );

  // --- OBS ----------------------------------------------------------------
  handle<ServiceActionResult>(CHANNELS.obsLaunch, () => obs.launchObs());
  handle<{ ok: boolean; message: string }>(CHANNELS.obsUseStreamControl, () => {
    // Le serveur et la cle viennent de la premiere adresse de diffusion :
    // c'est la meme valeur que celle affichee dans le tutoriel.
    const endpoint = streams.list()[0];
    if (!endpoint) return { ok: false, message: "Creez d'abord une adresse dans l'onglet Flux." };
    const url = new URL(endpoint.urls.rtmpIngest);
    const segments = url.pathname.replace(/^\/+/, '').split('/');
    const server = `${url.protocol}//${url.host}/${segments[0] ?? 'live'}`;
    const key = segments.slice(1).join('/') || 'a-la-demande';
    return obs.useStreamControl(server, key);
  });
  handle<{ ok: boolean; message: string }>(CHANNELS.obsShowStream, (id: string) => {
    // L'adresse /embed est la version sans habillage de notre lecteur : c'est
    // exactement ce qu'OBS doit afficher, et elle passe par la boucle locale.
    const endpoint = streams.list().find((entry) => entry.id === id) ?? streams.list()[0];
    if (!endpoint) return { ok: false, message: "Creez d'abord une adresse dans l'onglet Flux." };
    return obs.showStreamInScene(endpoint.name, endpoint.urls.embed);
  });
  handle<ObsStatus>(CHANNELS.obsConnect, () => obs.connect());
  handle<ObsStatus>(CHANNELS.obsDisconnect, () => obs.disconnect());
  handle<ObsStatus>(CHANNELS.obsSetScene, (sceneName: string) => obs.setScene(sceneName));
  handle<ObsStatus>(CHANNELS.obsToggleStreaming, () => obs.toggleStreaming());
  handle<ObsStatus>(CHANNELS.obsToggleRecording, () => obs.toggleRecording());
  handle<ObsStatus>(CHANNELS.obsStatus, () => obs.getStatus());
  handle<ObsStatus>(CHANNELS.obsStudioMode, (enabled: boolean) => obs.setStudioMode(enabled === true));
  handle<ObsStatus>(CHANNELS.obsPreviewScene, (name: string) => obs.setPreviewScene(String(name ?? '')));
  handle<ObsStatus>(CHANNELS.obsTransition, () => obs.transition());
  handle<ObsStatus>(CHANNELS.obsSetTransition, (name: string) => obs.setTransition(String(name ?? '')));
  handle<ObsStatus>(CHANNELS.obsSetTransitionDuration, (ms: number) => obs.setTransitionDuration(Number(ms)));
  handle<string[]>(CHANNELS.obsSceneStreams, (sceneName: string) =>
    obs.sceneStreams(String(sceneName ?? '')),
  );
  handle<{ ok: boolean; message: string }>(CHANNELS.obsCreateScene, (name: string) =>
    obs.createScene(String(name ?? '')),
  );
  handle<{ ok: boolean; message: string }>(
    CHANNELS.obsConfigureScene,
    (sceneName: string, ids: string[]) => {
      // Les identifiants viennent du rendu : on les resout en nom et adresse
      // /embed, et on ecarte ce qui n'existe pas.
      const addresses = streams.list();
      const sources = (Array.isArray(ids) ? ids : [])
        .map((id) => addresses.find((entry) => entry.id === id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => ({ name: entry.name, url: entry.urls.embed }));
      return obs.configureScene(String(sceneName ?? ''), sources);
    },
  );

  obs.on('status', (status: ObsStatus) => {
    getWindow()?.webContents.send(CHANNELS.eventObsStatus, status);
  });

  // --- Adresses de diffusion ----------------------------------------------
  handle<StreamEndpointView[]>(CHANNELS.streamsList, () => streams.list());
  handle<StreamMutationResult>(CHANNELS.streamCreate, (input: Partial<StreamEndpoint>) =>
    streams.create(input),
  );
  handle<StreamMutationResult>(CHANNELS.streamUpdate, (id: string, patch: Partial<StreamEndpoint>) =>
    streams.update(id, patch),
  );
  handle<StreamMutationResult>(CHANNELS.streamDelete, (id: string) => streams.remove(id));
  handle<StreamStatus>(CHANNELS.streamStatus, (id: string) => streams.status(id));
  handle<boolean>(CHANNELS.streamOpenWindow, (id: string) => streams.openViewerWindow(id));
  handle<boolean>(CHANNELS.streamCloseWindow, (id: string) => streams.closeViewerWindow(id));

  streams.on('streams-changed', (list: StreamEndpointView[]) => {
    getWindow()?.webContents.send(CHANNELS.eventStreamsChanged, list);
  });
  streams.on('device-connected', (device: DeviceEvent) => {
    getWindow()?.webContents.send(CHANNELS.eventDeviceConnected, device);
  });
  streams.on('device-disconnected', (device: DeviceEvent) => {
    getWindow()?.webContents.send(CHANNELS.eventDeviceDisconnected, device);
  });
  streams.on('streams-refresh', () => {
    getWindow()?.webContents.send(CHANNELS.eventStreamsChanged, streams.list());
  });

  // --- Fichiers de l'application ------------------------------------------
  // Le rangement automatique a ete retire : il deplacait des fichiers sans que
  // l'utilisateur l'ait demande a chaque fois. Il ne reste que l'inventaire et
  // l'ouverture du dossier, qui informent sans rien modifier.
  handle<StorageEntry[]>(CHANNELS.storageList, () => listStorageEntries(settings.get().files.storagePath));

  handle<GatherResult>(CHANNELS.storageOpen, async (directory?: string) => {
    // Le dossier est cree au besoin : l'utilisateur ne doit pas avoir a le
    // fabriquer lui-meme avant de pouvoir l'ouvrir.
    const target = resolveStorageDir(directory ?? settings.get().files.storagePath);

    try {
      await mkdir(target, { recursive: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error('storage', `Dossier inaccessible : ${reason}`);
      return { ok: false, directory: target, moved: [], failed: [], message: reason };
    }

    // shell.openPath peut ne jamais repondre sur un systeme sans gestionnaire
    // de fichiers. On borne l'attente : le dossier existe deja, ce qui est
    // l'essentiel, et un echec d'ouverture ne doit pas bloquer le canal IPC.
    const failure = await withTimeout(shell.openPath(target), 4000);
    if (failure && typeof failure === 'string') {
      logger.warn('storage', `Ouverture du dossier refusee : ${failure}`);
      return { ok: false, directory: target, moved: [], failed: [], message: failure };
    }

    return { ok: true, directory: target, moved: [], failed: [], message: target };
  });

  handle<AppPaths>(CHANNELS.pathsGet, () => ({
    userData: app.getPath('userData'),
    settingsFile: settings.path,
    storageDir: resolveStorageDir(settings.get().files.storagePath),
  }));

  handle<string | null>(CHANNELS.storagePickDir, async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Choisir le dossier de rangement',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return path.resolve(result.filePaths[0]);
  });

  // --- Journaux -----------------------------------------------------------
  handle<LogEntry[]>(CHANNELS.logsGet, () => logger.getEntries());
  handle<void>(CHANNELS.logsClear, () => {
    logger.clear();
  });

  logger.on('entry', (entry: LogEntry) => {
    getWindow()?.webContents.send(CHANNELS.eventLogEntry, entry);
  });

  // --- Actions systeme ----------------------------------------------------
  handle<void>(CHANNELS.clipboardWrite, (text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  /**
   * Vrai des que l'ouverture externe a echoue une fois.
   *
   * Sur Windows 11, une installation sans navigateur associe aux liens renvoie
   * 0x800401F5 « Application introuvable ». Sans ce drapeau, chaque clic sur un
   * bouton de redirection empilait la meme erreur dans le journal. On essaie
   * une fois, puis on va directement a la fenetre interne.
   */
  let externalOpenUnavailable = false;

  /** Ouvre une URL dans une fenetre de l'application. */
  const openInAppWindow = async (url: string, title: string): Promise<void> => {
    const fallback = new BrowserWindow({
      width: 1100,
      height: 760,
      title: title || 'StreamControl',
      backgroundColor: '#0b0f14',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    fallback.setMenuBarVisibility(false);
    fallback.webContents.setWindowOpenHandler(({ url: opened }) => {
      if (/^https?:\/\//i.test(opened)) void shell.openExternal(opened);
      return { action: 'deny' };
    });
    await fallback.loadURL(url);
  };

  handle<void>(CHANNELS.openExternal, async (url: string) => {
    const target = String(url ?? '');
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error(`URL invalide : ${target}`);
    }
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`Protocole non autorise pour l'ouverture externe : ${parsed.protocol}`);
    }

    const address = parsed.toString();

    if (!externalOpenUnavailable) {
      try {
        await shell.openExternal(address);
        return;
      } catch (error) {
        externalOpenUnavailable = true;
        // Une seule ligne, au niveau information : c'est un repli assume, pas
        // une panne. Les clics suivants n'ajoutent plus rien au journal.
        const message = error instanceof Error ? error.message : String(error);
        logger.info(
          'ipc',
          `Ouverture par le navigateur par defaut indisponible (${message}). ` +
            "Les liens s'ouvriront desormais dans une fenetre de l'application.",
        );
      }
    }

    await openInAppWindow(address, parsed.hostname);
  });

  // --- Pare-feu Windows ---------------------------------------------------
  // Diagnostic d'acces reseau. StreamControl ne modifie AUCUNE regle de
  // pare-feu : c'est le comportement d'un logiciel malveillant, et les
  // antivirus ferment l'application pour cela. On se contente de dire si les
  // ports repondent, et quoi faire sinon.
  handle<FirewallResult>(CHANNELS.firewallOpenPorts, async () => {
    const current = settings.get().mediamtx;
    const network = getNetworkInfo(settings.get().network.overrideIPv4);
    const address = network.primaryIPv4 ?? '127.0.0.1';

    // Deux ports seulement sont joignables depuis le reseau : le RTMP, ou la
    // camera publie, et les pages web, qui relaient tout le reste.
    const ports = [
      { port: current.rtmpPort, label: 'RTMP' },
      { port: current.webPagesPort, label: 'Pages web' },
    ];

    const result = await checkReachability(address, ports);
    if (result.ok) logger.info('firewall', result.message);
    else logger.warn('firewall', result.message);
    return { ok: result.ok, applied: false, message: result.message };
  });

  handle<void>(CHANNELS.openPath, async (target: string) => {
    const resolved = path.resolve(String(target ?? ''));

    // Meme precaution que pour le dossier de rangement : une ouverture qui ne
    // repond jamais ne doit pas bloquer l'appel IPC.
    const errorMessage = await withTimeout(shell.openPath(resolved), 4000);
    if (typeof errorMessage === 'string' && errorMessage) throw new Error(errorMessage);
  });
}
