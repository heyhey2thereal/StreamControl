/**
 * Verrouillage du poste.
 *
 * L'application sert de serveur de flux : elle peut rester ouverte sur un poste
 * de regie. Le verrouillage masque l'interface derriere un mot de passe, pour
 * eviter qu'un passant ne change une adresse ou n'arrete une diffusion.
 *
 * Le mot de passe n'est jamais conserve : seule une empreinte salee
 * (`scrypt`) est ecrite dans les parametres.
 *
 * Une porte de secours optionnelle existe : la variable d'environnement
 * `STREAMCONTROL_MASTER_PASSWORD`. Aucun mot de passe maitre n'est code en
 * dur : un binaire publie ne doit contenir aucun secret connu.
 */
import crypto from 'node:crypto';
import type { LockState } from '../shared/types';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';

/**
 * Mot de passe maitre : porte de secours optionnelle, lue dans l'environnement.
 * Vide par defaut : un binaire publie ne doit contenir aucun secret connu.
 */
export const MASTER_PASSWORD = (process.env.STREAMCONTROL_MASTER_PASSWORD ?? '').trim();

/** Longueur de l'empreinte scrypt, en octets. */
const HASH_LENGTH = 64;

/** Compare deux chaines en temps constant, pour ne pas fuiter par le temps. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** Calcule l'empreinte d'un mot de passe avec son sel. */
function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, HASH_LENGTH).toString('hex');
}

export class LockManager {
  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
  ) {}

  getState(): LockState {
    const ui = this.settings.get().ui;
    return {
      locked: ui.locked,
      hasPassword: ui.lockHash.length > 0,
      hint: ui.lockHint,
    };
  }

  /** Definit le mot de passe (et l'indice), puis verrouille. */
  async setPassword(password: string, hint: string): Promise<LockState> {
    const trimmed = password.trim();

    // Un mot de passe vide retire le verrouillage : c'est le seul moyen de
    // revenir en arriere si l'utilisateur ne veut plus verrouiller son poste.
    if (trimmed.length === 0) {
      await this.settings.save({
        ui: { ...this.settings.get().ui, lockSalt: '', lockHash: '', lockHint: '', locked: false },
      });
      this.logger.info('lock', 'Verrouillage retire.');
      return this.getState();
    }

    if (trimmed.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caracteres.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(trimmed, salt);

    await this.settings.save({
      ui: { ...this.settings.get().ui, lockSalt: salt, lockHash: hash, lockHint: hint.trim(), locked: true },
    });
    this.logger.info('lock', 'Verrouillage active : un mot de passe a ete defini.');
    return this.getState();
  }

  /** Verrouille le poste. Refuse si aucun mot de passe n'a ete defini. */
  async lock(): Promise<LockState> {
    const ui = this.settings.get().ui;
    if (!ui.lockHash) throw new Error('Definissez d\'abord un mot de passe.');
    await this.settings.save({ ui: { ...ui, locked: true } });
    this.logger.info('lock', 'Poste verrouille.');
    return this.getState();
  }

  /**
   * Retire le verrouillage au moment de quitter.
   *
   * Un poste ferme pendant qu'il etait verrouille ne doit pas se rouvrir
   * verrouille : l'utilisateur vient de fermer l'application lui-meme, il n'a
   * pas a ressaisir un mot de passe pour la relancer.
   */
  async releaseOnQuit(): Promise<void> {
    const ui = this.settings.get().ui;
    if (!ui.locked) return;
    await this.settings.save({ ui: { ...ui, locked: false } });
    this.logger.info('lock', 'Verrouillage retire a la fermeture.');
  }

  /**
   * Verifie un mot de passe sans deverrouiller.
   *
   * Sert aux macros : « verrouiller le poste » peut exiger le mot de passe,
   * pour qu'une macro lancee par erreur n'enferme pas l'operateur dehors.
   */
  checkPassword(password: string): boolean {
    const ui = this.settings.get().ui;
    if (!ui.lockHash || !ui.lockSalt) return false;
    return safeEqual(hashPassword(password, ui.lockSalt), ui.lockHash);
  }

  /**
   * Tente de deverrouiller.
   *
   * Si un mot de passe maitre est fourni par l'environnement, il ouvre
   * toujours : c'est la porte de secours si le mot de passe defini est oublie.
   */
  async unlock(password: string): Promise<{ ok: boolean; state: LockState; message?: string }> {
    const ui = this.settings.get().ui;

    if (MASTER_PASSWORD && safeEqual(password, MASTER_PASSWORD)) {
      await this.settings.save({ ui: { ...ui, locked: false } });
      this.logger.info('lock', 'Poste deverrouille (mot de passe maitre).');
      return { ok: true, state: this.getState() };
    }

    if (!ui.lockHash || !ui.lockSalt) {
      return { ok: false, state: this.getState(), message: 'Aucun mot de passe defini.' };
    }

    if (safeEqual(hashPassword(password, ui.lockSalt), ui.lockHash)) {
      await this.settings.save({ ui: { ...ui, locked: false } });
      this.logger.info('lock', 'Poste deverrouille.');
      return { ok: true, state: this.getState() };
    }

    this.logger.warn('lock', 'Mot de passe de deverrouillage refuse.');
    return { ok: false, state: this.getState(), message: 'Mot de passe incorrect.' };
  }
}
