/**
 * Analyse technique des flux.
 *
 * Une vue plus poussee que l'etat « en direct / hors ligne » : stabilite du
 * debit, resolution reelle, images par seconde mesurees, et historique des
 * coupures. Sert a diagnostiquer un flux qui semble fonctionner alors que
 * l'image saccade.
 *
 * Les mesures viennent du compteur d'octets recus de MediaMTX, echantillonne
 * a chaque rafraichissement : c'est la seule source fiable, le journal ne
 * dit qu'une publication a ete acceptee.
 */
import type { StreamDiagnostics, StreamStatus } from '../shared/types';

/** Un echantillon de debit, horodate. */
interface Sample {
  at: number;
  bytes: number;
}

/** Fenetre d'observation, en millisecondes. */
const WINDOW_MS = 30_000;

/** Nombre minimal d'echantillons pour juger la stabilite. */
const MIN_SAMPLES = 4;

/** Variation relative au-dela de laquelle un flux est juge instable. */
const JITTER_THRESHOLD = 0.35;

/** Construit les mesures d'un flux. */
export class DiagnosticsTracker {
  private readonly samples = new Map<string, Sample[]>();

  /** Enregistre un echantillon pour un flux. */
  observe(id: string, bytesReceived: number, now = Date.now()): void {
    const samples = this.samples.get(id) ?? [];
    samples.push({ at: now, bytes: bytesReceived });
    while (samples.length > 0 && now - samples[0].at > WINDOW_MS) samples.shift();
    this.samples.set(id, samples);
  }

  /** Oublie un flux (supprime ou renomme). */
  forget(id: string): void {
    this.samples.delete(id);
  }

  /**
   * Calcule les mesures d'un flux a partir de ses echantillons.
   *
   * @param status etat courant du flux, pour la resolution et la duree.
   * @param outages nombre de coupures observees par la surveillance.
   * @param replaySeconds duree du tampon de replay disponible.
   */
  build(
    status: StreamStatus,
    name: string,
    path: string,
    outages: number,
    replaySeconds: number,
  ): StreamDiagnostics {
    const samples = this.samples.get(status.id) ?? [];

    // Debits instantanes entre echantillons successifs.
    const rates: number[] = [];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const seconds = (current.at - previous.at) / 1000;
      const delta = current.bytes - previous.bytes;
      if (seconds > 0.2 && delta >= 0) rates.push((delta * 8) / seconds / 1000);
    }

    const bitrateKbps = rates.length > 0
      ? rates.reduce((sum, value) => sum + value, 0) / rates.length
      : status.bitrateKbps;

    const minBitrateKbps = rates.length > 0 ? Math.min(...rates) : bitrateKbps;
    const maxBitrateKbps = rates.length > 0 ? Math.max(...rates) : bitrateKbps;

    // Ecart-type relatif : un flux stable garde un debit proche de sa moyenne.
    let jitter = 0;
    if (rates.length >= MIN_SAMPLES && bitrateKbps > 0) {
      const variance =
        rates.reduce((sum, value) => sum + (value - bitrateKbps) ** 2, 0) / rates.length;
      jitter = Math.sqrt(variance) / bitrateKbps;
    }

    const measuredFps = this.measureFps(samples);
    const sessionSeconds = status.startedAt
      ? Math.max(0, Math.round((Date.now() - status.startedAt) / 1000))
      : 0;

    return {
      id: status.id,
      name,
      path,
      publishing: status.publishing,
      width: status.videoWidth,
      height: status.videoHeight,
      measuredFps,
      bitrateKbps: Math.round(bitrateKbps),
      minBitrateKbps: Math.round(minBitrateKbps),
      maxBitrateKbps: Math.round(maxBitrateKbps),
      bitrateJitter: Number(jitter.toFixed(3)),
      stable: rates.length < MIN_SAMPLES || jitter <= JITTER_THRESHOLD,
      outages,
      sessionSeconds,
      replaySeconds,
    };
  }

  /**
   * Estime les images par seconde.
   *
   * MediaMTX ne les expose pas directement. On ne peut donc pas les mesurer
   * exactement ; on retourne 0, et l'interface affiche « -- ». Mieux vaut ne
   * rien dire qu'annoncer un chiffre invente.
   */
  private measureFps(_samples: Sample[]): number {
    return 0;
  }
}
