/**
 * Registre des points de diffusion.
 *
 * Chaque entree decrit une "adresse" creee depuis l'interface : un nom, un
 * chemin de publication, un protocole et une cle d'acces optionnelle.
 *
 * Le registre ne produit plus rien lui-meme : MediaMTX recoit la publication
 * et la redistribue. Il ne conserve donc que la description des adresses et
 * leur etat, ce dernier etant renseigne depuis l'API de MediaMTX.
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

/** Protocoles d'ingestion proposes par l'interface. */
export type IngestProtocol = 'rtmp' | 'srt' | 'rtsp';

export interface StreamEndpoint {
  id: string;
  /** Nom lisible, affiche dans l'interface. */
  name: string;
  /** Protocole d'ingestion. */
  protocol: IngestProtocol;
  /** Chemin de publication, ex. "live" ou "studio/cam1". */
  path: string;
  /** Cle d'acces optionnelle : sans elle, toute publication est acceptee. */
  streamKey: string;
  /** Appareil source, a titre indicatif. */
  source: string;
  enabled: boolean;
  createdAt: number;
  /** Duree visee d'un segment HLS, en secondes. */
  segmentDuration: number;
  /** Nombre de segments conserves dans la liste de lecture. */
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
  /** Adresse de l'emetteur connecte. */
  publisher?: string;
  /** Debit moyen en kbit/s, calcule sur les dernieres secondes. */
  bitrateKbps: number;
}

export interface RegistryOptions {
  segmentDuration?: number;
  playlistSize?: number;
}

/** Genere un identifiant court et lisible. */
function generateId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Normalise un chemin de flux : minuscules, sans espaces ni accents. */
export function normalizePath(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 64);
}

export class StreamRegistry extends EventEmitter {
  private endpoints = new Map<string, StreamEndpoint>();
  private statuses = new Map<string, StreamStatus>();
  private bitrateSamples = new Map<string, Array<{ at: number; bytes: number }>>();
  private readonly defaultSegmentDuration: number;
  private readonly defaultPlaylistSize: number;

  constructor(options: RegistryOptions = {}) {
    super();
    this.setMaxListeners(50);
    this.defaultSegmentDuration = options.segmentDuration ?? 2;
    this.defaultPlaylistSize = options.playlistSize ?? 6;
  }

  /** Cree un point de diffusion. */
  create(input: Partial<StreamEndpoint> & { name?: string; path?: string }): StreamEndpoint {
    const path = normalizePath(input.path ?? '') || `flux-${generateId()}`;
    const name = (input.name ?? '').trim() || path;

    if (this.findByPath(path)) {
      throw new Error(`Le chemin "${path}" est deja utilise par une autre adresse.`);
    }

    // Deux adresses de meme nom seraient indiscernables dans l'interface, et
    // les sources OBS porteraient le meme nom : on refuse des la creation.
    const sameName = this.findByName(name);
    if (sameName) {
      throw new Error(`Le nom "${name}" est deja utilise par une autre adresse.`);
    }

    const endpoint: StreamEndpoint = {
      id: input.id ?? generateId(),
      name,
      protocol: input.protocol ?? 'rtmp',
      path,
      // Aucune cle par defaut : un appareil qui publie sans cle doit etre
      // accepte. La cle n'existe que si l'utilisateur la demande.
      streamKey: (input.streamKey ?? '').trim(),
      source: input.source ?? '',
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
      segmentDuration: input.segmentDuration ?? this.defaultSegmentDuration,
      playlistSize: input.playlistSize ?? this.defaultPlaylistSize,
    };

    this.endpoints.set(endpoint.id, endpoint);
    this.statuses.set(endpoint.id, this.emptyStatus(endpoint.id));
    this.emit('changed', this.list());
    return { ...endpoint };
  }

  /** Met a jour un point de diffusion existant. */
  update(id: string, patch: Partial<StreamEndpoint>): StreamEndpoint {
    const current = this.endpoints.get(id);
    if (!current) throw new Error(`Adresse inconnue : ${id}`);

    const next: StreamEndpoint = { ...current, ...patch, id };

    if (patch.path !== undefined) {
      next.path = normalizePath(patch.path);
      if (!next.path) throw new Error('Le chemin ne peut pas etre vide.');
      const conflict = this.findByPath(next.path);
      if (conflict && conflict.id !== id) {
        throw new Error(`Le chemin "${next.path}" est deja utilise par une autre adresse.`);
      }
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim() || next.path;
      const sameName = this.findByName(name);
      if (sameName && sameName.id !== id) {
        throw new Error(`Le nom "${name}" est deja utilise par une autre adresse.`);
      }
      next.name = name;
    }
    next.segmentDuration = Math.min(10, Math.max(1, next.segmentDuration));
    next.playlistSize = Math.min(20, Math.max(2, next.playlistSize));

    this.endpoints.set(id, next);
    this.emit('changed', this.list());
    return { ...next };
  }

