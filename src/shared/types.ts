/**
 * Types partages entre le processus principal Electron, le preload et le rendu.
 * Ce fichier ne doit contenir que des types (aucun import Node/DOM).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  source: string;
  level: LogLevel;
  message: string;
}

export type ServiceState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface ServiceStatus {
  state: ServiceState;
  detail?: string;
  pid?: number;
  startedAt?: number;
  /** Nombre de reconnexions automatiques deja tentees. */
  restarts?: number;
}

export interface NetworkInfo {
  /** IPv4 locale principale du PC (utilisee pour construire les URL). */
  primaryIPv4: string | null;
  /** Toutes les IPv4 locales detectees. */
  allIPv4: string[];
  hostname: string;
}

export interface MediamtxSettings {
  /** Dossier contenant mediamtx.exe. Vide = binaire embarque dans l'application. */
  binaryPath: string;
  /** Dossier contenant mediamtx.yml. Vide = fichier genere par l'application. */
  configPath: string;
  rtmpPort: number;
  hlsPort: number;
  webrtcPort: number;
  rtspPort: number;
  /**
   * Port de l'API HTTP de MediaMTX. StreamControl s'en sert pour connaitre
   * l'etat reel des flux (en direct ou non) et les dimensions de l'image.
   */
  apiPort: number;
  /**
   * Port des pages web de StreamControl, servies depuis un autre poste.
   * Elles refusent de repondre tant que MediaMTX est arrete.
   */
  webPagesPort: number;
  /** Chemin du flux publie par la camera, ex. "live". */
  streamPath: string;
  autoStart: boolean;
  /** Redemarre MediaMTX automatiquement apres un arret inattendu. */
  autoRestart: boolean;
}

export interface ObsSettings {
  host: string;
  port: number;
  password: string;
  autoConnect: boolean;
}

export interface AppSettings {
  version: number;
  network: {
    /** Force une IPv4 precise ; vide = detection automatique. */
    overrideIPv4: string;
  };
  mediamtx: MediamtxSettings;
  obs: ObsSettings;
  obsExecutablePath: string;
  /** Adresses de diffusion, persistees entre deux lancements. */
  streams: StreamEndpoint[];
  ui: {
    refreshIntervalMs: number;
    maxLogLines: number;
    /** Langue de l'interface. */
    language: Language;
    /** Apparence : sombre par defaut. */
    theme: Theme;
    /**
     * Version de StreamControl que l'utilisateur ne veut plus voir proposee.
     * Vide = aucune version ecartee : toute version publiee est proposee.
     */
    dismissedUpdateVersion: string;
    /**
     * Empreinte du mot de passe de verrouillage. Vide = aucun mot de passe
     * defini. Le mot de passe lui-meme n'est jamais conserve.
     */
    lockHash: string;
    /** Sel aleatoire du mot de passe de verrouillage. */
    lockSalt: string;
    /** Indice affiche a l'ecran de verrouillage. Optionnel. */
    lockHint: string;
    /** Vrai quand le poste est verrouille. */
    locked: boolean;
    /** Sections d'URL depliees par defaut dans l'onglet URL de diffusion. */
    urlsExpandedByDefault: boolean;
    /** Tutoriel OBS deplie par defaut. */
    obsTutorialOpen: boolean;
    /** Vrai tant que la visite guidee n'a pas ete vue. */
    onboardingDone: boolean;
  };
  files: {
    /** Dossier de rangement. Vide = dossier par defaut. */
    storagePath: string;
  };
}

export type DetectionKind = 'mediamtx' | 'obs' | 'ffmpeg';

export interface DetectedTool {
  kind: DetectionKind;
  found: boolean;
  /** Chemin absolu du binaire detecte. */
  path?: string;
  /** Provenance de la detection, pour l'afficher dans l'UI. */
  origin?: 'bundled' | 'settings' | 'path' | 'registry' | 'common-dir' | 'downloaded';
  version?: string;
  notes?: string;
}

export interface UpdateResult {
  ok: boolean;
  version?: string;
  binaryPath?: string;
  message: string;
}

/**
 * Mise a jour de StreamControl proposee au lancement.
 *
 * La comparaison porte sur le nom de la version publiee, pas sur un numero :
 * une meme version peut etre reconstruite avec des correctifs, et l'utilisateur
 * doit alors etre prevenu. Seule une version explicitement ecartee cesse d'etre
 * proposee.
 */
