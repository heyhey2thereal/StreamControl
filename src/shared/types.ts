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
  /** Enregistrement des flux, pilote par MediaMTX (independant d'OBS). */
  recording: {
    /** Dossier des enregistrements. Vide = dossier par defaut. */
    path: string;
    /** Format des segments : fmp4 (recommande) ou mpegts. */
    format: 'fmp4' | 'mpegts';
    /** Duree d'un segment, en minutes. */
    segmentMinutes: number;
    /** Duree de conservation, en heures (0 = conservation illimitee). */
    retainHours: number;
  };
  /** StreamControl Remote : panneau de controle sur le reseau local. */
  remote: {
    /** Vrai pour servir la page /remote et accepter les connexions. */
    enabled: boolean;
    /** Vrai pour exiger une validation sur le poste a chaque nouvel appareil. */
    requireApproval: boolean;
    /**
     * Empreinte du mot de passe d'acces au panneau distant. Vide = aucun mot
     * de passe : l'appairage sur le poste suffit alors. Le mot de passe
     * lui-meme n'est jamais conserve.
     */
    passwordHash: string;
    /** Sel du mot de passe du panneau distant. */
    passwordSalt: string;
    /** Appareils deja autorises. */
    devices: RemoteDevice[];
  };
  /** Replay instantane : tampon des dernieres secondes. */
  replay: {
    /** Vrai pour conserver en continu les dernieres secondes de chaque flux. */
    enabled: boolean;
    /** Duree du tampon, en secondes (les dernieres N secondes sont gardees). */
    bufferSeconds: number;
    /** Dossier du tampon. Vide = sous-dossier du rangement. */
    path: string;
  };
  /** Surveillance automatique des flux : regles et alertes. */
  watch: {
    enabled: boolean;
    /** Seuil de debit sous lequel un flux est signale, en kbit/s (0 = ignore). */
    lowBitrateKbps: number;
    /** Duree sous le seuil avant alerte, en secondes. */
    lowBitrateSeconds: number;
    /** Vrai pour proposer une bascule vers une source de secours dans OBS. */
    failoverToBackup: boolean;
    /** Adresse de secours (nom de scene OBS ou chemin de flux). */
    backupScene: string;
  };
  /** Macros et sequences : suites d'actions reutilisables. */
  macros: Macro[];
  /** Conducteur de spectacle : etapes horodatees d'un evenement. */
  showRunner: ShowStep[];
}

/** Un appareil autorise a piloter StreamControl a distance. */
export interface RemoteDevice {
  /** Jeton opaque, genere a l'appairage. */
  token: string;
  /** Nom lisible, ex. « iPhone de Alex ». */
  name: string;
  /** Adresse reseau au moment de l'appairage. */
  address?: string;
  addedAt: number;
  lastSeenAt?: number;
}

export type DetectionKind = 'mediamtx' | 'obs' | 'ffmpeg';

/**
 * Nature d'une action de macro.
 *
 * Les actions sont regroupees par domaine, pour que l'editeur visuel puisse
 * les presenter en blocs coherents.
 */
export type MacroActionKind =
  // --- OBS : scenes et transitions ---
  | 'scene'
  | 'preview-scene'
  | 'transition'
  | 'set-transition'
  | 'transition-duration'
  | 'studio-mode'
  | 'create-scene'
  | 'delete-scene'
  | 'rename-scene'
  // --- OBS : diffusion et enregistrement ---
  | 'start-stream'
  | 'stop-stream'
  | 'toggle-stream'
  | 'start-record'
  | 'stop-record'
  | 'toggle-record'
  | 'pause-record'
  | 'resume-record'
  | 'split-record'
  // --- OBS : sources ---
  | 'show-source'
  | 'hide-source'
  | 'toggle-source'
  // --- OBS : audio ---
  | 'mute-source'
  | 'unmute-source'
  | 'set-volume'
  // --- Flux (MediaMTX) ---
  | 'record-stream'
  | 'replay'
  | 'replay-all'
  | 'create-stream'
  | 'delete-stream'
  | 'enable-stream'
  | 'disable-stream'
  // --- Poste ---
  | 'lock'
  | 'restart-mediamtx'
  | 'start-mediamtx'
  | 'stop-mediamtx'
  | 'open-folder'
  | 'open-url'
  // --- Controle du deroulement ---
  | 'wait'
  | 'wait-until'
  | 'condition'
  | 'repeat'
  | 'log'
  | 'notify'
  | 'popup'
  | 'sound'
  | 'stop-macro'
  | 'http-request';

