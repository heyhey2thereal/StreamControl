/**
 * Surveillance automatique des flux.
 *
 * Le but : qu'un probleme ne passe pas inapercu pendant un evenement. Ce module
 * compare l'etat des flux a des regles configurables et produit des alertes :
 * une camera qui se deconnecte, qui revient, ou dont le debit chute.
 *
 * Il ne modifie rien de lui-meme. Quand une bascule de secours est demandee,
 * il emet un evenement que le poste peut suivre ; la decision reste explicite.
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { WatchAlert } from '../shared/types';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';

/** Etat d'un flux, tel qu'observe par la surveillance. */
export interface WatchedStream {
  path: string;
  name: string;
  publishing: boolean;
  bitrateKbps: number;
}

/** Nombre maximal d'alertes conservees. */
const MAX_ALERTS = 200;

export class StreamWatcher extends EventEmitter {
  /** Alertes produites, les plus recentes en tete. */
  private alerts: WatchAlert[] = [];
  /** Etat precedent de chaque flux, pour detecter les transitions. */
  private readonly previous = new Map<string, { publishing: boolean; name: string }>();
  /** Debut du debit trop bas, par flux. */
  private readonly lowSince = new Map<string, number>();
  /** Deja signale en debit bas, pour ne pas repeter l'alerte. */
  private readonly lowAlerted = new Set<string>();
  /** Nombre d'interruptions observees, par chemin. */
  private readonly outages = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
  ) {
    super();
  }

  /** Toutes les alertes, les plus recentes en tete. */
  list(): WatchAlert[] {
    return [...this.alerts];
  }

  /** Nombre d'alertes non acquittees. */
  get pending(): number {
    return this.alerts.filter((alert) => !alert.acknowledged).length;
  }

  /** Acquitte toutes les alertes. */
  acknowledgeAll(): void {
    this.alerts = this.alerts.map((alert) => ({ ...alert, acknowledged: true }));
    this.emit('changed');
  }

  /** Nombre d'interruptions observees pour un chemin. */
  outagesFor(path: string): number {
    return this.outages.get(path) ?? 0;
  }

  /** Remet les compteurs a zero. */
  reset(): void {
    this.alerts = [];
    this.outages.clear();
    this.emit('changed');
  }

  private push(alert: Omit<WatchAlert, 'id' | 'at' | 'acknowledged'>): void {
    const entry: WatchAlert = { ...alert, id: crypto.randomBytes(4).toString('hex'), at: Date.now(), acknowledged: false };
    this.alerts = [entry, ...this.alerts].slice(0, MAX_ALERTS);
    this.logger.info('watch', alert.message);
    this.emit('alert', entry);
    this.emit('changed');
  }

  /**
   * Analyse l'etat courant des flux et produit les alertes necessaires.
   *
   * Appelee a chaque rafraichissement : elle compare a l'etat precedent, donc
   * une camera qui se deconnecte puis revient produit exactement deux alertes.
   */
  inspect(streams: WatchedStream[]): void {
    const config = this.settings.get().watch;
    if (!config.enabled) return;

    const now = Date.now();
    const seen = new Set<string>();

    for (const stream of streams) {
      seen.add(stream.path);
      const before = this.previous.get(stream.path);

      // --- Connexion / deconnexion ---
      if (before && before.publishing && !stream.publishing) {
        this.outages.set(stream.path, this.outagesFor(stream.path) + 1);
        this.push({
          path: stream.path,
          name: stream.name,
          kind: 'offline',
          message: `Le flux « ${stream.name} » s'est deconnecte.`,
        });
        // Une deconnexion remet le compteur de debit bas a zero.
        this.lowSince.delete(stream.path);
        this.lowAlerted.delete(stream.path);
      } else if (before && !before.publishing && stream.publishing) {
        this.push({
          path: stream.path,
          name: stream.name,
          kind: 'online',
          message: `Le flux « ${stream.name} » est revenu.`,
        });
      }

      // --- Debit trop bas ---
      // On ne signale qu'un flux qui publie : un flux arrete n'a pas un debit
      // faible, il n'a pas de debit du tout.
      if (stream.publishing && config.lowBitrateKbps > 0) {
        if (stream.bitrateKbps > 0 && stream.bitrateKbps < config.lowBitrateKbps) {
          const since = this.lowSince.get(stream.path) ?? now;
          this.lowSince.set(stream.path, since);
          const elapsed = (now - since) / 1000;
          if (elapsed >= config.lowBitrateSeconds && !this.lowAlerted.has(stream.path)) {
            this.lowAlerted.add(stream.path);
            this.push({
              path: stream.path,
              name: stream.name,
              kind: 'low-bitrate',
              message: `Le debit de « ${stream.name} » est bas (${Math.round(stream.bitrateKbps)} kbit/s).`,
            });
          }
        } else {
          // Debit revenu a la normale.
          if (this.lowAlerted.has(stream.path)) {
            this.lowAlerted.delete(stream.path);
            this.push({
              path: stream.path,
              name: stream.name,
              kind: 'recovered',
              message: `Le debit de « ${stream.name} » est revenu a la normale.`,
            });
          }
          this.lowSince.delete(stream.path);
        }
      }

      this.previous.set(stream.path, { publishing: stream.publishing, name: stream.name });
    }

    // Les flux disparus de la liste comptent comme deconnectes.
    for (const [path, state] of this.previous) {
      if (seen.has(path) || !state.publishing) continue;
      this.outages.set(path, this.outagesFor(path) + 1);
      this.push({
        path,
        name: state.name,
        kind: 'offline',
        message: `Le flux « ${state.name} » n'est plus present.`,
      });
      this.previous.set(path, { publishing: false, name: state.name });
    }
  }
}
