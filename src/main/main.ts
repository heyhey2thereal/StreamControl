import { app, BrowserWindow, shell } from 'electron';
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

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.STREAMCONTROL_DEV_SERVER ?? 'http://127.0.0.1:5173';

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
});

let mainWindow: BrowserWindow | null = null;

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
