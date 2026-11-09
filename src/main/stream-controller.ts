/**
 * Passerelle entre l'interface, le registre des adresses et MediaMTX.
 *
 * Elle centralise tout ce que le rendu ne doit pas connaitre : ports, chemins,
 * construction des URL, persistance des adresses, interrogation de l'etat reel
 * et ouverture de la fenetre de lecture.
 *
 * MediaMTX est le seul serveur de flux. Quand il ne tourne pas, aucune adresse
 * n'est joignable : les URL sont alors signalees comme indisponibles plutot que
 * d'etre affichees comme si elles fonctionnaient.
 */
import { BrowserWindow, session } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type {
  EndpointUrls,
  IngestProtocol,
  StreamEndpoint,
  StreamEndpointView,
  StreamMutationResult,
  StreamStatus,
} from '../shared/types';
import type { Logger } from './logger';
import { describePublisher, type MediamtxManager, type MediamtxPathState } from './mediamtx-manager';
import { buildPathOptions, resolveRecordingDir } from './recording';
import { replayPathOptions, saveReplay, replayState } from './replay';
import { CaptureManager } from './capture';
import type { NetworkInfo } from '../shared/types';
import type { SettingsStore } from './settings';
import { StreamRegistry, normalizePath } from './stream-registry';

export interface StreamControllerOptions {
  logger: Logger;
  settings: SettingsStore;
  registry: StreamRegistry;
  mediamtx: MediamtxManager;
  /** Retourne les IPv4 locales, pour construire les URL. */
  getNetwork: () => NetworkInfo;
  /** Port du serveur de pages, tel qu'il ecoute vraiment. */
  getWebPagesPort: () => number;
  appVersion: string;
}

/**
 * Nom de la session isolee des fenetres de lecture.
 * Elle sert a desactiver le proxy : un antivirus ou un pare-feu qui intercepte
 * le trafic local provoque ERR_NETWORK_ACCESS_DENIED sur une adresse du reseau.
 */
const VIEWER_PARTITION = 'persist:streamcontrol-viewer';

/** Fenetre de lecture integree. */
const VIEWER_WINDOW_OPTIONS = {
  width: 1100,
  height: 720,
  minWidth: 640,
  minHeight: 420,
  backgroundColor: '#06090d',
  autoHideMenuBar: true,
} as const;

/** Intervalle d'interrogation de l'API MediaMTX. */
const LIVE_POLL_INTERVAL_MS = 1500;

/**
 * Page affichee quand la fenetre de lecture ne peut pas charger le flux.
 * Elle explique la cause probable et comment la lever, plutot que de laisser
 * une page d'erreur du navigateur.
 */
