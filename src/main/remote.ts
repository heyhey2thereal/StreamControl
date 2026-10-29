/**
 * StreamControl Remote : panneau de controle sur le reseau local.
 *
 * Un telephone ouvre `/remote` sur le serveur de pages. Aucun appareil n'est
 * autorise par defaut : la premiere connexion cree une **demande d'appairage**,
 * affichee sur le poste sous forme de pop-up « Accepter / Refuser ». C'est
 * l'utilisateur present devant le PC qui decide.
 *
 * Une fois accepte, l'appareil recoit un jeton opaque, conserve dans les
 * parametres. Chaque requete de controle porte ce jeton : sans lui, rien n'est
 * execute. Le jeton se retire a tout moment depuis les Parametres.
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { RemoteDevice } from '../shared/types';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';

/** Longueur de l'empreinte scrypt, en octets. */
const HASH_LENGTH = 64;

/** Compare deux chaines en temps constant, pour ne pas fuiter par le temps. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** Demande d'appairage en attente de decision sur le poste. */
export interface PairRequest {
  /** Identifiant de la demande, remis a l'appareil pour suivre son sort. */
  id: string;
  /** Nom lisible de l'appareil, deduit de son en-tete User-Agent. */
  name: string;
  /** Adresse reseau de l'appareil. */
  address: string;
  /** Date de la demande. */
  at: number;
}

/** Etat d'une demande, tel que l'interroge l'appareil. */
export type PairStatus = 'pending' | 'accepted' | 'refused' | 'expired';

/** Delai au-dela duquel une demande non tranchee expire. */
const REQUEST_TTL_MS = 120_000;

/** Deduit un nom lisible depuis l'en-tete User-Agent. */
export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return 'Appareil inconnu';
  const value = userAgent.toLowerCase();
  if (value.includes('iphone')) return 'iPhone';
  if (value.includes('ipad')) return 'iPad';
  if (value.includes('android')) {
    const match = /android[^;]*;\s*([^)]+)\)/i.exec(userAgent ?? '');
    return match ? `Android (${match[1].trim()})` : 'Android';
  }
  if (value.includes('macintosh')) return 'Mac';
  if (value.includes('windows')) return 'PC Windows';
  if (value.includes('linux')) return 'Linux';
  return 'Navigateur';
}