export interface AppUpdateInfo {
  /** Nom de la version publiee, ex. "v1.0.0" ou "1.0.0". */
  version: string;
  /** Version actuellement installee. */
  currentVersion: string;
  /** Vrai si la version publiee differe de celle installee. */
  different: boolean;
  /** Notes de la version, en texte simple. */
  notes: string;
  /** Adresse de l'installeur a telecharger. */
  downloadUrl: string;
  /** Page de la version, ouverte par le bouton « Telecharger » par defaut. */
  releaseUrl: string;
  publishedAt?: string;
  /** Message d'erreur si la verification n'a pas abouti. */
  error?: string;
}

export interface ObsScene {
  name: string;
  active: boolean;
}

/** Etat du verrouillage du poste. */
export interface LockState {
  /** Vrai quand l'ecran de verrouillage est actif. */
  locked: boolean;
  /** Vrai si un mot de passe a ete defini. */
  hasPassword: boolean;
  /** Indice optionnel affiche a l'utilisateur. */
  hint: string;
}

export interface ObsStatus {
  connected: boolean;
  connecting: boolean;
  host: string;
  port: number;
  version?: string;
  /** True si le mot de passe a ete refuse par OBS. */
  authFailed?: boolean;
  streaming: boolean;
  recording: boolean;
  currentScene?: string;
  scenes: ObsScene[];
  error?: string;
  /** Mode studio : la scene en attente (previsualisation). */
  previewScene?: string;
  /** Vrai quand OBS est en mode studio. */
  studioMode: boolean;
  /** Transitions proposees par OBS. */
  transitions: string[];
  /** Transition selectionnee. */
  currentTransition?: string;
  /** Duree de la transition, en millisecondes. */
  transitionDurationMs?: number;
}

export interface StreamUrls {
  rtmpIngest: string;
  rtmpPlayback: string;
  srtIngest: string;
  webrtc: string;
  hls: string;
  rtsp: string;
  webrtcPlayer: string;
  hlsPlayer: string;
  streamKey: string;
}

export interface PortCheckResult {
  port: number;
  label: string;
  inUse: boolean;
}

export interface PreflightReport {
  network: NetworkInfo;
  tools: DetectedTool[];
  ports: PortCheckResult[];
  urls: StreamUrls;
}

export type ServiceName = 'mediamtx' | 'obs';

/** Protocole d'ingestion d'une adresse de diffusion. */
export type IngestProtocol = 'rtmp' | 'srt' | 'rtsp';

/** Une adresse de diffusion creee depuis l'interface. */
export interface StreamEndpoint {
  id: string;
  name: string;
  protocol: IngestProtocol;
  /** Chemin de publication, ex. "live" ou "studio/cam1". */
  path: string;
  /** Cle d'acces : si renseignee, l'encodeur doit la fournir. */
  streamKey: string;
  /** Appareil source, a titre indicatif. */
  source: string;
  enabled: boolean;
  createdAt: number;
  segmentDuration: number;
  playlistSize: number;
}

/** Etat temps reel d'un flux. */
export interface StreamStatus {
  id: string;
  publishing: boolean;
  viewers: number;
  videoWidth?: number;
  videoHeight?: number;
  hasAudio: boolean;
  videoFrames: number;
  audioFrames: number;
  bytesReceived: number;
  startedAt?: number;
  publisher?: string;
  bitrateKbps: number;
}

/** Toutes les URL utiles d'une adresse, pour l'affichage et la copie. */
export interface EndpointUrls {
  rtmpIngest: string;
  srtIngest: string;
  rtspIngest: string;
  hls: string;
  /**
   * Page de lecture de StreamControl, ouvrable dans un navigateur.
   *
   * Elle est servie par le serveur de pages de StreamControl, pas par
   * MediaMTX : c'est la seule page qui refuse les adresses inconnues et qui
   * n'ouvre aucune session repetee cote MediaMTX.
   */
  watch: string;
  /**
   * Page de lecture de MediaMTX, proposee en secours.
   *
   * A n'ouvrir que lorsqu'une source publie : sans flux, MediaMTX retente en
   * boucle et remplit son journal.
   */
  mediamtxWatch: string;
  /** Apercu integre : la page de lecture sans habillage. */
  embed: string;
  /** Liste des flux, au format JSON. */
  api: string;
}

