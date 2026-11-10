/**
 * Replay instantane.
 *
 * Principe : MediaMTX enregistre chaque flux en continu dans un dossier de
 * tampon, avec des segments courts et une purge automatique. Le tampon ne
 * contient donc jamais que les dernieres secondes. « Sauvegarder le replay »
 * rassemble ces segments dans un fichier definitif, place avec les
 * enregistrements.
 *
 * Le tampon est en **MP4 fragmente** (fmp4), comme l'enregistrement direct, et
 * les segments sont rassembles par `fmp4.ts` : chaque fragment voit son temps de
 * decodage cumule et son numero de sequence reecrits. Une simple mise bout a
 * bout ne fonctionne pas (chaque segment redemarre son temps a zero, le lecteur
 * ne joue alors que le premier). Le resultat est un MP4 unique et lisible.
 *
 * Aucun outil externe n'est necessaire.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings, ReplayResult, ReplayState } from '../shared/types';
import type { Logger } from './logger';
import { resolveRecordingDir } from './recording';
import { concatFragmentedMp4Files } from './fmp4';

/** Duree d'un segment du tampon, en secondes. */
export const BUFFER_SEGMENT_SECONDS = 2;

/** Dossier du tampon de replay. */
export function replayBufferDir(configured: string): string {
  const trimmed = configured.trim();
  if (trimmed.length > 0) return trimmed;
  // Par defaut : un sous-dossier du rangement, a cote des enregistrements.
  return path.join(resolveRecordingDir(''), '..', 'replay-buffer');
}

/**
 * Dossier ou sont ecrits les replays sauvegardes.
 *
 * Configurable depuis les Parametres : l'operateur peut ainsi les ranger a
 * part des enregistrements.
 */
export function replayOutputDir(configured = ''): string {
  const trimmed = configured.trim();
  if (trimmed.length > 0) return trimmed;
  return path.join(resolveRecordingDir(''), 'replays');
}

/**
 * Options de chemin MediaMTX pour le tampon de replay.
 *
 * La duree de conservation vaut exactement la taille du tampon : MediaMTX
 * supprime donc les segments plus vieux que les dernieres secondes voulues.
 */
export function replayPathOptions(settings: AppSettings, streamPath: string): {
  record: boolean;
  recordPath: string;
  recordFormat: string;
  recordSegmentDuration: string;
  recordDeleteAfter: string;
} {
  const dir = replayBufferDir(settings.replay.path).replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    record: settings.replay.enabled,
    recordPath: `${dir}/%path/%Y-%m-%d_%H-%M-%S-%f`,
    // fmp4 : les segments sont du MP4 fragmente, rassembles par `fmp4.ts` en un
    // MP4 unique. Le format mpegts produirait des .ts, alors que l'utilisateur
    // veut du MP4 partout.
    recordFormat: 'fmp4',
    recordSegmentDuration: `${BUFFER_SEGMENT_SECONDS}s`,
    recordDeleteAfter: `${settings.replay.bufferSeconds}s`,
  };
}

