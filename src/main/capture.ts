/**
 * Capture d'un flux : enregistrement permanent, par flux.
 *
 * MediaMTX n'a qu'UN seul reglage `record` par chemin. Quand le replay
 * instantane est actif, ce reglage sert au tampon roulant : il n'est donc plus
 * disponible pour un enregistrement a la demande.
 *
 * La capture resout ce conflit sans toucher a MediaMTX : elle suit le tampon
 * et recopie chaque nouveau segment dans un fichier definitif, tant que
 * l'utilisateur n'a pas arrete. Le tampon reste court (quelques secondes), et
 * les segments sont petits : la copie est immediate.
 *
 * Le fichier produit est du MPEG-TS mis bout a bout : la timeline reste
 * continue, contrairement au MP4 fragmente.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';
import { listBufferSegments, replayBufferDir, replayOutputDir } from './replay';

/** Intervalle de surveillance du tampon, en millisecondes. */
const POLL_MS = 1000;

/** Une capture en cours pour un flux. */
interface Capture {
  streamId: string;
  streamPath: string;
  /** Fichier definitif en cours d'ecriture. */
  target: string;
  /** Segments deja recopies (par nom), pour ne jamais ecrire deux fois. */
  copied: Set<string>;
  /** Handle du fichier ouvert en ajout. */
  handle: fs.FileHandle | null;
  timer: NodeJS.Timeout | null;
  startedAt: number;
  bytes: number;
}

/** Nom de fichier lisible, a partir du nom du flux. */
function safeName(name: string, path: string): string {
  const cleaned = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || path;
}

/** Horodatage compact, pour le nom du fichier. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

export class CaptureManager extends EventEmitter {
  private readonly captures = new Map<string, Capture>();

  constructor(
    private readonly logger: Logger,
    /** Dossier du tampon, selon les reglages courants. */
    private readonly getBufferDir: () => string,
    /** Dossier des enregistrements definitifs. */
    private readonly getOutputDir: () => string,
  ) {
    super();
  }

  /** Vrai si ce flux est en cours de capture. */
  isCapturing(streamId: string): boolean {
    return this.captures.has(streamId);
  }

  /** Flux actuellement captures. */
  list(): string[] {
    return [...this.captures.keys()];
  }

  /** Octets ecrits pour une capture, si elle existe. */
  bytesFor(streamId: string): number {
    return this.captures.get(streamId)?.bytes ?? 0;
  }

  /**
   * Demarre une capture pour un flux.
   *
   * @returns le chemin du fichier en cours d'ecriture.
   */
  async start(streamId: string, streamPath: string, streamName: string): Promise<string> {
    const existing = this.captures.get(streamId);
    if (existing) return existing.target;

    const output = path.join(this.getOutputDir(), 'captures');
    await fs.mkdir(output, { recursive: true });
    const target = path.join(output, `${safeName(streamName, streamPath)}_${stamp()}.ts`);

    const capture: Capture = {
      streamId,
      streamPath,
      target,
      copied: new Set(),
      handle: await fs.open(target, 'w'),
      timer: null,
      startedAt: Date.now(),
      bytes: 0,
    };

    // On ignore le tampon deja present : « enregistrer » veut dire a partir de
    // maintenant. Le replay, lui, sert justement a recuperer le passe.
    for (const segment of await listBufferSegments(this.getBufferDir(), streamPath)) {
      capture.copied.add(path.basename(segment));
    }

    capture.timer = setInterval(() => void this.drain(capture), POLL_MS);
    capture.timer.unref?.();

    this.captures.set(streamId, capture);
    this.logger.info('capture', `Capture demarree : ${target}`);
    this.emit('changed');
    return target;
  }

  /**
   * Arrete une capture et finalise le fichier.
   *
   * @returns le chemin du fichier, ou null si aucune capture n'existait.
   */
  async stop(streamId: string): Promise<string | null> {
    const capture = this.captures.get(streamId);
    if (!capture) return null;

    if (capture.timer) clearInterval(capture.timer);
    capture.timer = null;

    // Dernier passage. Le segment en cours est volontairement ecarte : le flux
    // publie encore, donc MediaMTX est en train de l'ecrire. Le lire donnerait
    // un fichier corrompu. On perd au plus un segment (2 s), jamais l'integrite.
    await this.drain(capture);
    await capture.handle?.close();
    capture.handle = null;
    this.captures.delete(streamId);

    const seconds = Math.round((Date.now() - capture.startedAt) / 1000);
    this.logger.info(
      'capture',
      `Capture arretee : ${capture.target} (${seconds} s, ${Math.round(capture.bytes / 1e6)} Mo).`,
    );
    this.emit('changed');

    // Un fichier vide ne doit pas rester : il ferait croire a un enregistrement.
    if (capture.bytes === 0) {
      await fs.rm(capture.target, { force: true });
      return null;
    }
    return capture.target;
  }

  /** Arrete toutes les captures (fermeture de l'application). */
  async stopAll(): Promise<void> {
    for (const streamId of [...this.captures.keys()]) {
      await this.stop(streamId);
    }
  }

  /**
   * Copie les segments pas encore recopies dans le fichier definitif.
   *
   * Le segment le plus recent est ecarte : MediaMTX est en train de l'ecrire,
   * et le lire maintenant donnerait un fichier corrompu (macroblocs invalides).
   * Il sera copie au passage suivant, une fois clos.
   */
  private async drain(capture: Capture): Promise<void> {
    if (!capture.handle) return;
    const segments = await listBufferSegments(this.getBufferDir(), capture.streamPath);
    for (const segment of segments.slice(0, -1)) {
      const name = path.basename(segment);
      if (capture.copied.has(name)) continue;
      try {
        const data = await fs.readFile(segment);
        await capture.handle.write(data);
        capture.copied.add(name);
        capture.bytes += data.length;
      } catch {
        // Segment disparu entre le listage et la lecture : il sera repris au
        // prochain passage s'il est encore la, sinon tant pis.
      }
    }
  }

  /** Duree de la capture en cours, en secondes. */
  elapsed(streamId: string): number {
    const capture = this.captures.get(streamId);
    return capture ? Math.round((Date.now() - capture.startedAt) / 1000) : 0;
  }
}

export { replayBufferDir, replayOutputDir };