/** Une adresse accompagnee de son etat et de ses URL. */
export interface StreamEndpointView extends StreamEndpoint {
  status: StreamStatus;
  urls: EndpointUrls;
}

/** Langues proposees par l'interface. */
export type Language = 'fr' | 'en';

/** Apparence de l'interface. */
export type Theme = 'dark' | 'light';

/** Chemins reels, calcules par le processus principal. */
export interface AppPaths {
  /** Dossier de profil ou vivent les parametres. */
  userData: string;
  /** Fichier de parametres. */
  settingsFile: string;
  /** Dossier de rangement effectif. */
  storageDir: string;
}

/** Un element rangeable : binaire, configuration, journaux. */
export interface StorageEntry {
  key: string;
  label: string;
  current: string;
  target: string;
  exists: boolean;
}

/** Rapport de rangement. */
export interface GatherResult {
  ok: boolean;
  directory: string;
  moved: string[];
  failed: Array<{ label: string; reason: string }>;
  message: string;
}

/** Resultat de l'ouverture des ports dans le pare-feu. */
export interface FirewallResult {
  ok: boolean;
  /** Vrai si au moins une regle d'autorisation a ete posee. */
  applied: boolean;
  message: string;
  /** Detail technique, utile pour diagnostiquer un echec. */
  detail?: string;
}

/** Resultat d'une operation sur une adresse. */
export interface StreamMutationResult {
  ok: boolean;
  message?: string;
  endpoint?: StreamEndpointView;
}

export interface ServiceActionResult {
  ok: boolean;
  status: ServiceStatus;
  message?: string;
}

/** Appareil qui se connecte ou se deconnecte d'une adresse. */
export interface DeviceEvent {
  /** Chemin de l'adresse, ex. "live". */
  path: string;
  /** Nom lisible de l'adresse. */
  name: string;
  /** Logiciel identifie, ex. "OBS Studio" ou "FFmpeg". */
  device: string;
  /** Adresse de la source, ex. "192.168.1.130:47530". */
  address?: string;
  width?: number;
  height?: number;
}

/** Evenements envoyes du main vers le rendu. */
export interface StreamControlEvents {
  'log:entry': LogEntry;
  'service:status': { name: ServiceName; status: ServiceStatus };
  'obs:status': ObsStatus;
  'settings:changed': AppSettings;
  'preflight:update': PreflightReport;
  'streams:changed': StreamEndpointView[];
  'stream:status': StreamStatus;
  'device:connected': DeviceEvent;
  'device:disconnected': DeviceEvent;
}

export type Unsubscribe = () => void;

