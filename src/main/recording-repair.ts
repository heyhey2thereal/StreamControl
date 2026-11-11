/**
 * Repare les durees de l'en-tete des enregistrements directs.
 *
 * MediaMTX ecrit ses enregistrements (format fmp4) avec un en-tete dont `tkhd`
 * et `mdhd` annoncent **zero** : les lecteurs de Windows affichent alors
 * « 00:00 » comme duree, alors que la lecture continue. On reecrit cet en-tete
 * avec la duree reelle, lue dans les fragments.
 *
 * La reparation ne touche **jamais** le fichier en cours d'ecriture : on
 * n'examine que les fichiers dont la derniere modification remonte a plus de
 * quelques secondes. Un segment clos est donc repare peu apres sa fermeture,
 * sans risque de course avec MediaMTX.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';
import { repairFmp4HeaderDurations } from './fmp4';

/** Delai minimal depuis la derniere ecriture, avant de reparer un fichier. */
const QUIET_MS = 15000;

export class RecordingRepairer {
  /** Fichiers deja repares, pour ne pas relire un gros fichier a chaque passage. */
  private readonly repaired = new Set<string>();

  constructor(
    private readonly logger: Logger,
    /** Dossier des enregistrements (deja resolu). */
    private readonly getDirectory: () => string,
  ) {}

  /**
   * Parcourt les enregistrements et repare ceux qui sont clos.
   *
   * @returns le nombre de fichiers repares.
   */
  async sweep(): Promise<number> {
    const root = this.getDirectory();
    let files: string[];
    try {
      files = await this.collect(root);
    } catch {
      return 0;
    }

    let repaired = 0;
    const now = Date.now();
    for (const file of files) {
      if (this.repaired.has(file)) continue;
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      // Fichier encore en cours d'ecriture : on attend qu'il se taise.
      if (now - stat.mtimeMs < QUIET_MS) continue;
      if (repairFmp4HeaderDurations(file)) {
        repaired += 1;
        this.repaired.add(file);
      }
    }
    if (repaired > 0) {
      this.logger.info('recording', `${repaired} enregistrement(s) repare(s) (duree du lecteur).`);
    }
    return repaired;
  }

  /** Liste recursive des fichiers `.mp4` sous un dossier. */
  private async collect(directory: string): Promise<string[]> {
    const found: string[] = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await this.collect(full)));
      } else if (entry.isFile() && entry.name.endsWith('.mp4')) {
        found.push(full);
      }
    }
    return found;
  }
}
