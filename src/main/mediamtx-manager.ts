import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import type { ServiceActionResult, ServiceStatus } from '../shared/types';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';
import { bundledMediamtxDir, detectTool, mediamtxBinaryName, resolveExecutablePath } from './detection';
import { writeGeneratedConfig } from './mediamtx-config';

/** Processus lance avec stdout et stderr captures, sans stdin. */
type ManagedChild = ChildProcessByStdio<null, Readable, Readable>;

const MAX_AUTO_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

/** Etat d'un flux tel que le rapporte l'API MediaMTX. */
export interface MediamtxPathState {
  /** Nom du chemin, ex. "live". */
  name: string;
  /** Vrai quand une source publie reellement sur ce chemin. */
  online: boolean;
  /** Codecs annonces, ex. ["H264", "MPEG-4 Audio"]. */
  tracks: string[];
  /** Dimensions de l'image, si MediaMTX les connait. */
  width?: number;
  height?: number;
  /** Octets recus depuis le debut de la publication. */
  bytesReceived: number;
  /** Nombre de lecteurs connectes. */
  readers: number;
  /** Adresse de la source connectee, ex. "192.168.1.130:47530". */
  remoteAddr?: string;
  /** Logiciel de la source, ex. "FMLE/3.0 (compatible; Lavf61.1.100)". */
  userAgent?: string;
  /** Vrai quand MediaMTX enregistre ce chemin. */
  recording?: boolean;
  /** Modele de chemin d'enregistrement, si l'enregistrement est actif. */
  recordingPath?: string;
}

