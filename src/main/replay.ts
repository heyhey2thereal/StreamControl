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
import os from 'node:os';
import path from 'node:path';
import type { AppSettings, ReplayResult, ReplayState } from '../shared/types';
import type { Logger } from './logger';
import { resolveRecordingDir } from './recording';
import { concatFragmentedMp4Files, fmp4SegmentSeconds } from './fmp4';

/**
 * Duree supposee d'un segment, en secondes.
 *
 * Sert uniquement de repli quand la duree reelle n'est pas lisible (anciens
 * segments `.ts`, ou segment tronque). La duree reelle, elle, vient de
 * `fmp4SegmentSeconds` : MediaMTX aligne ses segments sur le GOP de la source,
 * si bien qu'un segment ne dure presque jamais exactement cette valeur.
 */
export const BUFFER_SEGMENT_SECONDS = 2;

/** Prefixe lu pour estimer la duree d'un segment, avant de lire le fichier entier. */
const SEGMENT_HEAD_BYTES = 256 * 1024;

/** Nom de dossier lisible et sur, a partir du nom du flux. */
function safeName(name: string, streamPath: string): string {
  const cleaned = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || streamPath;
}

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

/** Un segment du tampon et sa duree reelle, en secondes. */
export interface BufferSegment {
  file: string;
  seconds: number;
}

/**
 * Duree d'un segment, en secondes.
 *
 * On lit l'en-tete du fichier (jamais tout le fichier : un segment peut peser
 * plusieurs Mo) et on demande sa duree reelle a `fmp4SegmentSeconds`. Un ancien
 * segment `.ts`, ou un fichier tronque, retombe sur la duree supposee.
 */
async function segmentDuration(file: string): Promise<number> {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const size = (await handle.stat()).size;
      const length = Math.min(size, SEGMENT_HEAD_BYTES);
      const head = Buffer.alloc(length);
      await handle.read(head, 0, length, 0);
      const seconds = fmp4SegmentSeconds(head);
      return seconds > 0 ? seconds : BUFFER_SEGMENT_SECONDS;
    } finally {
      await handle.close();
    }
  } catch {
    // Segment disparu (purge du tampon) : on ne bloque pas le reste.
    return BUFFER_SEGMENT_SECONDS;
  }
}

/** Segments du tampon avec leur duree reelle, du plus ancien au plus recent. */
export async function segmentDurations(configured: string, streamPath: string): Promise<BufferSegment[]> {
  const files = await listBufferSegments(configured, streamPath);
  const segments: BufferSegment[] = [];
  for (const file of files) {
    segments.push({ file, seconds: await segmentDuration(file) });
  }
  return segments;
}

/**
 * Selectionne les segments couvrant une plage, comptee depuis la fin du flux.
 *
 * @param segments segments du plus ancien au plus recent.
 * @param fromSeconds debut de la plage, en secondes en arriere (0 = la fin).
 * @param toSeconds fin de la plage, en secondes en arriere.
 * @returns les segments dont l'intervalle de temps chevauche la plage.
 */
export function selectSegments(
  segments: BufferSegment[],
  fromSeconds: number,
  toSeconds: number,
): BufferSegment[] {
  const total = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const startTime = Math.max(0, total - fromSeconds);
  const endTime = Math.max(0, total - toSeconds);

  const selected: BufferSegment[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.seconds;
    cursor = segmentEnd;
    // Chevauchement avec [startTime, endTime).
    if (segmentEnd <= startTime || segmentStart >= endTime) continue;
    selected.push(segment);
  }
  return selected;
}