function renderViewerError(name: string, url: string, detail: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Lecture impossible</title>
<style>
  body { margin:0; background:#0d0f11; color:#e9ecef; font:13px/1.6 "Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:48px 24px; }
  h1 { font-size:16px; margin:0 0 6px; }
  .sub { color:#6e767e; font-size:12px; margin-bottom:22px; }
  code { font-family:Consolas,monospace; color:#4ea8de; word-break:break-all; }
  ol { padding-left:20px; color:#a8b0b8; }
  li { margin-bottom:8px; }
  .detail { margin-top:22px; padding:10px 12px; border:1px solid #24272c; border-radius:4px;
            background:#121417; color:#6e767e; font-family:Consolas,monospace; font-size:11px; }
</style></head>
<body><div class="wrap">
  <h1>Lecture impossible</h1>
  <div class="sub">Flux « ${escapeHtml(name)} »</div>
  <p>La fenetre n'a pas pu charger <code>${escapeHtml(url)}</code>.</p>
  <ol>
    <li>Verifiez que MediaMTX est demarre : l'onglet Services indique son etat.</li>
    <li>Verifiez qu'une source publie bien sur cette adresse : l'etat doit
        afficher « En direct » dans l'onglet Flux.</li>
    <li>Si un antivirus ou un pare-feu est actif, autorisez StreamControl sur
        les reseaux prives.</li>
  </ol>
  <div class="detail">${escapeHtml(detail)}</div>
</div></body></html>`;
}

/** Echappe le texte insere dans le HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class StreamController extends EventEmitter {
  private readonly logger: Logger;
  private readonly settings: SettingsStore;
  private readonly registry: StreamRegistry;
  private readonly mediamtx: MediamtxManager;
  private readonly getNetwork: () => NetworkInfo;
  private readonly appVersion: string;
  /** Fournisseur du port de pages, ajustable apres construction. */
  private getWebPagesPort: () => number;
  /** Fenetres de lecture ouvertes, indexees par identifiant d'adresse. */
  private readonly viewerWindows = new Map<string, BrowserWindow>();
  private pollTimer: NodeJS.Timeout | null = null;
  /** Chemins inconnus deja signales, pour ne pas remplir le journal. */
  private readonly reportedUnknown = new Set<string>();
  /** Chemins actuellement publies, pour detecter les connexions. */
  private readonly connected = new Set<string>();
  /**
   * Capture des flux quand le replay occupe le reglage `record` de MediaMTX.
   * Voir capture.ts : c'est ce qui permet d'enregistrer ET de garder un tampon.
   */
  private readonly capture: CaptureManager;

  constructor(options: StreamControllerOptions) {
    super();
    this.setMaxListeners(50);
    this.logger = options.logger;
    this.settings = options.settings;
    this.registry = options.registry;
    this.mediamtx = options.mediamtx;
    this.getNetwork = options.getNetwork;
    this.appVersion = options.appVersion;
    this.getWebPagesPort = options.getWebPagesPort;
    this.capture = new CaptureManager(
      options.logger,
      () => this.settings.get().replay.path,
      () => resolveRecordingDir(this.settings.get().recording.path),
    );
    this.capture.on('changed', () => this.broadcastStreams());

    // Toute evolution du registre est repercutee dans l'interface.
    this.registry.on('changed', () => {
      this.broadcastStreams();
      this.persist();
    });
    this.registry.on('status', () => this.broadcastStreams());

    // MediaMTX change d'etat : on interroge tout de suite l'API pour que
    // l'interface n'attende pas le prochain cycle.
    this.mediamtx.on('status', () => {
      void this.refreshLiveStatus();
    });
  }

  /** Recharge les adresses sauvegardees. */
  async initialize(): Promise<void> {
    const current = this.settings.get();
    this.registry.hydrate(current.streams as StreamEndpoint[]);

    // Aucune adresse : on en cree une par defaut pour que l'application soit
    // immediatement utilisable.
    if (this.registry.list().length === 0) {
      this.registry.create({ name: 'Flux principal', path: 'live', protocol: 'rtmp', source: 'Camera' });
      this.logger.info('streams', 'Adresse par defaut "live" creee.');
    }

    this.startPolling();
  }

  /** Interroge l'API MediaMTX regulierement pour connaitre l'etat reel. */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.refreshLiveStatus(), LIVE_POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
    void this.refreshLiveStatus();
  }

  /**
   * Lit l'etat des flux dans MediaMTX et met a jour le registre.
   *
   * MediaMTX accepte la publication sur n'importe quel chemin : une camera mal
   * configuree publie donc sur une adresse qui n'existe pas dans l'interface.
   * On le signale clairement, sinon l'utilisateur voit sa camera publier et
   * aucune image apparaitre, sans comprendre pourquoi.
   */
  async refreshLiveStatus(): Promise<void> {
    const paths: MediamtxPathState[] = await this.mediamtx.fetchPaths();
    const byName = new Map(paths.map((entry) => [entry.name, entry]));

    for (const endpoint of this.registry.list()) {
      const live = byName.get(endpoint.path);
      this.registry.applyLiveState(endpoint.id, {
        online: live?.online === true,
        bytesReceived: live?.bytesReceived ?? 0,
        width: live?.width,
        height: live?.height,
        hasAudio: (live?.tracks ?? []).some((track) => /aac|audio|opus|mp3/i.test(track)),
        viewers: live?.readers ?? 0,
        publisher: live?.remoteAddr,
        // Avec le replay actif, c'est la capture qui dit si l'enregistrement
        // tourne : le reglage MediaMTX sert alors au tampon, pas a la capture.
        recording: this.settings.get().replay.enabled
          ? this.capture.isCapturing(endpoint.id)
          : live?.recording === true,
        recordingPath: live?.recordingPath,
      });
    }

    this.reportConnections(paths);
    this.reportUnknownPublishers(paths);
    this.emit('streams-refresh');
  }

  /**
   * Annonce chaque appareil qui se connecte, et son depart.
   *
   * L'utilisateur veut savoir tout de suite si sa camera a bien ete reconnue.
   * On compare l'etat precedent et l'etat courant, et on ne parle qu'au
   * changement : l'interrogation periodique ne doit pas repeter le message.
   */
  private reportConnections(paths: MediamtxPathState[]): void {
    const addresses = new Map(this.registry.list().map((entry) => [entry.path, entry]));

    for (const entry of paths) {
      const endpoint = addresses.get(entry.name);
      if (!endpoint) continue;

      const connected = entry.online;
      const wasConnected = this.connected.has(entry.name);
      if (connected === wasConnected) continue;

      if (connected) {
        this.connected.add(entry.name);
        const who = describePublisher(entry.userAgent);
        const where = entry.remoteAddr ? ` (${entry.remoteAddr.split(':')[0]})` : '';
        const dimensions =
          entry.width && entry.height ? `, image ${entry.width}x${entry.height}` : '';
        this.logger.info(
          'streams',
          `${who} est connecte sur "${endpoint.name}"${where}${dimensions}.`,
        );
        this.emit('device-connected', {
          path: endpoint.path,
          name: endpoint.name,
          device: who,
          address: entry.remoteAddr,
          width: entry.width,
          height: entry.height,
        });
      } else {
        this.connected.delete(entry.name);
        const who = describePublisher(entry.userAgent);
        this.logger.info('streams', `${who} s'est deconnecte de "${endpoint.name}".`);
        this.emit('device-disconnected', { path: endpoint.path, name: endpoint.name, device: who });
      }
    }
  }

  /**
   * Signale les sources qui publient sur une adresse inconnue.
   *
   * Le message n'est ecrit qu'une fois par chemin : sans cela, l'interrogation
   * periodique remplirait le journal.
   */
  private reportUnknownPublishers(paths: MediamtxPathState[]): void {
    const known = new Set(this.registry.list().map((endpoint) => endpoint.path));
    for (const entry of paths) {
      if (!entry.online) continue;
      if (known.has(entry.name)) {
        this.reportedUnknown.delete(entry.name);
        continue;
      }
      if (this.reportedUnknown.has(entry.name)) continue;
      this.reportedUnknown.add(entry.name);

      const addresses = [...known];
      this.logger.warn(
        'streams',
        `Une source publie sur "/${entry.name}", qui n'existe pas dans StreamControl. ` +
          `Aucune image ne peut donc s'afficher. Adresses existantes : ` +
          `${addresses.length > 0 ? addresses.join(', ') : 'aucune'}. ` +
          `Corrigez l'adresse de la source, ou creez "/${entry.name}" dans l'onglet Flux.`,
      );
    }
  }

  /** Port du serveur de pages, tel qu'il ecoute reellement. */
  private webPagesPort(): number {
    return this.getWebPagesPort();
  }

  /** Vrai si MediaMTX tourne : sans lui, aucune adresse n'est joignable. */
  get mediamtxRunning(): boolean {
    return this.mediamtx.isRunning;
  }

  /** Construit toutes les URL d'une adresse, servies par MediaMTX. */
  buildUrls(endpoint: StreamEndpoint): EndpointUrls {
    const network = this.getNetwork();
    const host = network.primaryIPv4 ?? '127.0.0.1';
    const { rtmpPort, rtspPort } = this.settings.get().mediamtx;
    // Port reellement en service : il peut differer du reglage si celui-ci
    // etait indisponible (plage reservee par le systeme).
    const webPagesPort = this.webPagesPort();
    const streamPath = endpoint.path;

    // Les URL de lecture passent par la boucle locale : c'est une page servie
    // par StreamControl sur ce poste, et Windows bloque une requete d'un poste
    // vers sa propre adresse de reseau. Une adresse du LAN ne s'y ouvre pas.
    // L'ingestion, elle, reste sur l'IPv4 du LAN : c'est la camera qui publie.
    const loopback = '127.0.0.1';

    return {
      rtmpIngest: `rtmp://${host}:${rtmpPort}/${streamPath}`,
      srtIngest: `srt://${host}:8890?streamid=publish:${streamPath}`,
      rtspIngest: `rtsp://${host}:${rtspPort}/${streamPath}`,
      // Le HLS passe par notre serveur : les ports HTTP de MediaMTX n'ecoutent
      // que sur la boucle locale, donc rien ne doit pointer directement dessus.
      hls: `http://${loopback}:${webPagesPort}/hls/${streamPath}/index.m3u8`,
      // Notre page de lecture : elle seule refuse les adresses inconnues et
      // n'ouvre aucune session repetee cote MediaMTX.
      watch: `http://${loopback}:${webPagesPort}/watch/${streamPath}`,
      // Lecture directe par le relais WebRTC de notre serveur. La barre oblique
      // finale est indispensable : la page de MediaMTX resout « whep » et
      // « reader.js » relativement a cette adresse.
      mediamtxWatch: `http://${loopback}:${webPagesPort}/webrtc/${streamPath}/`,
      // Apercu integre au tableau de bord : meme lecteur, sans habillage.
      embed: `http://${loopback}:${webPagesPort}/embed/${streamPath}`,
      api: `http://${loopback}:${webPagesPort}/api/streams`,
    };
  }

  /** Liste les adresses avec leur etat et leurs URL. */
  list(): StreamEndpointView[] {
    return this.registry.list().map((endpoint) => ({
      ...endpoint,
      status: this.registry.getStatus(endpoint.id),
      urls: this.buildUrls(endpoint),
    }));
  }

  create(input: Partial<StreamEndpoint>): StreamMutationResult {
    try {
      const endpoint = this.registry.create({
        ...input,
        protocol: (input.protocol ?? 'rtmp') as IngestProtocol,
      });
      this.logger.info('streams', `Adresse "${endpoint.name}" creee sur /${endpoint.path}.`);
      void this.syncPaths();
      return { ok: true, endpoint: this.view(endpoint.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('streams', `Creation refusee : ${message}`);
      return { ok: false, message };
    }
  }

  update(id: string, patch: Partial<StreamEndpoint>): StreamMutationResult {
    try {
      this.registry.update(id, patch);
      this.logger.info('streams', `Adresse ${id} mise a jour.`);
      void this.syncPaths();
      return { ok: true, endpoint: this.view(id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('streams', `Mise a jour refusee : ${message}`);
      return { ok: false, message };
    }
  }

  remove(id: string): StreamMutationResult {
    const endpoint = this.registry.get(id);
    if (!endpoint) return { ok: false, message: 'Adresse inconnue.' };

    this.closeViewerWindow(id);
    this.registry.remove(id);
    // Le chemin disparait de MediaMTX au prochain redemarrage : le laisser en
    // place n'empeche pas un flux fantome de publier, mais l'enregistrement
    // s'arrete de lui-meme puisqu'on ne le reconfigure plus.
    void this.syncPaths();
    this.logger.info('streams', `Adresse "${endpoint.name}" supprimee.`);
    return { ok: true };
  }

  /**
   * Declare chaque adresse dans MediaMTX, avec son reglage d'enregistrement.
   *
   * C'est ce qui rend l'enregistrement independant d'un flux a l'autre :
   * chaque chemin porte son propre `record`. MediaMTX n'a plus besoin d'un
   * chemin generique `all_others` pour publier, mais on le garde en secours
   * pour les sources qui publient sur une adresse inconnue.
   *
   * Appelee a chaque demarrage de MediaMTX et a chaque changement d'adresse.
   */
  async syncPaths(): Promise<void> {
    if (!this.mediamtx.isRunning) return;

    const settings = this.settings.get();
    for (const endpoint of this.registry.list()) {
      // MediaMTX n'a qu'UN reglage `record` par chemin. Quand le replay est
      // actif, il sert au tampon roulant : c'est alors la capture (voir
      // capture.ts) qui ecrit l'enregistrement demande, en recopiant les
      // segments du tampon. Les deux ne peuvent donc pas partager ce reglage.
      const options = settings.replay.enabled
        ? replayPathOptions(settings, endpoint.path)
        : buildPathOptions(settings, endpoint.path, endpoint.record === true);
      const ok = await this.mediamtx.configurePath(endpoint.path, options);
      if (!ok) {
        this.logger.warn('streams', `Chemin /${endpoint.path} non configure dans MediaMTX.`);
      }

      // Avec le replay actif, on demarre ou arrete la capture selon la demande.
      // L'echec est signale : une capture qui ne demarre pas doit se voir, pas
      // rester silencieuse (l'utilisateur croirait enregistrer).
      if (settings.replay.enabled) {
        try {
          const capturing = this.capture.isCapturing(endpoint.id);
          if (endpoint.record === true && !capturing) {
            await this.capture.start(endpoint.id, endpoint.path, endpoint.name);
          } else if (endpoint.record !== true && capturing) {
            await this.capture.stop(endpoint.id);
          }
        } catch (error) {
          this.logger.errorFrom('capture', error, `Capture de /${endpoint.path} impossible`);
        }
      }
    }
    this.logger.info('streams', `Chemins synchronises (${this.registry.list().length}).`);
    this.emit('streams-refresh');
  }

  /** Vrai si ce flux est actuellement enregistre par MediaMTX. */
  async isRecording(id: string): Promise<boolean> {
    const endpoint = this.registry.get(id);
    if (!endpoint) return false;
    return this.mediamtx.isRecording(endpoint.path);
  }

  /**
   * Sauvegarde les dernieres secondes d'un flux (replay instantane).
   *
   * @returns le chemin du fichier cree, ou null si le tampon est vide.
   */
  async saveReplay(id: string): Promise<string | null> {
    const endpoint = this.registry.get(id);
    if (!endpoint) return null;
    const settings = this.settings.get();
    return saveReplay(settings.replay.path, endpoint.path, endpoint.name, this.logger);
  }

  /** Duree de replay disponible pour un flux, en secondes. */
  async replayAvailable(id: string): Promise<number> {
    const endpoint = this.registry.get(id);
    if (!endpoint) return 0;
    const state = await replayState(this.settings.get().replay.path, endpoint.path);
    return state.availableSeconds;
  }

  status(id: string): StreamStatus {
    return this.registry.getStatus(id);
  }

  /**
   * Ouvre (ou ramene au premier plan) la fenetre de lecture integree.
   *
   * La page est celle de MediaMTX : c'est elle qui sait lire le flux, et elle
   * est servie par le meme processus qui le produit. Sans MediaMTX demarre,
   * il n'y a rien a lire : on le dit au lieu d'ouvrir une fenetre vide.
   */
  async openViewerWindow(id: string): Promise<boolean> {
    const endpoint = this.registry.get(id);
    if (!endpoint) return false;

    if (!this.mediamtx.isRunning) {
      this.logger.warn('streams', 'Fenetre de lecture refusee : MediaMTX est arrete.');
      return false;
    }

    const existing = this.viewerWindows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return true;
    }

    // On charge notre page de lecture, qui lit le HLS a faible latence.
    //
    // Pourquoi pas le WebRTC de MediaMTX : il refuse purement et simplement un
    // flux H.264 contenant des images B (« WebRTC doesn't support H264 streams
    // with B-frames »), ce que produisent la plupart des cameras. Le HLS, lui,
    // accepte tout, et les parties de 200 ms le maintiennent a environ une
    // seconde du direct.
    //
    // La boucle locale evite le proxy, l'antivirus ou le pare-feu qui
    // intercepteraient une adresse du reseau.
    const url = `http://127.0.0.1:${this.webPagesPort()}/watch/${encodeURIComponent(endpoint.path)}`;

    const viewerSession = session.fromPartition(VIEWER_PARTITION);

    // Connexion directe : aucune requete ne doit sortir par un proxy.
    try {
      await viewerSession.setProxy({ mode: 'direct' });
    } catch (error) {
      this.logger.warn('streams', `Proxy non desactivable pour la fenetre de lecture : ${String(error)}`);
    }

    const window = new BrowserWindow({
      ...VIEWER_WINDOW_OPTIONS,
      title: `${endpoint.name} - StreamControl`,
      webPreferences: {
        // La page de lecture est une page web autonome : aucun acces a Node.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: VIEWER_PARTITION,
      },
    });

    window.setMenuBarVisibility(false);

    // La fenetre est enregistree AVANT le chargement : un second clic pendant
    // le chargement la retrouve, au lieu d'en creer une deuxieme qui laisserait
    // la premiere orpheline. C'est ce qui produisait « Object has been
    // destroyed » : le chargeur d'erreur visait une fenetre deja detruite.
    this.viewerWindows.set(id, window);

    window.on('closed', () => {
      if (this.viewerWindows.get(id) === window) this.viewerWindows.delete(id);
    });

    try {
      await window.loadURL(url);
    } catch (error) {
      // L'echec de chargement ne doit pas remonter comme une erreur IPC : on
      // affiche une page explicative, plus utile qu'un message technique.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('streams', `Chargement de la fenetre de lecture impossible : ${message}`);

      // La fenetre peut avoir ete fermee pendant le chargement : toute
      // manipulation doit alors etre abandonnee.
      if (window.isDestroyed()) return false;

      // Une seule nouvelle tentative : le serveur de pages peut redemarrer au
      // moment ou l'utilisateur ouvre la fenetre.
      try {
        await window.loadURL(url);
      } catch {
        if (window.isDestroyed()) return false;
        await window
          .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderViewerError(endpoint.name, url, message))}`)
          .catch(() => undefined);
      }
    }

    this.logger.info('streams', `Fenetre de lecture ouverte pour "${endpoint.name}".`);
    return true;
  }

  closeViewerWindow(id: string): boolean {
    const window = this.viewerWindows.get(id);
    if (!window || window.isDestroyed()) {
      this.viewerWindows.delete(id);
      return false;
    }
    window.close();
    this.viewerWindows.delete(id);
    return true;
  }

  /** Ferme toutes les fenetres de lecture (fermeture de l'application). */
  closeAllViewerWindows(): void {
    for (const window of this.viewerWindows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.viewerWindows.clear();
  }

  private view(id: string): StreamEndpointView | undefined {
    const endpoint = this.registry.get(id);
    if (!endpoint) return undefined;
    return { ...endpoint, status: this.registry.getStatus(id), urls: this.buildUrls(endpoint) };
  }

  private broadcastStreams(): void {
    this.emit('streams-changed', this.list());
  }

  /** Enregistre les adresses dans les parametres. */
  private persist(): void {
    const endpoints = this.registry.list();
    void this.settings.save({ streams: endpoints });
  }

  /** Verifie qu'un chemin est utilisable avant creation (retour immediat). */
  checkPath(path: string, excludeId?: string): string | null {
    const normalized = normalizePath(path);
    if (!normalized) return 'Le chemin ne peut pas etre vide.';
    const existing = this.registry.findByPath(normalized);
    if (existing && existing.id !== excludeId) {
      return `Le chemin "/${normalized}" est deja utilise par "${existing.name}".`;
    }
    return null;
  }

  /** Chemin absolu du fichier de parametres, affiche dans l'interface. */
  get settingsPath(): string {
    return path.join(this.settings.path);
  }

  get version(): string {
    return this.appVersion;
  }

  /** Arret propre : plus d'interrogation de l'API. */
  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.closeAllViewerWindows();
  }
}