/** Nom lisible d'un logiciel de diffusion, d'apres son user-agent RTMP. */
export function describePublisher(userAgent: string | undefined): string {
  if (!userAgent) return 'Appareil inconnu';
  const value = userAgent.toLowerCase();
  if (value.includes('lavf') || value.includes('ffmpeg')) return 'FFmpeg';
  if (value.includes('obs')) return 'OBS Studio';
  if (value.includes('dji') || value.includes('mimo')) return 'DJI Mimo';
  if (value.includes('fmle')) return 'Encodeur FMLE';
  if (value.includes('gstreamer')) return 'GStreamer';
  if (value.includes('osmo')) return 'DJI Osmo';
  // Sinon, on garde la premiere partie du user-agent : elle nomme souvent le
  // logiciel, ex. "FMLE/3.0".
  return userAgent.split(/[;(]/)[0].trim().slice(0, 40) || 'Appareil inconnu';
}

/**
 * Pilote le processus MediaMTX : demarrage, arret propre, journalisation
 * de sa sortie et redemarrage automatique limite en cas de crash.
 */
export class MediamtxManager extends EventEmitter {
  private child: ManagedChild | null = null;
  private status: ServiceStatus = { state: 'stopped' };
  private readonly restartTimestamps: number[] = [];
  private stoppingIntentionally = false;
  private lastResolvedBinary: string | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
  ) {
    super();
    this.logger.setMaxListeners(50);
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  getBinaryPath(): string | null {
    return this.lastResolvedBinary;
  }

  /**
   * Interroge l'API HTTP de MediaMTX pour connaitre l'etat reel des flux.
   *
   * C'est la seule source fiable : le journal dit qu'une publication a ete
   * acceptee, l'API dit si le flux est reellement en ligne et quelles sont ses
   * dimensions. Un echec de lecture n'est pas une erreur : MediaMTX est
   * peut-etre simplement arrete, et l'appelant traite la liste vide.
   */
  async fetchPaths(): Promise<MediamtxPathState[]> {
    if (this.status.state !== 'running') return [];

    const port = this.settings.get().mediamtx.apiPort;

    try {
      const [paths, connections, configPaths] = await Promise.all([
        this.apiGet<{ items?: Array<Record<string, unknown>> }>(port, '/v3/paths/list'),
        // La source connectee n'apparait que dans la liste des connexions :
        // c'est la seule facon de savoir quel appareil publie.
        this.apiGet<{ items?: Array<Record<string, unknown>> }>(port, '/v3/rtmpconns/list'),
        // La configuration des chemins porte le reglage `record` : c'est elle
        // qui dit quels flux sont en cours d'enregistrement.
        this.apiGet<{ items?: Array<Record<string, unknown>> }>(port, '/v3/config/paths/list'),
      ]);

      // Une entree par chemin publie : adresse et logiciel de la source.
      const publishers = new Map<string, { remoteAddr?: string; userAgent?: string }>();
      for (const entry of connections?.items ?? []) {
        const path = typeof entry.path === 'string' ? entry.path : '';
        if (!path) continue;
        publishers.set(path, {
          remoteAddr: typeof entry.remoteAddr === 'string' ? entry.remoteAddr : undefined,
          userAgent: typeof entry.userAgent === 'string' ? entry.userAgent : undefined,
        });
      }

      // Chemins dont l'enregistrement est actif, et leur dossier.
      //
      // Attention : quand le replay instantane est actif, MediaMTX enregistre
      // lui aussi en continu (c'est le principe du tampon). On distingue les
      // deux par le dossier : le tampon vit dans « replay-buffer », un vrai
      // enregistrement dans « recordings ». Sans cette distinction, tous les
      // flux afficheraient « REC » des que le replay est active.
      const recording = new Map<string, string>();
      for (const entry of configPaths?.items ?? []) {
        if (entry.record !== true) continue;
        const name = typeof entry.name === 'string' ? entry.name : '';
        if (!name) continue;
        const recordPath = typeof entry.recordPath === 'string' ? entry.recordPath : '';
        if (recordPath.includes('replay-buffer')) continue;
        recording.set(name, recordPath);
      }

      return (paths?.items ?? []).map((item) => {
        // Les dimensions vivent dans tracks2[0].codecProps pour la video.
        const tracks2 = item.tracks2 as Array<{ codecProps?: { width?: number; height?: number } }> | undefined;
        const videoProps = tracks2?.[0]?.codecProps;
        const name = typeof item.name === 'string' ? item.name : '';
        const publisher = publishers.get(name);
        return {
          name,
          online: item.online === true,
          tracks: Array.isArray(item.tracks) ? (item.tracks as string[]) : [],
          width: videoProps?.width,
          height: videoProps?.height,
          bytesReceived: typeof item.bytesReceived === 'number' ? item.bytesReceived : 0,
          readers: Array.isArray(item.readers) ? (item.readers as unknown[]).length : 0,
          remoteAddr: publisher?.remoteAddr,
          userAgent: publisher?.userAgent,
          recording: recording.has(name),
          recordingPath: recording.get(name),
        };
      });
    } catch {
      // API injoignable : le flux n'est simplement pas en ligne.
      return [];
    }
  }

  /** Lecture JSON courte aupres de l'API MediaMTX. */
  private async apiGet<T>(port: number, path: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Vrai si le processus MediaMTX tourne et ecoute. */
  get isRunning(): boolean {
    return this.status.state === 'running';
  }

  /**
   * Declare ou met a jour un chemin dans MediaMTX, avec son enregistrement.
   *
   * MediaMTX ecrit sa configuration en memoire : un chemin ajoute par l'API est
   * actif immediatement, sans redemarrage. On declare donc chaque flux ici,
   * avec `record` a la demande, ce qui rend l'enregistrement independant d'un
   * flux a l'autre.
   *
   * @returns true si l'API a accepte l'operation.
   */
  async configurePath(
    streamPath: string,
    options: {
      record: boolean;
      recordPath: string;
      recordFormat: string;
      recordSegmentDuration: string;
      recordDeleteAfter: string;
    },
  ): Promise<boolean> {
    if (this.status.state !== 'running') return false;
    const name = streamPath.replace(/^\/+|\/+$/g, '');
    if (!name) return false;

    const body = {
      source: 'publisher',
      record: options.record,
      recordPath: options.recordPath,
      recordFormat: options.recordFormat,
      recordSegmentDuration: options.recordSegmentDuration,
      recordDeleteAfter: options.recordDeleteAfter,
    };

    // `patch` d'abord : si le chemin existe deja, on met a jour son
    // enregistrement sans interrompre une publication en cours.
    const patched = await this.apiCall('PATCH', `/v3/config/paths/patch/${encodeURIComponent(name)}`, body);
    if (patched) return true;

    // Sinon on le cree.
    return this.apiCall('POST', `/v3/config/paths/add/${encodeURIComponent(name)}`, body);
  }

  /** Vrai si MediaMTX enregistre reellement ce chemin. */
  async isRecording(streamPath: string): Promise<boolean> {
    const name = streamPath.replace(/^\/+|\/+$/g, '');
    const port = this.settings.get().mediamtx.apiPort;
    const config = await this.apiGet<{ record?: boolean }>(
      port,
      `/v3/config/paths/get/${encodeURIComponent(name)}`,
    );
    return config?.record === true;
  }

  /** Appel court a l'API MediaMTX. Retourne null si elle ne repond pas. */
  private async apiCall(method: string, path: string, body?: unknown): Promise<boolean> {
    if (this.status.state !== 'running') return false;
    const port = this.settings.get().mediamtx.apiPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        signal: controller.signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private setStatus(next: Partial<ServiceStatus> & { state: ServiceStatus['state'] }): void {
    this.status = { ...this.status, ...next };
    this.emit('status', this.getStatus());
  }

  /** Resout le binaire a executer : chemin force, embarque, puis detection systeme. */
  private async resolveBinary(): Promise<string> {
    const { binaryPath } = this.settings.get().mediamtx;

    if (binaryPath.trim()) {
      const candidate = resolveExecutablePath(binaryPath, ['mediamtx.exe', 'mediamtx']);
      if (candidate) return candidate;
      this.logger.warn(
        'mediamtx',
        `Binaire configure introuvable (${binaryPath}), retour a la detection automatique.`,
      );
    }

    const detected = await detectTool('mediamtx', { logger: this.logger, overridePath: binaryPath });
    if (detected.found && detected.path) return detected.path;

    throw new Error(
      `${mediamtxBinaryName()} introuvable. Placez le binaire dans ${bundledMediamtxDir()} ` +
        'ou indiquez son dossier dans l\'onglet Parametres.',
    );
  }

  private async resolveConfigPath(): Promise<string> {
    const { configPath } = this.settings.get().mediamtx;
    if (configPath.trim()) {
      const candidate = configPath.trim().toLowerCase().endsWith('.yml')
        ? configPath.trim()
        : path.join(configPath.trim(), 'mediamtx.yml');
      try {
        await fs.access(candidate);
        this.logger.info('mediamtx', `Configuration MediaMTX personnalisee utilisee (${candidate}).`);
        return candidate;
      } catch {
        this.logger.warn('mediamtx', `Configuration introuvable (${candidate}), generation automatique.`);
      }
    }
    const generated = await writeGeneratedConfig(this.settings.get().mediamtx);
    this.logger.info('mediamtx', `Configuration generee : ${generated}`);
    return generated;
  }

  async start(): Promise<ServiceActionResult> {
    if (this.status.state === 'running' || this.status.state === 'starting') {
      return { ok: true, status: this.getStatus(), message: 'MediaMTX est deja actif.' };
    }

    this.stoppingIntentionally = false;
    this.setStatus({ state: 'starting', detail: 'Resolution du binaire...' });

    let binary: string;
    let configPath: string;
    try {
      binary = await this.resolveBinary();
      configPath = await this.resolveConfigPath();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('mediamtx', message);
      this.setStatus({ state: 'error', detail: message });
      return { ok: false, status: this.getStatus(), message };
    }

    // MediaMTX attend le chemin de configuration en argument positionnel.
    const validation = await this.validateConfig(binary, configPath);
    if (!validation.ok) {
      const message = `Configuration MediaMTX refusee : ${validation.message}`;
      this.logger.error('mediamtx', message);
      this.setStatus({ state: 'error', detail: message });
      return { ok: false, status: this.getStatus(), message };
    }

    const workingDirectory = path.dirname(binary);
    this.logger.info('mediamtx', `Demarrage : "${binary}" "${configPath}"`);

    return new Promise<ServiceActionResult>((resolve) => {
      let settled = false;
      const finish = (result: ServiceActionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let child: ManagedChild;
      try {
        child = spawn(binary, [configPath], {
          cwd: workingDirectory,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('mediamtx', `Lancement impossible : ${message}`);
        this.setStatus({ state: 'error', detail: message });
        finish({ ok: false, status: this.getStatus(), message });
        return;
      }

      this.child = child;
      this.lastResolvedBinary = binary;

      const startupTimer = setTimeout(() => {
        this.setStatus({
          state: 'running',
          pid: child.pid,
          startedAt: Date.now(),
          detail: 'Demarrage suppose reussi (aucune erreur immediate).',
        });
        finish({ ok: true, status: this.getStatus() });
      }, 1500);

      child.stdout.on('data', (chunk: Buffer) => this.logStreamOutput(chunk, 'info'));
      child.stderr.on('data', (chunk: Buffer) => this.logStreamOutput(chunk, 'error'));

      child.once('error', (error) => {
        clearTimeout(startupTimer);
        const message = `Echec de demarrage : ${error.message}`;
        this.logger.error('mediamtx', message);
        this.child = null;
        this.setStatus({ state: 'error', detail: message, pid: undefined });
        finish({ ok: false, status: this.getStatus(), message });
      });

      child.once('exit', (code, signal) => {
        clearTimeout(startupTimer);
        this.child = null;
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        this.logger.info('mediamtx', `Processus termine (${reason}).`);

        if (this.stoppingIntentionally) {
          this.setStatus({ state: 'stopped', pid: undefined, detail: 'Arrete par l\'utilisateur.' });
          return;
        }

        this.setStatus({ state: 'stopped', pid: undefined, detail: `Termine de maniere inattendue (${reason}).` });

        if (this.settings.get().mediamtx.autoRestart && this.canRestart()) {
          this.restartTimestamps.push(Date.now());
          const attempt = this.restartTimestamps.length;
          this.logger.warn('mediamtx', `Redemarrage automatique ${attempt}/${MAX_AUTO_RESTARTS}...`);
          this.setStatus({ state: 'starting', detail: 'Redemarrage automatique', restarts: attempt });
          void this.start();
        } else if (!this.settings.get().mediamtx.autoRestart) {
          this.logger.warn('mediamtx', 'Redemarrage automatique desactive dans les parametres.');
        } else {
          this.logger.error('mediamtx', 'Trop de redemarrages recents, arret de la tentative automatique.');
        }

        if (!settled) {
          const message = `MediaMTX s'est arrete immediatement (${reason}). Verifiez la configuration et les ports.`;
          this.setStatus({ state: 'error', detail: message });
          finish({ ok: false, status: this.getStatus(), message });
        }
      });
    });
  }

  /**
   * Demande a MediaMTX de valider le fichier de configuration.
   * Un fichier refuse fait echouer immediatement le demarrage avec un
   * message precis, au lieu de laisser le processus mourir en silence.
   */
  private async validateConfig(
    binary: string,
    configPath: string,
  ): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      execFile(
        binary,
        ['--validate-conf', configPath],
        { timeout: 8000, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, message: 'configuration valide' });
            return;
          }
          const detail = `${stdout}\n${stderr}`
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join(' ');
          resolve({ ok: false, message: detail || error.message });
        },
      );
    });
  }

  /** Autorise un redemarrage seulement si peu de tentatives ont eu lieu recemment. */
  private canRestart(): boolean {
    const now = Date.now();
    while (this.restartTimestamps.length > 0 && now - this.restartTimestamps[0] > RESTART_WINDOW_MS) {
      this.restartTimestamps.shift();
    }
    return this.restartTimestamps.length < MAX_AUTO_RESTARTS;
  }

  private logStreamOutput(chunk: Buffer, level: 'info' | 'error'): void {
    const text = chunk.toString('utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      // Une connexion refusee est traduite en message actionnable : le texte de
      // MediaMTX ne dit pas quoi corriger.
      const refused = this.explainRefusal(line);
      if (refused) {
        this.logger.warn('mediamtx', refused);
        continue;
      }

      // MediaMTX ecrit ses erreurs sur stderr ; on distingue les erreurs reelles.
      const isError = level === 'error' && /error|fatal|fail|panic/i.test(line);
      if (isError) this.logger.error('mediamtx', line);
      else this.logger.info('mediamtx', line);
    }
  }

  /**
   * Traduit un refus de connexion en message exploitable.
   *
   * MediaMTX consigne « path ... is not configured » sans dire quoi faire.
   */
  private explainRefusal(line: string): string | null {
    if (/is not configured/i.test(line)) {
      return (
        'Publication refusee : le chemin demande n\'est pas configure dans MediaMTX. ' +
        "Verifiez l'URL d'ingestion affichee dans l'onglet Flux."
      );
    }
    return null;
  }

  async stop(): Promise<ServiceActionResult> {
    if (!this.child || this.status.state === 'stopped') {
      this.setStatus({ state: 'stopped', pid: undefined, detail: 'Deja arrete.' });
      return { ok: true, status: this.getStatus(), message: 'MediaMTX est deja arrete.' };
    }

    this.stoppingIntentionally = true;
    const child = this.child;
    this.setStatus({ state: 'stopping', detail: 'Arret en cours...' });
    this.logger.info('mediamtx', 'Arret demande.');

    return new Promise<ServiceActionResult>((resolve) => {
      const forceTimer = setTimeout(() => {
        if (this.child === child) {
          this.logger.warn('mediamtx', 'Arret non termine, envoi de SIGKILL.');
          child.kill('SIGKILL');
        }
      }, 5000);

      child.once('exit', () => {
        clearTimeout(forceTimer);
        this.setStatus({ state: 'stopped', pid: undefined, detail: 'Arrete par l\'utilisateur.' });
        resolve({ ok: true, status: this.getStatus() });
      });

      const killed = child.kill();
      if (!killed) {
        clearTimeout(forceTimer);
        this.child = null;
        this.setStatus({ state: 'stopped', pid: undefined, detail: 'Processus deja termine.' });
        resolve({ ok: true, status: this.getStatus() });
      }
    });
  }

  async restart(): Promise<ServiceActionResult> {
    await this.stop();
    // Laisse le port se liberer avant de relancer.
    await new Promise((resolve) => setTimeout(resolve, 600));
    this.restartTimestamps.length = 0;
    return this.start();
  }

  /** Arret de dernier recours lors de la fermeture de l'application. */
  async dispose(): Promise<void> {
    if (!this.child) return;
    this.stoppingIntentionally = true;
    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2500);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