/** Segments du tampon pour un flux, du plus ancien au plus recent. */
export async function listBufferSegments(configured: string, streamPath: string): Promise<string[]> {
  const dir = path.join(replayBufferDir(configured), streamPath);
  try {
    const entries = await fs.readdir(dir);
    return entries
      // `.mp4` (fmp4, format courant) et `.ts` (anciens tampons mpegts, encore
      // lus pour ne pas perdre un replay deja en place au moment de la mise a
      // jour). Les deux se concatenent : fmp4 par `fmp4.ts`, ts brut.
      .filter((name) => name.endsWith('.mp4') || name.endsWith('.ts'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/** Duree disponible dans le tampon, estimee d'apres le nombre de segments. */
export async function bufferSeconds(configured: string, streamPath: string): Promise<number> {
  const segments = await listBufferSegments(configured, streamPath);
  return segments.length * BUFFER_SEGMENT_SECONDS;
}

/**
 * Options de sauvegarde d'un replay.
 *
 * `fromSeconds` et `toSeconds` expriment la plage a recuperer, comptee depuis
 * la fin du flux : 0 = la toute derniere seconde. Par exemple
 * `{ fromSeconds: 30, toSeconds: 0 }` recupere les 30 dernieres secondes.
 * Absents, toute la memoire disponible est sauvegardee.
 */
export interface SaveReplayOptions {
  fromSeconds?: number;
  toSeconds?: number;
}

/**
 * Sauvegarde une plage du tampon dans un fichier MP4 definitif.
 *
 * Les segments fMP4 sont rassembles par `fmp4.ts`, qui cumule les temps de
 * decodage et reecrit les numeros de sequence : le fichier obtenu est un MP4
 * unique et lisible, sans reencodage ni outil externe.
 *
 * La duree demandee est bornee par la memoire configurable : un replay plus
 * long que la memoire est refuse, avec un message clair.
 */
export async function saveReplay(
  settings: AppSettings,
  streamPath: string,
  streamName: string,
  logger: Logger,
  options: SaveReplayOptions = {},
): Promise<ReplayResult> {
  const bufferLimit = settings.replay.bufferSeconds;
  const minimum = settings.replay.minimumSeconds;

  const segments = await listBufferSegments(settings.replay.path, streamPath);
  const available = segments.length * BUFFER_SEGMENT_SECONDS;

  if (segments.length === 0) {
    logger.warn('replay', `Aucun segment en tampon pour /${streamPath}.`);
    return { ok: false, message: 'Aucune video memorisee pour le moment. Patientez quelques secondes.' };
  }

  // Plage demandee, en secondes depuis la fin du flux. `to` ne peut pas
  // depasser `from`.
  const requestedFrom = options.fromSeconds ?? available;
  const requestedTo = options.toSeconds ?? 0;
  const from = Math.max(0, Math.min(requestedFrom, bufferLimit));
  const to = Math.max(0, Math.min(requestedTo, from));
  const wanted = from - to;

  if (requestedFrom > bufferLimit) {
    return {
      ok: false,
      message: `La memoire est de ${bufferLimit} s : un replay au-dela n'est pas possible. Augmentez-la dans les Parametres.`,
    };
  }
  if (wanted < minimum) {
    return {
      ok: false,
      message: `Un replay doit durer au moins ${minimum} s. Demande : ${wanted} s.`,
    };
  }
  if (available < minimum) {
    return {
      ok: false,
      message: `Le flux n'a publie que ${available} s. Attendez au moins ${minimum} s avant de recuperer un replay.`,
    };
  }

  // On ne garde que les segments concernes : le plus recent est ecarte (il est
  // encore en cours d'ecriture), puis on compte depuis la fin.
  const usable = segments.slice(0, -1);
  const fromEnd = Math.max(1, Math.round(from / BUFFER_SEGMENT_SECONDS));
  const toEnd = Math.round(to / BUFFER_SEGMENT_SECONDS);
  const start = Math.max(0, usable.length - fromEnd);
  const end = Math.max(start + 1, usable.length - toEnd);
  const selected = usable.slice(start, end);

  if (selected.length === 0) {
    return { ok: false, message: 'La plage demandee est vide.' };
  }

  const output = replayOutputDir(settings.replay.outputPath);
  await fs.mkdir(output, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const safeName = streamName.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || streamPath;
  const target = path.join(output, `${safeName}_${stamp}.mp4`);

  // On assemble dans un fichier temporaire puis on renomme : un replay a moitie
  // ecrit ne doit jamais apparaitre comme un fichier valide.
  const temporary = `${target}.part`;
  const written = await concatFragmentedMp4Files(selected, temporary);
  if (!written) {
    await fs.rm(temporary, { force: true });
    logger.warn('replay', `Segments illisibles pour /${streamPath}.`);
    return { ok: false, message: 'Les segments memorises sont illisibles.' };
  }
  await fs.rename(temporary, target);

  const seconds = selected.length * BUFFER_SEGMENT_SECONDS;
  logger.info('replay', `Replay sauvegarde : ${target} (${seconds} s, ${selected.length} segments).`);
  return { ok: true, file: target, seconds, message: `Replay sauvegarde (${seconds} s).` };
}

/** Etat du replay pour un flux. */
export async function replayState(
  configured: string,
  streamPath: string,
  minimumSeconds = 30,
): Promise<ReplayState> {
  const seconds = await bufferSeconds(configured, streamPath);
  return { active: seconds > 0, availableSeconds: seconds, ready: seconds >= minimumSeconds };
}