/** Categorie d'une action, pour le regroupement dans l'editeur. */
export type MacroActionGroup = 'obs' | 'flux' | 'poste' | 'controle' | 'alerte';

/** Une action d'une macro, avec ses parametres. */
export interface MacroAction {
  kind: MacroActionKind;
  /** Scene OBS visee (pour `scene`, `preview-scene`, `set-transition`...). */
  scene?: string;
  /** Duree d'attente en secondes (pour `wait`). */
  seconds?: number;
  /**
   * Temps d'attente, en secondes, AVANT de passer a l'action suivante.
   *
   * C'est le reglage qui permet d'espacer les evenements d'une macro : chaque
   * action peut laisser passer un delai. 0 ou absent = enchainement immediat.
   */
  delaySeconds?: number;
  /** Flux vise (pour `record-stream`, `replay`, `delete-stream`). */
  streamId?: string;
  /** Vrai pour activer, faux pour arreter (pour `record-stream`, `studio-mode`). */
  enabled?: boolean;
  /** Nom libre : nom de scene a creer, nom d'adresse, texte de notification. */
  text?: string;
  /** Chemin d'adresse, pour `create-stream`. */
  path?: string;
  /**
   * Mot de passe du poste, pour `lock`.
   *
   * Le verrouillage d'une macro peut exiger le mot de passe : c'est ce qui
   * evite qu'une macro lancee par erreur enferme l'operateur dehors.
   */
  password?: string;
  /** Nombre de repetitions, pour `repeat`. */
  repeat?: number;
  /** Sous-actions, pour `repeat` et `condition`. */
  actions?: MacroAction[];
  /** Condition a tester, pour `condition` et `wait-until`. */
  condition?: MacroCondition;
  /**
   * Nom de la source OBS visee (pour les actions de source et d'audio).
   * C'est le nom affiche dans OBS, ex. « Camera 1 ».
   */
  source?: string;
  /** Volume de 0 a 100, pour `set-volume`. */
  volume?: number;
  /** Niveau du message, pour `log`. */
  level?: MacroLogLevel;
  /** Adresse a ouvrir, pour `open-url` ou `http-request`. */
  url?: string;
  /** Duree maximale d'attente, en secondes, pour `wait-until`. */
  timeoutSeconds?: number;
  /**
   * Fichier de son a jouer, pour `sound`. Un chemin vide joue le son systeme
   * par defaut.
   */
  soundPath?: string;
  /** Volume du son, de 0 a 100, pour `sound`. Absent = 100. */
  soundVolume?: number;
  /**
   * Vrai pour afficher la notification de macro dans l'interface.
   *
   * Coche, le message apparait comme une bulle en bas a gauche de la fenetre ;
   * decoche, il ne va que dans le journal. Absent = vrai.
   */
  notifyToast?: boolean;
  /** Texte du bouton de la pop-up, pour `popup`. */
  confirmLabel?: string;
  /** Vrai pour exiger une confirmation avant de continuer (`popup`). */
  requireConfirmation?: boolean;

  // --- Bloc « condition » (comparaison) ----------------------------------
  /**
   * Operande de gauche : un texte libre, ou une variable (`{flux_debit}`).
   *
   * Renseigne, il remplace l'ancien test predefini (`condition`) : on compare
   * alors deux valeurs au lieu de verifier un etat connu.
   */
  conditionLeft?: string;
  /** Comparaison appliquee entre les deux operandes. Absent = `equal`. */
  conditionOperator?: MacroCompareOperator;
  /** Operande de droite : un texte libre, ou une variable. */
  conditionRight?: string;
  /**
   * Ce qui se passe quand le test est faux.
   *
   * `skip` : on saute le bloc et la macro continue (comportement par defaut).
   * `stop` : la macro s'arrete la.
   */
  conditionOnFalse?: 'skip' | 'stop';
  /**
   * Vrai pour continuer la macro apres le bloc, quel que soit le resultat.
   *
   * Faux : le bloc est un terminus — une fois ses sous-actions terminees, la
   * macro s'arrete, meme si le test etait vrai. C'est ce qu'on veut pour un
   * « si ... alors ... fin » place au milieu d'une sequence.
   */
  conditionContinue?: boolean;
}

/**
 * Comparaisons proposees par le bloc « condition ».
 *
 * Les comparaisons de nombre (`less-than`, `more-than`) convertissent les deux
 * operandes : « 900 » est plus petit que « 1200 », ce qu'une comparaison de
 * texte ne dirait pas.
 */
