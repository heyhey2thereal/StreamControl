/**
 * Capture d'un flux : enregistrement permanent, par flux.
 *
 * MediaMTX n'a qu'UN seul reglage `record` par chemin. Quand le replay
 * instantane est actif, ce reglage sert au tampon roulant : il n'est donc plus
 * disponible pour un enregistrement a la demande.
 *
 * La capture resout ce conflit sans toucher a MediaMTX : elle suit le tampon
 * et assemble chaque nouveau segment dans un fichier definitif, tant que
 * l'utilisateur n'a pas arrete. Le tampon reste court (quelques secondes), et
 * les segments sont petits : le traitement est immediat.
 *
 * L'assemblage se fait **fragment par fragment** (`moof`+`mdat`), des qu'un
 * fragment est complet : l'enregistrement commence donc tout de suite, et
 * s'arrete tout de suite, sans attendre la fin du segment en cours. Le fichier
 * produit est un **MP4** lisible, duree corrigee (voir `fmp4.ts`).
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';
import { listBufferSegments, replayBufferDir, replayOutputDir } from './replay';
import { createFmp4Writer, fmp4Append, fmp4Finalize, lastCompleteFragmentEnd, type Fmp4WriterState } from './fmp4';

/**
 * Intervalle de surveillance du tampon, en millisecondes.
 *
 * Court volontairement : c'est lui qui borne le retard entre le clic et le
 * debut reel de l'ecriture (et inversement a l'arret). Un cycle long ferait
 * perdre une seconde au demarrage et a la coupure.
 */
const POLL_MS = 200;

/** Une capture en cours pour un flux. */
interface Capture {
  streamId: string;
  streamPath: string;
  /** Fichier definitif en cours d'ecriture. */
  target: string;
  /**
   * Position deja traitee dans chaque segment, par nom de fichier.
   *
   * Un segment est lu **en plusieurs fois** : on n'ecrit que les fragments
   * complets, puis on reprend la ou on s'etait arrete. C'est ce qui permet de
   * demarrer sans attendre la fin du segment, et de ne rien perdre.
   */
  offsets: Map<string, number>;
  /** Handle du fichier ouvert en ajout. */
  handle: fs.FileHandle | null;
  /** Etat d'assemblage fMP4 (numero de sequence, temps cumule). */
  writer: Fmp4WriterState;
  timer: NodeJS.Timeout | null;
  startedAt: number;
  bytes: number;
  /** Vrai pendant un passage : evite deux traitements concurrents. */
  draining: boolean;
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
   * Fichier en cours d'ecriture pour un flux, si une capture tourne.
   *
   * Sert a l'interface : elle montre le fichier reellement produit, et l'ouvre
   * d'un clic. Sans cela, avec le replay actif, l'interface n'avait aucun
   * chemin a afficher (MediaMTX ne connait que le tampon) et semblait montrer
   * un ancien enregistrement.
   */
  currentFile(streamId: string): string | undefined {
    return this.captures.get(streamId)?.target;
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
    const target = path.join(output, `${safeName(streamName, streamPath)}_${stamp()}.mp4`);

    const capture: Capture = {
      streamId,
      streamPath,
      target,
      offsets: new Map(),
      handle: await fs.open(target, 'w'),
      writer: createFmp4Writer(),
      timer: null,
      startedAt: Date.now(),
      bytes: 0,
      draining: false,
    };

    // On reprend chaque segment existant **sur une frontiere de fragment** :
    // tout ce qui precede est deja ecrit et clos. Le prochain fragment complet
    // (moins d'une seconde plus tard, avec des parties de 200 ms) est le premier
    // enregistre : le demarrage est quasi immediat, et il n'inclut pas les
    // secondes de tampon qui precedent le clic.
    for (const segment of await listBufferSegments(this.getBufferDir(), streamPath)) {
      try {
        const size = (await fs.stat(segment)).size;
        const head = Buffer.alloc(Math.min(size, 512 * 1024));
        const handle = await fs.open(segment, 'r');
        try {
          await handle.read(head, 0, head.length, 0);
        } finally {
          await handle.close();
        }
        capture.offsets.set(path.basename(segment), Math.max(lastCompleteFragmentEnd(head), 0));
      } catch {
        capture.offsets.set(path.basename(segment), 0);
      }
    }

    this.captures.set(streamId, capture);
    // Un premier passage immediat : l'ecriture commence sans attendre un cycle.
    await this.drain(capture);
    capture.timer = setInterval(() => void this.drain(capture), POLL_MS);
    capture.timer.unref?.();

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

    // Dernier passage immediat : on ecrit tous les fragments complets depuis le
    // cycle precedent. On n'attend PAS le fragment en cours (il se clora 200 ms
    // plus tard) : l'attendre ferait enregistrer du son et de l'image apres le
    // clic d'arret. On perd donc au plus un fragment (200 ms), jamais une
    // seconde, et la coupure est immediate.
    await this.drain(capture);
    // La duree totale n'est connue qu'ici : on corrige l'en-tete deja ecrit,
    // sinon le lecteur annonce « 0:00 » comme duree du fichier.
    if (capture.handle && capture.writer.initMoov) {
      fmp4Finalize(capture.writer);
      await capture.handle.write(capture.writer.initMoov, 0, capture.writer.initMoov.length, capture.writer.initOffset);
    }
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
   * Ajoute au fichier definitif les fragments completes depuis le dernier cycle.
   *
   * Chaque segment est lu **a partir de la position deja traitee** : on ecrit
   * les paires `moof`+`mdat` completes, puis on s'arrete des qu'une paire est
   * incomplete (le `mdat` du dernier fragment est encore en cours d'ecriture).
   * Le segment n'est donc jamais attendu en entier : l'enregistrement commence
   * et s'arrete sans delai, et rien n'est perdu — le reste sera lu au passage
   * suivant, y compris apres l'arret.
   *
   * `fmp4Append` garantit un seul en-tete d'initialisation, des temps de
   * decodage cumules et des numeros de sequence croissants.
   */
  private async drain(capture: Capture): Promise<void> {
    if (!capture.handle || capture.draining) return;
    capture.draining = true;
    try {
      const segments = await listBufferSegments(this.getBufferDir(), capture.streamPath);
      for (const segment of segments) {
        const name = path.basename(segment);
        const from = capture.offsets.get(name) ?? 0;
        let size: number;
        try {
          size = (await fs.stat(segment)).size;
        } catch {
          continue; // Segment purge entre le listage et la lecture.
        }
        if (size <= from) continue; // Rien de nouveau.

        let data: Buffer;
        try {
          const handle = await fs.open(segment, 'r');
          try {
            data = Buffer.alloc(size);
            await handle.read(data, 0, size, 0);
          } finally {
            await handle.close();
          }
        } catch {
          continue; // Segment disparu : on le reprendra s'il revient.
        }

        const result = fmp4Append(capture.writer, data, from);
        capture.offsets.set(name, result ? result.consumed : from);
        if (result && result.chunk.length > 0) {
          await capture.handle.write(result.chunk);
          capture.bytes += result.chunk.length;
        }
      }
    } finally {
      capture.draining = false;
    }
  }

  /** Duree de la capture en cours, en secondes. */
  elapsed(streamId: string): number {
    const capture = this.captures.get(streamId);
    return capture ? Math.round((Date.now() - capture.startedAt) / 1000) : 0;
  }
}

export { replayBufferDir, replayOutputDir };