  /** Supprime un point de diffusion. */
  remove(id: string): boolean {
    const existed = this.endpoints.delete(id);
    if (!existed) return false;

    this.statuses.delete(id);
    this.bitrateSamples.delete(id);
    this.emit('changed', this.list());
    return true;
  }

  list(): StreamEndpoint[] {
    return [...this.endpoints.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): StreamEndpoint | undefined {
    const endpoint = this.endpoints.get(id);
    return endpoint ? { ...endpoint } : undefined;
  }

  /** Retrouve une adresse par son nom, sans tenir compte de la casse. */
  findByName(name: string): StreamEndpoint | undefined {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return undefined;
    for (const endpoint of this.endpoints.values()) {
      if (endpoint.name.trim().toLowerCase() === wanted) return endpoint;
    }
    return undefined;
  }

  findByPath(path: string): StreamEndpoint | undefined {
    const normalized = normalizePath(path);
    for (const endpoint of this.endpoints.values()) {
      if (endpoint.path === normalized) return endpoint;
    }
    return undefined;
  }

  /**
   * Renseigne l'etat d'un flux d'apres l'API de MediaMTX.
   *
   * Le debit est calcule sur une fenetre glissante : l'API donne un total
   * d'octets depuis le debut de la publication, pas un debit instantane.
   */
  applyLiveState(
    id: string,
    state: {
      online: boolean;
      bytesReceived: number;
      width?: number;
      height?: number;
      hasAudio: boolean;
      viewers: number;
      /** Adresse de la source connectee, si connue. */
      publisher?: string;
    },
  ): void {
    const status = this.statuses.get(id) ?? this.emptyStatus(id);
    const wasPublishing = status.publishing;

    status.publishing = state.online;
    status.viewers = state.viewers;
    status.hasAudio = state.hasAudio;
    status.bytesReceived = state.bytesReceived;
    status.publisher = state.publisher;
    if (state.width) status.videoWidth = state.width;
    if (state.height) status.videoHeight = state.height;

    if (state.online && !wasPublishing) {
      status.startedAt = Date.now();
      status.bitrateKbps = 0;
      this.bitrateSamples.set(id, []);
    }

    if (!state.online) {
      status.startedAt = undefined;
      status.bitrateKbps = 0;
      status.publisher = undefined;
      this.bitrateSamples.set(id, []);
    } else {
      const now = Date.now();
      const samples = this.bitrateSamples.get(id) ?? [];
      samples.push({ at: now, bytes: state.bytesReceived });
      while (samples.length > 0 && now - samples[0].at > 5000) samples.shift();
      this.bitrateSamples.set(id, samples);

      if (samples.length >= 2) {
        const first = samples[0];
        const elapsed = (now - first.at) / 1000;
        const deltaBytes = state.bytesReceived - first.bytes;
        if (elapsed > 0.5 && deltaBytes >= 0) {
          status.bitrateKbps = Math.round((deltaBytes * 8) / elapsed / 1000);
        }
      }
    }

    this.statuses.set(id, status);
  }

  getStatus(id: string): StreamStatus {
    return { ...(this.statuses.get(id) ?? this.emptyStatus(id)) };
  }

  getAllStatuses(): StreamStatus[] {
    return this.list().map((endpoint) => this.getStatus(endpoint.id));
  }

  incrementViewers(id: string, delta: number): void {
    const status = this.statuses.get(id);
    if (!status) return;
    status.viewers = Math.max(0, status.viewers + delta);
    this.statuses.set(id, status);
  }

  /** Charge les points sauvegardes dans les parametres. */
  hydrate(endpoints: StreamEndpoint[]): void {
    this.endpoints.clear();
    this.statuses.clear();
    for (const endpoint of endpoints) {
      const normalized: StreamEndpoint = {
        ...endpoint,
        path: normalizePath(endpoint.path),
        segmentDuration: endpoint.segmentDuration ?? this.defaultSegmentDuration,
        playlistSize: endpoint.playlistSize ?? this.defaultPlaylistSize,
      };
      if (!normalized.path) continue;
      this.endpoints.set(normalized.id, normalized);
      this.statuses.set(normalized.id, this.emptyStatus(normalized.id));
    }
    this.emit('changed', this.list());
  }

  private emptyStatus(id: string): StreamStatus {
    return {
      id,
      publishing: false,
      viewers: 0,
      hasAudio: false,
      videoFrames: 0,
      audioFrames: 0,
      bytesReceived: 0,
      bitrateKbps: 0,
    };
  }
}