export type MacroCompareOperator =
  | 'equal'
  | 'not-equal'
  | 'contains'
  | 'not-contains'
  | 'starts-with'
  | 'ends-with'
  | 'less-than'
  | 'more-than'
  | 'is-empty'
  | 'is-not-empty';

/** Etats predefinis testables par le bloc « condition ». */
export type MacroCondition =
  | 'obs-connected'
  | 'stream-live'
  | 'mediamtx-running'
  | 'recording'
  | 'streaming'
  | 'macro-running';

/** Niveau d'un message de journal. */
export type MacroLogLevel = 'info' | 'warn' | 'error';

// --- Variables de macro ----------------------------------------------------

/** Un flux, vu par le moteur de variables. */
export interface MacroVariableStream {
  id: string;
  name: string;
  path: string;
  live: boolean;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  bitrateKbps?: number;
  viewers?: number;
  startedAt?: number;
  publisher?: string;
  recording?: boolean;
  recordingPath?: string;
  urls?: EndpointUrls;
}

/** OBS, vu par le moteur de variables. */
export interface MacroVariableObs {
  connected: boolean;
  version?: string;
  host?: string;
  port?: number;
  currentScene?: string;
  previewScene?: string;
  studioMode?: boolean;
  currentTransition?: string;
  transitionDurationMs?: number;
  streaming?: boolean;
  recording?: boolean;
  scenes?: string[];
  sources?: string[];
}

/** MediaMTX, vu par le moteur de variables. */
export interface MacroVariableMediamtx {
  state?: string;
  running?: boolean;
  rtmpPort?: number;
  hlsPort?: number;
  webrtcPort?: number;
  rtspPort?: number;
  apiPort?: number;
  webPagesPort?: number;
  streamPath?: string;
}

/** Le poste, vu par le moteur de variables. */
export interface MacroVariablePoste {
  hostname?: string;
  ip?: string;
  ipLocal?: string;
  system?: string;
  platform?: string;
  user?: string;
  locked?: boolean;
  userDataDir?: string;
  storageDir?: string;
  recordingsDir?: string;
  replayDir?: string;
}

/** L'application, vue par le moteur de variables. */
export interface MacroVariableApp {
  name?: string;
  version?: string;
  language?: string;
  theme?: string;
}

/** La macro en cours d'execution. */
export interface MacroVariableMacro {
  name?: string;
  id?: string;
  actionCount?: number;
  index?: number;
  origin?: string;
}

/** Le declencheur qui a lance la macro. */
export interface MacroVariableTrigger {
  kind?: string;
  label?: string;
  path?: string;
  alertKind?: string;
  alertLabel?: string;
}

/**
 * Contexte complet d'une execution de macro.
 *
 * Tous les champs sont facultatifs : une variable sans donnee devient une
 * chaine vide plutot que d'empecher la macro de tourner.
 */
export interface MacroVariableContext {
  flux?: MacroVariableStream;
  streams?: MacroVariableStream[];
  obs?: MacroVariableObs;
  mediamtx?: MacroVariableMediamtx;
  poste?: MacroVariablePoste;
  app?: MacroVariableApp;
  macro?: MacroVariableMacro;
  trigger?: MacroVariableTrigger;
  /** Instant de l'execution ; par defaut, maintenant. */
  now?: Date;
}

/** Un modele de macro pret a l'emploi, propose dans l'onglet Automatisation. */
export interface MacroTemplate {
  id: string;
  /** Cle i18n du nom du modele. */
  label: string;
  /** Cle i18n de la description : ce que le modele fait, en une phrase. */
  description: string;
  /** Cle i18n du niveau : « debutant », « intermediaire », « avance ». */
  level: string;
  /** Icone de la palette d'icones. */
  icon: string;
  /** Construit les actions du modele, avec des identifiants de flux reels. */
  build: (context: MacroTemplateContext) => MacroAction[];
  /** Declencheurs proposes avec le modele. */
  triggers?: MacroTrigger[];
}

/** Ce dont un modele a besoin pour se construire. */
export interface MacroTemplateContext {
  /** Adresses de diffusion disponibles. */
  streams: Array<{ id: string; name: string; path: string }>;
  /** Scenes OBS disponibles. */
  scenes: string[];
}


/** Declencheur d'une macro : ce qui la lance sans intervention. */
export type MacroTriggerKind =
  | 'manual'
  | 'stream-connect'
  | 'stream-disconnect'
  | 'alert'
  | 'schedule'
  | 'startup';