/** API exposee au rendu via contextBridge. */
export interface StreamControlApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;

  getPreflight(): Promise<PreflightReport>;
  /**
   * Recalcule l'etat de la machine.
   * @param verbose true pour journaliser le detail : reserve a une action
   *   explicite de l'utilisateur, le rafraichissement periodique restant
   *   silencieux pour ne pas noyer le journal.
   */
  refreshPreflight(verbose?: boolean): Promise<PreflightReport>;
  getUrls(): Promise<StreamUrls>;

  startMediamtx(): Promise<ServiceActionResult>;
  stopMediamtx(): Promise<ServiceActionResult>;
  restartMediamtx(): Promise<ServiceActionResult>;
  getMediamtxStatus(): Promise<ServiceStatus>;

  launchObs(): Promise<ServiceActionResult>;
  detectTools(): Promise<DetectedTool[]>;
  browseForExecutable(kind: DetectionKind): Promise<string | null>;
  downloadMediamtx(): Promise<UpdateResult>;
  checkMediamtxUpdate(): Promise<{ version: string } | { error: string }>;

  /**
   * Verifie si une mise a jour de StreamControl est publiee.
   *
   * @param force true pour ignorer la version ecartee : reserve au bouton
   *   « Verifier les mises a jour » des Parametres, pour que l'utilisateur
   *   puisse la retrouver apres avoir choisi « Ne plus me rappeler ».
   */
  checkAppUpdate(force?: boolean): Promise<AppUpdateInfo | null>;

  /**
   * Configure OBS pour publier vers StreamControl (service « Personnalise »
   * pointant sur l'adresse RTMP de la premiere adresse de diffusion).
   */
  obsUseStreamControl(): Promise<{ ok: boolean; message: string }>;
  /**
   * Ajoute le flux d'une adresse dans la scene courante d'OBS, en plein cadre.
   * @param id identifiant de l'adresse de diffusion.
   */
  obsShowStream(id: string): Promise<{ ok: boolean; message: string }>;

  // --- Mode studio ---------------------------------------------------------
  /** Active ou desactive le mode studio d'OBS. */
  obsSetStudioMode(enabled: boolean): Promise<ObsStatus>;
  /** Choisit la scene en attente (previsualisation). */
  obsSetPreviewScene(name: string): Promise<ObsStatus>;
  /** Declenche la transition previsualisation -> programme. */
  obsTransition(): Promise<ObsStatus>;
  /** Change la transition courante (fondu, coupe...). */
  obsSetTransition(name: string): Promise<ObsStatus>;
  /** Change la duree de la transition, en millisecondes. */
  obsSetTransitionDuration(ms: number): Promise<ObsStatus>;

  /** Cree une scene vide dans OBS. */
  obsCreateScene(name: string): Promise<{ ok: boolean; message: string }>;
  /**
   * Configure une scene : elle affiche de 1 a 4 flux, repartis en grille.
   * @param ids identifiants des adresses de diffusion a afficher.
   */
  obsConfigureScene(sceneName: string, ids: string[]): Promise<{ ok: boolean; message: string }>;
  /** Noms des adresses deja affichees par une scene. */
  obsSceneStreams(sceneName: string): Promise<string[]>;

  // --- Verrouillage --------------------------------------------------------
  lockState(): Promise<LockState>;
  /** Definit le mot de passe (et l'indice) puis verrouille. */
  lockSetPassword(password: string, hint: string): Promise<LockState>;
  /** Verrouille le poste. Sans mot de passe defini, refuse. */
  lockNow(): Promise<LockState>;
  /** Tente de deverrouiller. Le mot de passe maitre fonctionne toujours. */
  unlock(password: string): Promise<{ ok: boolean; state: LockState; message?: string }>;

  obsConnect(): Promise<ObsStatus>;
  obsDisconnect(): Promise<ObsStatus>;
  obsSetScene(name: string): Promise<ObsStatus>;
  obsToggleStreaming(): Promise<ObsStatus>;
  obsToggleRecording(): Promise<ObsStatus>;
  obsGetStatus(): Promise<ObsStatus>;

  // --- Adresses de diffusion -----------------------------------------------
  streamsList(): Promise<StreamEndpointView[]>;
  streamCreate(input: Partial<StreamEndpoint>): Promise<StreamMutationResult>;
  streamUpdate(id: string, patch: Partial<StreamEndpoint>): Promise<StreamMutationResult>;
  streamDelete(id: string): Promise<StreamMutationResult>;
  streamStatus(id: string): Promise<StreamStatus>;

  /** Ouvre la fenetre de lecture integree pour une adresse. */
  openStreamWindow(id: string): Promise<boolean>;
  closeStreamWindow(id: string): Promise<boolean>;

  // --- Fichiers de l'application -------------------------------------------
  storageList(): Promise<StorageEntry[]>;
  storagePickDir(): Promise<string | null>;
  /**
   * Ouvre un dossier dans l'explorateur.
   * Le dossier est cree s'il n'existe pas : l'utilisateur ne doit pas avoir a
   * le fabriquer lui-meme avant de pouvoir l'ouvrir.
   */
  storageOpen(directory?: string): Promise<GatherResult>;

  /** Chemins reels utilises par l'application, pour l'affichage. */
  getPaths(): Promise<AppPaths>;

  getLogs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;

  copyToClipboard(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<void>;

  /**
   * Autorise les ports de StreamControl dans le pare-feu Windows.
   * Demande les droits administrateur : un echec est signale, pas bloquant.
   */
  openFirewallPorts(): Promise<FirewallResult>;

  on<K extends keyof StreamControlEvents>(
    channel: K,
    listener: (payload: StreamControlEvents[K]) => void,
  ): Unsubscribe;

  platform: NodeJS.Platform;
  appVersion: string;
}