export class RemoteManager extends EventEmitter {
  /** Demandes en attente, indexees par identifiant. */
  private readonly pending = new Map<string, PairRequest>();
  /** Jeton emis pour une demande acceptee, consulte par l'appareil. */
  private readonly granted = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
  ) {
    super();
    // Une purge periodique evite qu'une demande oubliee reste en attente.
    const timer = setInterval(() => this.expire(), 15_000);
    timer.unref?.();
  }

  /** Vrai quand le panneau distant est active dans les parametres. */
  get enabled(): boolean {
    return this.settings.get().remote.enabled;
  }

  /** Vrai si un mot de passe d'acces est defini. */
  get hasPassword(): boolean {
    return this.settings.get().remote.passwordHash.length > 0;
  }

  /** Definit (ou retire) le mot de passe du panneau distant. */
  async setPassword(password: string): Promise<void> {
    const remote = this.settings.get().remote;
    const trimmed = password.trim();
    if (trimmed.length === 0) {
      await this.settings.save({ remote: { ...remote, passwordHash: '', passwordSalt: '' } });
      this.logger.info('remote', "Mot de passe du panneau distant retire.");
      return;
    }
    if (trimmed.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caracteres.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(trimmed, salt, HASH_LENGTH).toString('hex');
    await this.settings.save({ remote: { ...remote, passwordHash: hash, passwordSalt: salt } });
    this.logger.info('remote', 'Mot de passe du panneau distant defini.');
  }

  /**
   * Verifie le mot de passe d'acces.
   * @returns true si aucun mot de passe n'est defini (acces libre).
   */
  checkPassword(password: string): boolean {
    const { passwordHash, passwordSalt } = this.settings.get().remote;
    if (!passwordHash) return true;
    const attempt = crypto.scryptSync(password, passwordSalt, HASH_LENGTH).toString('hex');
    return safeEqual(attempt, passwordHash);
  }

  /** Retire les demandes trop anciennes. */
  private expire(): void {
    const now = Date.now();
    for (const [id, request] of this.pending) {
      if (now - request.at > REQUEST_TTL_MS) {
        this.pending.delete(id);
        this.emit('expired', request);
      }
    }
  }

  /** Verifie un jeton d'appareil. Retourne l'appareil, ou null. */
  verify(token: string | undefined): RemoteDevice | null {
    if (!token) return null;
    const device = this.settings.get().remote.devices.find((entry) => entry.token === token);
    return device ?? null;
  }

  /** Met a jour la date de derniere activite d'un appareil. */
  touch(token: string): void {
    const devices = this.settings.get().remote.devices;
    const device = devices.find((entry) => entry.token === token);
    if (!device) return;
    // On n'ecrit que toutes les minutes, pour ne pas user le disque.
    if (device.lastSeenAt && Date.now() - device.lastSeenAt < 60_000) return;
    void this.settings.save({
      remote: {
        ...this.settings.get().remote,
        devices: devices.map((entry) =>
          entry.token === token ? { ...entry, lastSeenAt: Date.now() } : entry,
        ),
      },
    });
  }

  /**
   * Cree une demande d'appairage et la remonte au poste.
   *
   * @returns la demande, dont l'identifiant est remis a l'appareil.
   */
  requestPair(userAgent: string | undefined, address: string): PairRequest {
    const request: PairRequest = {
      id: crypto.randomBytes(6).toString('hex'),
      name: describeDevice(userAgent),
      address,
      at: Date.now(),
    };
    this.pending.set(request.id, request);
    this.logger.info('remote', `Demande d'acces de ${request.name} (${address}).`);
    this.emit('pair-request', request);
    return request;
  }

  /**
   * Etat d'une demande d'appairage, tel que l'interroge l'appareil.
   * Une demande acceptee renvoie son jeton, une seule fois.
   */
  status(id: string): { status: PairStatus; token?: string } {
    if (this.pending.has(id)) return { status: 'pending' };
    const token = this.granted.get(id);
    if (token) {
      // Le jeton n'est remis qu'une fois : l'appareil le conserve ensuite.
      this.granted.delete(id);
      return { status: 'accepted', token };
    }
    return { status: 'expired' };
  }

  /**
   * Accepte une demande : cree l'appareil et prepare son jeton.
   *
   * @returns l'appareil cree, ou null si la demande est inconnue.
   */
  async accept(id: string): Promise<RemoteDevice | null> {
    const request = this.pending.get(id);
    if (!request) return null;
    this.pending.delete(id);

    const device: RemoteDevice = {
      token: crypto.randomBytes(24).toString('hex'),
      name: request.name,
      address: request.address,
      addedAt: Date.now(),
    };
    const remote = this.settings.get().remote;
    await this.settings.save({ remote: { ...remote, devices: [...remote.devices, device] } });

    this.granted.set(id, device.token);
    this.logger.info('remote', `Acces accorde a ${device.name}.`);
    this.emit('paired', device);
    return device;
  }

  /** Refuse une demande : rien n'est conserve. */
  refuse(id: string): boolean {
    const request = this.pending.get(id);
    if (!request) return false;
    this.pending.delete(id);
    this.logger.info('remote', `Acces refuse a ${request.name}.`);
    this.emit('refused', request);
    return true;
  }

  /** Retire un appareil autorise. */
  async forget(token: string): Promise<void> {
    const remote = this.settings.get().remote;
    await this.settings.save({
      remote: { ...remote, devices: remote.devices.filter((entry) => entry.token !== token) },
    });
    this.logger.info('remote', 'Appareil retire.');
  }

  /** Demandes en attente, pour l'interface du poste. */
  listPending(): PairRequest[] {
    this.expire();
    return [...this.pending.values()];
  }
}
