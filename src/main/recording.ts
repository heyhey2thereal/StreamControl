/**
 * Enregistrement des flux, pilote par MediaMTX.
 *
 * L'enregistrement est confie a MediaMTX, pas a OBS : chaque chemin de flux a
 * son propre reglage `record`, et MediaMTX ecrit un fichier par flux. Plusieurs
 * flux peuvent donc etre enregistres en parallele, chacun independamment, et
 * l'enregistrement fonctionne meme sans OBS.
 *
 * Le dossier est celui des parametres (`recording.path`), sinon un sous-dossier
 * `recordings` du dossier de rangement : c'est celui que « Ouvrir le dossier »
 * ouvre depuis les Parametres.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/types';
import type { Logger } from './logger';
import { defaultStorageDir } from './storage';

/**
 * Dossier d'enregistrement par defaut.
 *
 * Il vit DANS le dossier de rangement : c'est celui que « Ouvrir le dossier »
 * ouvre depuis les Parametres. Un dossier separe donnait l'impression que rien
 * n'avait ete enregistre, alors que les fichiers existaient ailleurs.
 */
export function defaultRecordingDir(): string {
  return path.join(defaultStorageDir(), 'recordings');
}

/** Resout le dossier d'enregistrement effectif. */
export function resolveRecordingDir(configured: string): string {
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : defaultRecordingDir();
}

/**
 * Construit le modele de chemin de MediaMTX pour un flux.
 *
 * MediaMTX impose que `recordPath` contienne `%path` : c'est ce marqueur qu'il
 * remplace par le nom du chemin. On ecrit donc `<dossier>/%path/...`, ce qui
 * range naturellement chaque flux dans son propre sous-dossier.
 *
 * Le separateur est toujours `/` : MediaMTX le comprend sur toutes les
 * plateformes, et un chemin Windows (`C:\...`) reste valide.
 */
export function recordingPathTemplate(recordingDir: string, _streamPath: string): string {
  const base = recordingDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/%path/%Y-%m-%d_%H-%M-%S-%f`;
}

/** Options de chemin envoyees a l'API MediaMTX pour un flux. */
export interface PathRecordingOptions {
  record: boolean;
  recordPath: string;
  recordFormat: string;
  recordSegmentDuration: string;
  recordDeleteAfter: string;
}

/** Duree de conservation au format MediaMTX, ou vide pour conserver toujours. */
function retainDuration(hours: number): string {
  return hours > 0 ? `${hours}h` : '0s';
}

/**
 * Traduit les reglages d'enregistrement en options de chemin MediaMTX.
 * @param record vrai pour activer l'enregistrement sur ce chemin.
 */
export function buildPathOptions(
  settings: AppSettings,
  streamPath: string,
  record: boolean,
): PathRecordingOptions {
  const { recording } = settings;
  const dir = resolveRecordingDir(recording.path);
  return {
    record,
    recordPath: recordingPathTemplate(dir, streamPath),
    recordFormat: recording.format,
    recordSegmentDuration: `${recording.segmentMinutes}m`,
    recordDeleteAfter: retainDuration(recording.retainHours),
  };
}

/** Cree le dossier d'enregistrement au besoin, et dit s'il est accessible. */
export async function ensureRecordingDir(
  configured: string,
  logger: Logger,
): Promise<{ ok: boolean; directory: string; message?: string }> {
  const directory = resolveRecordingDir(configured);
  try {
    await fs.mkdir(directory, { recursive: true });
    return { ok: true, directory };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('recording', `Dossier d'enregistrement inaccessible (${directory}) : ${message}`);
    return { ok: false, directory, message };
  }
}

/**
 * Verifie que le dossier d'enregistrement est accessible en ecriture.
 * Un test d'ecriture est plus fiable qu'un simple `access` : il detecte un
 * disque plein ou un dossier en lecture seule.
 */
export async function probeRecordingDir(configured: string): Promise<{ ok: boolean; directory: string; message: string }> {
  const directory = resolveRecordingDir(configured);
  try {
    await fs.mkdir(directory, { recursive: true });
    const probe = path.join(directory, `.streamcontrol-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.rm(probe, { force: true });
    return { ok: true, directory, message: directory };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, directory, message };
  }
}

/** Taille totale et nombre de fichiers d'un dossier, sans recursivite profonde. */
export async function describeRecordingDir(
  configured: string,
): Promise<{ directory: string; files: number; bytes: number }> {
  const directory = resolveRecordingDir(configured);
  let files = 0;
  let bytes = 0;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nested = await describeRecordingDir(path.join(directory, entry.name));
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        files += 1;
        try {
          bytes += (await fs.stat(path.join(directory, entry.name))).size;
        } catch {
          // Fichier disparu entre le listage et la lecture : on l'ignore.
        }
      }
    }
  } catch {
    // Dossier absent : il sera cree au premier enregistrement.
  }
  return { directory, files, bytes };
}