/** Un declencheur, avec ses parametres. */
export interface MacroTrigger {
  kind: MacroTriggerKind;
  /** Chemin du flux concerne (pour `stream-connect` / `stream-disconnect`). */
  path?: string;
  /** Nature d'alerte (pour `alert`), ex. « offline » ou « low-bitrate ». */
  alertKind?: string;
  /** Heure quotidienne « HH:MM » (pour `schedule`). */
  at?: string;
}

/** Une entree du journal d'execution des macros. */
export interface MacroRunEntry {
  id: string;
  macroName: string;
  macroId: string;
  at: number;
  durationMs: number;
  executed: number;
  total: number;
  ok: boolean;
  message?: string;
  origin: 'manual' | 'trigger' | 'remote' | 'step';
}

/** Une macro : une suite d'actions rejouable en un clic. */
export interface Macro {
  id: string;
  name: string;
  actions: MacroAction[];
  /**
   * Declencheurs de la macro. Vide ou `manual` = uniquement a la main.
   *
   * Une macro peut cumuler plusieurs declencheurs : a la connexion d'un flux,
   * sur une alerte, ou a une heure fixe.
   */
  triggers: MacroTrigger[];
  /** Vrai quand la macro est desactivee (elle ne se declenche plus). */
  disabled?: boolean;
  createdAt: number;
}

/** Une etape du conducteur de spectacle. */
export interface ShowStep {
  id: string;
  /** Nom court, ex. « Lancement du generique ». */
  name: string;
  /** Heure prevue, au format « HH:MM » ; vide = pas d'horaire. */
  at: string;
  /** Notes libres pour l'operateur. */
  notes: string;
  /** Vrai quand l'etape est passee. */
  done: boolean;
  /** Actions executees au passage a cette etape. */
  actions: MacroAction[];
}

/** Etat du replay pour un flux. */
export interface ReplayState {
  /** Vrai si le tampon tourne pour ce flux. */
  active: boolean;
  /** Duree reellement disponible dans le tampon, en secondes. */
  availableSeconds: number;
}

/** Alerte de surveillance d'un flux. */
export interface WatchAlert {
  id: string;
  /** Chemin du flux concerne. */
  path: string;
  /** Nom lisible du flux. */
  name: string;
  kind: 'offline' | 'online' | 'low-bitrate' | 'recovered';
  message: string;
  at: number;
  /** Vrai quand l'operateur a acquitte l'alerte. */
  acknowledged: boolean;
}