/** Duree disponible dans le tampon, d'apres la duree reelle des segments. */
export async function bufferSeconds(configured: string, streamPath: string): Promise<number> {
  const segments = await segmentDurations(configured, streamPath);
  return segments.reduce((sum, segment) => sum + segment.seconds, 0);
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

/** Resultat de la preparation d'un replay : segments choisis, ou refus. */
export interface ReplayPlan {
  ok: boolean;
  /** Segments a assembler, du plus ancien au plus recent. */
  selected: BufferSegment[];
  /** Duree totale des segments choisis, en secondes. */
  seconds: number;
  /** Message lisible (succes ou raison du refus). */
  message: string;
}

/** Replay assemble dans un fichier temporaire, pret a etre telecharge. */
export interface ReplayBuild {
  ok: boolean;
  /** Fichier temporaire a telecharger, puis a supprimer. */
  file?: string;
  /** Duree du replay, en secondes. */
  seconds?: number;
  /** Message lisible (succes ou raison du refus). */
  message: string;
}

/**
 * Verifie une demande de replay et choisit les segments a assembler.
 *
 * La duree demandee est bornee par la memoire configurable : un replay plus
 * long que la memoire, ou plus court que le minimum, est refuse avec un message
 * clair. Le segment le plus recent est ecarte : MediaMTX est en train de
 * l'ecrire, et le lire maintenant donnerait un fichier corrompu.
 */
export async function planReplay(
  settings: AppSettings,
  streamPath: string,
  options: SaveReplayOptions = {},
): Promise<ReplayPlan> {
  const bufferLimit = settings.replay.bufferSeconds;
  const minimum = settings.replay.minimumSeconds;

  const segments = await segmentDurations(settings.replay.path, streamPath);
  const available = segments.reduce((sum, segment) => sum + segment.seconds, 0);

  if (segments.length === 0) {
    return { ok: false, selected: [], seconds: 0, message: 'Aucune video memorisee pour le moment. Patientez quelques secondes.' };
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
      selected: [],
      seconds: 0,
      message: `La memoire est de ${bufferLimit} s : un replay au-dela n'est pas possible. Augmentez-la dans les Parametres.`,
    };
  }
  if (wanted < minimum) {
    return { ok: false, selected: [], seconds: 0, message: `Un replay doit durer au moins ${minimum} s. Demande : ${wanted} s.` };
  }
  if (available < minimum) {
    return {
      ok: false,
      selected: [],
      seconds: 0,
      message: `Le flux n'a publie que ${Math.round(available)} s. Attendez au moins ${minimum} s avant de recuperer un replay.`,
    };
  }

  const usable = segments.slice(0, -1);
  if (usable.length === 0) {
    return { ok: false, selected: [], seconds: 0, message: 'Le flux vient de demarrer : patientez quelques secondes.' };
  }

  const selected = selectSegments(usable, from, to);
  if (selected.length === 0) {
    return { ok: false, selected: [], seconds: 0, message: 'La plage demandee est vide.' };
  }

  const seconds = Math.round(selected.reduce((sum, segment) => sum + segment.seconds, 0));
  return { ok: true, selected, seconds, message: `Replay (${seconds} s).` };
}

/**
 * Sauvegarde une plage du tampon dans un fichier MP4 definitif.
 *
 * Les segments fMP4 sont rassembles par `fmp4.ts`, qui cumule les temps de
 * decodage et reecrit les numeros de sequence : le fichier obtenu est un MP4
 * unique et lisible, sans reencodage ni outil externe.
 *
 * Le fichier est range dans un sous-dossier portant le nom du flux, sous le
 * dossier des replays : plusieurs flux restent ainsi ranges, comme les
 * enregistrements.
 */
export async function saveReplay(
  settings: AppSettings,
  streamPath: string,
  streamName: string,
  logger: Logger,
  options: SaveReplayOptions = {},
): Promise<ReplayResult> {
  const plan = await planReplay(settings, streamPath, options);
  if (!plan.ok) {
    logger.warn('replay', `Replay refuse pour /${streamPath} : ${plan.message}`);
    return { ok: false, message: plan.message };
  }

  const output = replayOutputDir(settings.replay.outputPath);
  const directory = path.join(output, safeName(streamName, streamPath));
  await fs.mkdir(directory, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const target = path.join(directory, `${stamp}.mp4`);

  // On assemble dans un fichier temporaire puis on renomme : un replay a moitie
  // ecrit ne doit jamais apparaitre comme un fichier valide.
  const temporary = `${target}.part`;
  const written = await concatFragmentedMp4Files(plan.selected.map((segment) => segment.file), temporary);
  if (!written) {
    await fs.rm(temporary, { force: true });
    logger.warn('replay', `Segments illisibles pour /${streamPath}.`);
    return { ok: false, message: 'Les segments memorises sont illisibles.' };
  }
  await fs.rename(temporary, target);

  logger.info('replay', `Replay sauvegarde : ${target} (${plan.seconds} s, ${plan.selected.length} segments).`);
  return { ok: true, file: target, seconds: plan.seconds, message: `Replay sauvegarde (${plan.seconds} s).` };
}

/**
 * Assemble un replay dans un fichier temporaire, pour un telechargement.
 *
 * C'est la variante du panneau distant : le fichier n'est PAS range avec les
 * enregistrements du poste, il est prepare dans un dossier temporaire que
 * l'appareil telecharge, puis supprime. Rien n'est ecrit sur le poste central.
 */
export async function buildReplay(
  settings: AppSettings,
  streamPath: string,
  logger: Logger,
  options: SaveReplayOptions = {},
): Promise<ReplayBuild> {
  const plan = await planReplay(settings, streamPath, options);
  if (!plan.ok) return { ok: false, message: plan.message };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'streamcontrol-replay-'));
  const target = path.join(directory, 'replay.mp4');
  const written = await concatFragmentedMp4Files(plan.selected.map((segment) => segment.file), target);
  if (!written) {
    await fs.rm(directory, { recursive: true, force: true });
    logger.warn('replay', `Segments illisibles pour /${streamPath}.`);
    return { ok: false, message: 'Les segments memorises sont illisibles.' };
  }

  logger.info('replay', `Replay prepare pour un appareil : ${target} (${plan.seconds} s).`);
  return { ok: true, file: target, seconds: plan.seconds, message: `Replay (${plan.seconds} s).` };
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