/** Mesures techniques d'un flux, pour l'analyse. */
export interface StreamDiagnostics {
  id: string;
  name: string;
  path: string;
  publishing: boolean;
  /** Resolution annoncee par MediaMTX. */
  width?: number;
  height?: number;
  /** Images par seconde mesurees sur la fenetre d'observation. */
  measuredFps: number;
  /** Debit moyen, en kbit/s. */
  bitrateKbps: number;
  /** Debit minimal observe, en kbit/s. */
  minBitrateKbps: number;
  /** Debit maximal observe, en kbit/s. */
  maxBitrateKbps: number;
  /** Ecart-type du debit : eleve = flux instable. */
  bitrateJitter: number;
  /** Vrai si le flux semble stable (peu de variation). */
  stable: boolean;
  /** Nombre d'interruptions observees depuis le demarrage. */
  outages: number;
  /** Duree de la session en cours, en secondes. */
  sessionSeconds: number;
  /** Taille du tampon de replay disponible, en secondes. */
  replaySeconds: number;
}


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
  /** Noms des sources connues, pour les macros et l'editeur. */
  sources?: string[];
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
  /** Vrai pour enregistrer ce flux (independant des autres). */
  record: boolean;
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
  /** Vrai quand ce flux est en cours d'enregistrement. */
  recording: boolean;
  /** Dossier ou les fichiers de ce flux sont ecrits, si l'enregistrement est actif. */
  recordingPath?: string;
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
  'remote:pair-request': { id: string; name: string; address: string; at: number };
  'macro:notice': string;
  /**
   * Son a jouer, demande par une macro.
   *
   * Le champ porte une URL de donnees (ou une chaine vide pour le bip systeme)
   * et le libelle de l'action, pour que l'interface signale ce qui se joue.
   * `volume` va de 0 a 100 ; absent, le son est joue a plein volume.
   */
  'macro:play-sound': { dataUrl: string; label: string; volume?: number };
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
  /** Active ou desactive l'enregistrement de ce flux, sans toucher aux autres. */
  streamSetRecording(id: string, record: boolean): Promise<StreamMutationResult>;

  // --- Enregistrement des flux ---------------------------------------------
  /** Verifie que le dossier d'enregistrement est accessible en ecriture. */
  recordingProbe(): Promise<{ ok: boolean; directory: string; message: string }>;
  /** Ouvre le dossier des enregistrements (cree au besoin). */
  recordingOpen(): Promise<GatherResult>;
  /** Choisit un dossier d'enregistrement. */
  recordingPickDir(): Promise<string | null>;

  // --- StreamControl Remote -------------------------------------------------
  /** Demandes d'appairage en attente, pour la pop-up du poste. */
  remotePending(): Promise<Array<{ id: string; name: string; address: string; at: number }>>;
  /** Accepte ou refuse une demande d'appairage. */
  remoteApprove(id: string, accept: boolean): Promise<{ ok: boolean }>;
  /** Retire un appareil autorise. */
  remoteForget(token: string): Promise<{ ok: boolean }>;
  /** Definit (ou retire, si vide) le mot de passe du panneau distant. */
  remoteSetPassword(
    password: string,
  ): Promise<{ ok: boolean; hasPassword: boolean; message?: string }>;

  // --- Automatisation : macros ---------------------------------------------
  macrosList(): Promise<Macro[]>;
  macroCreate(name: string): Promise<Macro>;
  macroUpdate(id: string, patch: Partial<Macro>): Promise<Macro | null>;
  macroDelete(id: string): Promise<{ ok: boolean }>;
  macroRun(id: string): Promise<{ ok: boolean; executed: number; message?: string }>;
  macroStop(id: string): Promise<{ ok: boolean }>;
  macrosRunning(): Promise<{ running: string[] }>;
  /** Duplique une macro (nouveau nom, nouveaux identifiants). */
  macroDuplicate(id: string): Promise<Macro | null>;
  /** Journal d'execution, les plus recentes en tete. */
  macroHistory(): Promise<MacroRunEntry[]>;
  /** Vide le journal d'execution. */
  macroHistoryClear(): Promise<{ ok: boolean }>;
  /** Exporte les macros en JSON, pour les partager. */
  macroExport(): Promise<string>;
  /** Importe des macros depuis un JSON exporte. */
  macroImport(raw: string): Promise<{ imported: number; message?: string }>;
  /**
   * Cree une macro a partir d'un modele.
   *
   * Le modele est construit avec les adresses et les scenes reellement
   * presentes sur le poste : le resultat est utilisable tel quel.
   */
  macroFromTemplate(id: string, name: string): Promise<Macro | null>;

  /**
   * Ouvre une boite de dialogue pour choisir un fichier ou un dossier.
   *
   * Les blocs de macro qui demandent un chemin (son, dossier) proposent un
   * bouton « Parcourir » : l'utilisateur choisit directement au lieu de devoir
   * recopier un chemin a la main.
   *
   * @param kind 'file' pour un fichier, 'folder' pour un dossier.
   * @returns le chemin absolu choisi, ou null si l'utilisateur annule.
   */
  macroPickPath(kind: 'file' | 'folder'): Promise<string | null>;
  /**
   * Lit un fichier de son et le renvoie en URL de donnees.
   *
   * Le rendu ne peut pas lire un fichier du disque directement : l'isolation
   * du contexte et la politique de securite l'en empechent. Le processus
   * principal lit donc le fichier et le transmet sous forme de `data:` URL, que
   * le rendu joue avec un simple element audio.
   *
   * @returns une URL de donnees, ou null si le fichier est illisible ou trop
   *   volumineux (un effet sonore reste petit).
   */
  macroReadSound(filePath: string): Promise<string | null>;

  // --- Conducteur de spectacle ---------------------------------------------
  showList(): Promise<ShowStep[]>;
  showAdd(name: string, at: string, notes: string): Promise<ShowStep>;
  showUpdate(id: string, patch: Partial<ShowStep>): Promise<{ ok: boolean }>;
  showDelete(id: string): Promise<{ ok: boolean }>;
  showReset(): Promise<{ ok: boolean }>;
  showNext(): Promise<{ ok: boolean; step?: ShowStep; message?: string }>;

  // --- Surveillance et analyse ---------------------------------------------
  watchAlerts(): Promise<WatchAlert[]>;
  watchAcknowledge(): Promise<{ ok: boolean }>;
  watchReset(): Promise<{ ok: boolean }>;
  diagnosticsList(): Promise<StreamDiagnostics[]>;

  // --- Replay instantane ---------------------------------------------------
  replaySave(id: string): Promise<string | null>;
  replayAvailable(id: string): Promise<{ seconds: number }>;
  replayOpenFolder(): Promise<GatherResult>;

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
