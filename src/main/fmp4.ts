/**
 * Concatenation de segments MP4 fragmentes (fMP4) ecrits par MediaMTX.
 *
 * Chaque segment produit par MediaMTX est un fichier MP4 autonome : un en-tete
 * d'initialisation (`ftyp` + `moov`) suivi d'un fragment (`moof` + `mdat`).
 *
 * La mise bout a bout BRUTE de ces fichiers ne fonctionne pas. Chaque fragment
 * redemarre son temps de decodage (`tfdt`) a zero et reutilise le meme numero de
 * sequence (`mfhd`) : le lecteur croit que tous les fragments commencent au meme
 * instant et ne joue que le premier. Mesure sur six segments de 1 s : 25 images
 * jouees au lieu de 150, et une duree annoncee de 1 s au lieu de 6 s.
 *
 * On reconstruit donc un fichier valide : on garde l'en-tete du premier
 * segment, puis les fragments de TOUS les segments, en reecrivant le numero de
 * sequence et le temps de decodage cumule. Aucun reencodage : les octets video
 * sont recopies tels quels.
 */
import { promises as fs, readFileSync, writeFileSync } from 'node:fs';

/** Une boite MP4 : son type et sa position dans le tampon. */
interface Box {
  type: string;
  start: number;
  size: number;
}

/** Liste les boites de premier niveau entre `start` et `end`. */
function listBoxes(buffer: Buffer, start = 0, end = buffer.length): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      // Taille sur 64 bits, rare mais prevu par la specification.
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      // Jusqu'a la fin du conteneur.
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}

/** Enfants d'une boite, a partir de son en-tete. */
function childBoxes(buffer: Buffer, box: Box): Box[] {
  return listBoxes(buffer, box.start + 8, box.start + box.size);
}

/** Drapeaux (24 bits bas) d'une boite version + flags. */
function boxFlags(buffer: Buffer, start: number): number {
  return buffer.readUInt32BE(start + 8) & 0x00ffffff;
}

/**
 * Duree totale, en unites de la base de temps, portee par un `trun`.
 *
 * La duree de chaque image vient du champ `sample_duration` (drapeau 0x000100)
 * ou, a defaut, de la valeur par defaut du `tfhd`. Les deux cas sont couverts :
 * s'appuyer sur la seule duree de segment configuree donnerait un temps faux
 * des que MediaMTX decoupe differemment.
 */
function trunDuration(buffer: Buffer, box: Box, defaultDuration: number): bigint {
  const flags = boxFlags(buffer, box.start);
  const sampleCount = buffer.readUInt32BE(box.start + 12);
  let offset = box.start + 16;
  if (flags & 0x000001) offset += 4; // data_offset
  if (flags & 0x000004) offset += 4; // first_sample_flags

  const hasDuration = (flags & 0x000100) !== 0;
  const hasSize = (flags & 0x000200) !== 0;
  const hasFlags = (flags & 0x000400) !== 0;
  const hasOffset = (flags & 0x000800) !== 0;

  let total = 0n;
  for (let index = 0; index < sampleCount; index += 1) {
    if (hasDuration) {
      if (offset + 4 > box.start + box.size) break;
      total += BigInt(buffer.readUInt32BE(offset));
      offset += 4;
    } else {
      total += BigInt(defaultDuration);
    }
    if (hasSize) offset += 4;
    if (hasFlags) offset += 4;
    if (hasOffset) offset += 4;
  }
  return total;
}

/** Duree par defaut d'un `tfhd`, quand elle est presente. */
function tfhdDefaultDuration(buffer: Buffer, box: Box): number {
  const flags = boxFlags(buffer, box.start);
  let offset = box.start + 16; // version+flags (4) + track_ID (4)
  if (flags & 0x000001) offset += 8; // base_data_offset
  if (flags & 0x000002) offset += 4; // sample_description_index
  if (flags & 0x000008) return buffer.readUInt32BE(offset);
  return 0;
}

/** Identifiant de piste porte par un `tfhd`. */
function tfhdTrackId(buffer: Buffer, box: Box): number {
  return buffer.readUInt32BE(box.start + 12);
}

/** Boites conteneurs dans lesquelles on peut descendre sans risque. */
const CONTAINER_BOXES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'mvex', 'edts', 'dinf',
]);

/**
 * Cherche la premiere boite d'un type donne, en descendant les conteneurs.
 *
 * On ne descend que dans les boites conteneurs connues : lire `mdat` comme un
 * conteneur reviendrait a interpreter des donnees d'echantillons comme des
 * boites, et a tomber sur n'importe quoi.
 */
function findBox(buffer: Buffer, type: string, start = 0, end = buffer.length): Box | null {
  for (const box of listBoxes(buffer, start, end)) {
    if (box.type === type) return box;
    if (CONTAINER_BOXES.has(box.type)) {
      const nested = findBox(buffer, type, box.start + 8, box.start + box.size);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Base de temps (timescale) portee par un `mdhd`.
 *
 * Le champ est precede de l'en-tete (8), de `version` + `flags` (4) et des deux
 * dates (`creation_time`, `modification_time`), dont la taille depend de la
 * version : 4 octets en version 0, 8 en version 1. Lire directement a +12
 * tomberait donc sur `creation_time`, pas sur la base de temps.
 */
function mdhdTimescale(buffer: Buffer, mdhd: Box): number {
  const version = buffer.readUInt8(mdhd.start + 8);
  const dateSize = version === 1 ? 8 : 4;
  const offset = mdhd.start + 8 + 4 + 2 * dateSize;
  if (offset + 4 > mdhd.start + mdhd.size) return 0;
  return buffer.readUInt32BE(offset);
}

/** Identifiant de piste porte par un `tkhd`. */
function tkhdTrackId(buffer: Buffer, box: Box): number {
  const version = buffer.readUInt8(box.start + 8);
  const dateSize = version === 1 ? 8 : 4;
  return buffer.readUInt32BE(box.start + 8 + 4 + 2 * dateSize);
}

/**
 * Decalage du champ `duration` d'une boite a version + dates.
 *
 * `mvhd`, `tkhd` et `mdhd` partagent la meme trame : en-tete (8), version +
 * flags (4), deux dates (4 ou 8 octets selon la version), puis leurs champs
 * propres. Seul le nombre de champs intermediaires change.
 */
function durationOffset(buffer: Buffer, box: Box, extraFields: number): number {
  const version = buffer.readUInt8(box.start + 8);
  const dateSize = version === 1 ? 8 : 4;
  return box.start + 8 + 4 + 2 * dateSize + extraFields;
}

/** Ecrit une duree (4 ou 8 octets selon la version de la boite). */
function writeDuration(buffer: Buffer, offset: number, version: number, seconds: number, timescale: number): void {
  const units = Math.max(0, Math.round(seconds * timescale));
  if (version === 1) buffer.writeBigUInt64BE(BigInt(units), offset);
  else buffer.writeUInt32BE(units >>> 0, offset);
}

/**
 * Reecrit les durees de l'en-tete (`moov`) pour qu'elles decrivent le fichier
 * ENTIER.
 *
 * Chaque segment de MediaMTX porte un en-tete dont les durees decrivent ce seul
 * segment : `mvhd` annonce quelques secondes, et `tkhd` comme `mdhd` annoncent
 * ZERO (les durees reelles vivent dans les fragments). Un fichier obtenu par
 * mise bout a bout garde donc cet en-tete : le lecteur affiche « 0:00 » comme
 * duree totale, alors que la lecture continue. On ecrit ici les vraies durees,
 * cumulees par piste.
 *
 * @param moov en-tete a modifier SUR PLACE.
 * @param running duree cumulee par piste, en unites de sa base de temps.
 * @param timescales base de temps par piste.
 */
function patchMoovDurations(
  moov: Buffer,
  running: Map<number, bigint>,
  timescales: Map<number, number>,
): void {
  // `moov` est exactement la boite : elle occupe tout le tampon recu.
  const moovBox: Box = { type: 'moov', start: 0, size: moov.length };
  const mvhd = findBox(moov, 'mvhd');
  const movieTimescale = mvhd ? mdhdTimescale(moov, mvhd) : 0;

  // Duree de chaque piste, en secondes.
  const trackSeconds = new Map<number, number>();
  let longest = 0;
  for (const [trackId, units] of running) {
    const timescale = timescales.get(trackId) ?? 0;
    if (timescale <= 0) continue;
    const seconds = Number(units) / timescale;
    trackSeconds.set(trackId, seconds);
    if (seconds > longest) longest = seconds;
  }

  // Duree globale : celle de la piste la plus longue, dans la base du film.
  if (mvhd && movieTimescale > 0) {
    writeDuration(moov, durationOffset(moov, mvhd, 4), moov.readUInt8(mvhd.start + 8), longest, movieTimescale);
  }

  for (const trak of childBoxes(moov, moovBox)) {
    if (trak.type !== 'trak') continue;
    const children = childBoxes(moov, trak);
    const tkhd = children.find((entry) => entry.type === 'tkhd');
    const mdia = children.find((entry) => entry.type === 'mdia');
    if (!tkhd) continue;
    const trackId = tkhdTrackId(moov, tkhd);
    const seconds = trackSeconds.get(trackId);
    if (seconds === undefined) continue;

    // tkhd : duree dans la base de temps du film (track_ID + reserved avant).
    if (movieTimescale > 0) {
      writeDuration(moov, durationOffset(moov, tkhd, 8), moov.readUInt8(tkhd.start + 8), seconds, movieTimescale);
    }
    // mdhd : duree dans la base de temps de la piste (timescale avant).
    if (mdia) {
      const mdhd = findBox(moov, 'mdhd', mdia.start + 8, mdia.start + mdia.size);
      const timescale = timescales.get(trackId) ?? 0;
      if (mdhd && timescale > 0) {
        writeDuration(moov, durationOffset(moov, mdhd, 4), moov.readUInt8(mdhd.start + 8), seconds, timescale);
      }
    }
  }
}

/**
 * Corrige les durees de l'en-tete d'un MP4 fragmente ecrit par MediaMTX.
 *
 * Les enregistrements directs de MediaMTX portent un en-tete dont `tkhd` et
 * `mdhd` annoncent **zero** (seul `mvhd` est renseigne) : c'est ce qui fait
 * afficher « 00:00 » aux lecteurs de Windows, alors que la lecture continue. On
 * lit la duree reelle dans les fragments, puis on reecrit l'en-tete SUR PLACE.
 *
 * A appeler une fois le fichier clos.
 *
 * @returns vrai si l'en-tete a ete corrige.
 */
export function repairFmp4HeaderDurations(file: string): boolean {
  let buffer: Buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    return false;
  }
  const moov = findBox(buffer, 'moov');
  if (!moov) return false;

  const timescales = parseTrackTimescales(buffer);
  if (timescales.size === 0) return false;

  // Duree cumulee par piste, lue dans les fragments.
  const running = new Map<number, bigint>();
  for (const moof of listBoxes(buffer)) {
    if (moof.type !== 'moof') continue;
    for (const traf of childBoxes(buffer, moof)) {
      if (traf.type !== 'traf') continue;
      const children = childBoxes(buffer, traf);
      const tfhd = children.find((entry) => entry.type === 'tfhd');
      if (!tfhd) continue;
      const trackId = tfhdTrackId(buffer, tfhd);
      running.set(trackId, (running.get(trackId) ?? 0n) + trafDuration(buffer, traf));
    }
  }
  if (running.size === 0) return false;

  // `patchMoovDurations` ecrit dans le tampon recu : on lui passe la tranche
  // du `moov`, a l'interieur du fichier.
  patchMoovDurations(buffer.subarray(moov.start, moov.start + moov.size), running, timescales);

  try {
    writeFileSync(file, buffer);
    return true;
  } catch {
    return false;
  }
}

/** Base de temps par piste d'un en-tete fMP4, a partir des `tkhd` et `mdhd`. */
function parseTrackTimescales(init: Buffer): Map<number, number> {
  const timescales = new Map<number, number>();
  const moov = findBox(init, 'moov');
  if (!moov) return timescales;
  for (const trak of childBoxes(init, moov)) {
    if (trak.type !== 'trak') continue;
    const children = childBoxes(init, trak);
    const tkhd = children.find((entry) => entry.type === 'tkhd');
    const mdia = children.find((entry) => entry.type === 'mdia');
    if (!tkhd || !mdia) continue;
    const mdhd = findBox(init, 'mdhd', mdia.start + 8, mdia.start + mdia.size);
    if (!mdhd) continue;
    const timescale = mdhdTimescale(init, mdhd);
    if (timescale > 0) timescales.set(tkhdTrackId(init, tkhd), timescale);
  }
  return timescales;
}

/**
 * Duree, en unites de la base de temps, de tous les `trun` d'un `traf`.
 */
function trafDuration(buffer: Buffer, traf: Box): bigint {
  const children = childBoxes(buffer, traf);
  const tfhd = children.find((entry) => entry.type === 'tfhd');
  const fallback = tfhd ? tfhdDefaultDuration(buffer, tfhd) : 0;
  let total = 0n;
  for (const child of children) {
    if (child.type === 'trun') total += trunDuration(buffer, child, fallback);
  }
  return total;
}

/**
 * Duree reelle d'un segment, en secondes.
 *
 * MediaMTX aligne ses segments sur le GOP de la source : un segment ne dure
 * donc PAS la duree demandee (2 s). Compter les segments pour en deduire la
 * duree donne un resultat faux — c'est ce qui faisait qu'un replay de 100 s
 * n'en durait que 3.
 *
 * On lit la duree reellement portee par les `trun`, divisee par la base de
 * temps (`timescale`) de la piste concernee. Chaque piste a la sienne (90000
 * pour la video, souvent 48000 pour l'audio) : on les met en correspondance par
 * identifiant, et on retient la plus longue — un segment qui contient une piste
 * video et une piste audio dure le temps de la plus longue.
 *
 * Un segment MediaMTX contient PLUSIEURS fragments (`moof`/`mdat`) : on les
 * additionne tous.
 *
 * @returns la duree en secondes, ou 0 si elle n'est pas lisible.
 */
export function fmp4SegmentSeconds(segment: Buffer): number {
  const moov = findBox(segment, 'moov');
  if (!moov) return 0;

  // Base de temps par piste : identifiant -> timescale.
  const timescales = new Map<number, number>();
  for (const trak of childBoxes(segment, moov)) {
    if (trak.type !== 'trak') continue;
    const children = childBoxes(segment, trak);
    const tkhd = children.find((entry) => entry.type === 'tkhd');
    const mdia = children.find((entry) => entry.type === 'mdia');
    if (!tkhd || !mdia) continue;
    const mdhd = findBox(segment, 'mdhd', mdia.start + 8, mdia.start + mdia.size);
    if (!mdhd) continue;
    const timescale = mdhdTimescale(segment, mdhd);
    if (timescale > 0) timescales.set(tkhdTrackId(segment, tkhd), timescale);
  }
  if (timescales.size === 0) return 0;

  let seconds = 0;
  // Duree cumulee par piste, sur tous les fragments du segment.
  const perTrack = new Map<number, number>();
  for (const moof of listBoxes(segment)) {
    if (moof.type !== 'moof') continue;
    for (const traf of childBoxes(segment, moof)) {
      if (traf.type !== 'traf') continue;
      const children = childBoxes(segment, traf);
      const tfhd = children.find((entry) => entry.type === 'tfhd');
      if (!tfhd) continue;
      const trackId = tfhdTrackId(segment, tfhd);
      const timescale = timescales.get(trackId) ?? 0;
      if (timescale <= 0) continue;
      const duration = Number(trafDuration(segment, traf)) / timescale;
      perTrack.set(trackId, (perTrack.get(trackId) ?? 0) + duration);
    }
  }
  for (const duration of perTrack.values()) {
    if (duration > seconds) seconds = duration;
  }
  return seconds;
}

/**
 * Reecrit un fragment : numero de sequence et temps de decodage cumule.
 *
 * @param moof fragment a modifier SUR PLACE (copie mutable).
 * @param sequence numero de sequence global, croissant.
 * @param running temps de decodage deja accumule, par piste.
 */
function rewriteMoof(moof: Buffer, sequence: number, running: Map<number, bigint>): void {
  // Les enfants du `moof` : `mfhd` et un ou plusieurs `traf`. On ne parcourt
  // PAS le moof lui-meme (il ne contient que ces enfants).
  const boxes = listBoxes(moof, 8, moof.length);
  for (const box of boxes) {
    if (box.type === 'mfhd') {
      moof.writeUInt32BE(sequence >>> 0, box.start + 12);
      continue;
    }
    if (box.type !== 'traf') continue;

    let trackId = 0;
    let duration = 0n;
    let tfdt: Box | null = null;

    const children = childBoxes(moof, box);
    for (const child of children) {
      if (child.type === 'tfhd') trackId = tfhdTrackId(moof, child);
      if (child.type === 'tfdt') tfdt = child;
    }
    const tfhd = children.find((entry) => entry.type === 'tfhd');
    const fallback = tfhd ? tfhdDefaultDuration(moof, tfhd) : 0;
    for (const child of children) {
      if (child.type !== 'trun') continue;
      duration += trunDuration(moof, child, fallback);
    }

    const base = running.get(trackId) ?? 0n;
    if (tfdt) {
      const version = moof.readUInt8(tfdt.start + 8);
      if (version === 1) moof.writeBigUInt64BE(base, tfdt.start + 12);
      else moof.writeUInt32BE(Number(base & 0xffffffffn), tfdt.start + 12);
    }
    running.set(trackId, base + duration);
  }
}

/**
 * Etat d'assemblage incremental d'un MP4 fragmente.
 *
 * Une capture en cours grandit au fil des segments : on ne peut pas relire le
 * fichier entier a chaque ajout. On garde donc l'etat (numero de sequence et
 * temps cumule) et on reecrit seulement le fragment qu'on ajoute.
 */
export interface Fmp4WriterState {
  sequence: number;
  running: Map<number, bigint>;
  initWritten: boolean;
  /** Copie modifiable du `moov` du premier segment, pour en corriger les durees. */
  initMoov: Buffer | null;
  /** Position du `moov` dans le premier bloc ecrit, pour le corriger dans un fichier. */
  initOffset: number;
  /** Base de temps par piste, lue dans l'en-tete. */
  timescales: Map<number, number>;
}

/** Cree un etat d'assemblage vide. */
export function createFmp4Writer(): Fmp4WriterState {
  return {
    sequence: 0,
    running: new Map(),
    initWritten: false,
    initMoov: null,
    initOffset: 0,
    timescales: new Map(),
  };
}

/**
 * Resultat d'un ajout incremental : les octets a ecrire et la position atteinte.
 */
export interface Fmp4AppendResult {
  chunk: Buffer;
  consumed: number;
}

/**
 * Prepare les octets a ajouter, a partir d'une position donnee.
 *
 * Le traitement se fait **fragment par fragment** (une paire `moof`+`mdat`),
 * et non segment par segment : un segment MediaMTX contient plusieurs
 * fragments, et le dernier est encore en cours d'ecriture. On peut donc ecrire
 * les fragments deja complets sans attendre la fin du segment — c'est ce qui
 * rend l'enregistrement quasi instantane, au demarrage comme a l'arret.
 *
 * @param buffer contenu du fichier de segment (peut grandir entre deux appels).
 * @param from position deja traitee, toujours sur une frontiere de boite.
 * @returns les octets a ajouter et la nouvelle position, ou null si rien de
 *   nouveau n'est exploitable.
 */
export function fmp4Append(state: Fmp4WriterState, buffer: Buffer, from = 0): Fmp4AppendResult | null {
  const parts: Buffer[] = [];
  // On parcourt TOUJOURS depuis le debut : l'en-tete d'initialisation (ftyp +
  // moov) doit etre ecrit une fois, meme si l'on commence au milieu du fichier.
  const boxes = listBoxes(buffer, 0, buffer.length);
  let consumed = from;

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];

    if (box.type === 'ftyp' || box.type === 'moov') {
      if (!state.initWritten) {
        if (box.type === 'moov') {
          // On garde une copie modifiable du `moov` : ses durees seront
          // corrigees a la finalisation, une fois la duree totale connue. On
          // retient aussi sa position, pour le corriger dans un fichier ecrit
          // en flux.
          const moov = Buffer.from(buffer.subarray(box.start, box.start + box.size));
          state.initMoov = moov;
          state.initOffset = parts.reduce((total, part) => total + part.length, 0);
          state.timescales = parseTrackTimescales(moov);
        }
        parts.push(Buffer.from(buffer.subarray(box.start, box.start + box.size)));
      }
      continue;
    }

    if (box.type === 'moof') {
      // On n'ecrit un fragment que lorsque son `mdat` est complet : un `moof`
      // sans ses donnees donnerait un fichier tronque. Tant que le `mdat` n'est
      // pas entier, on s'arrete ici et on reprendra au prochain passage.
      const next = boxes[index + 1];
      if (!next || next.type !== 'mdat') break;
      // Fragment deja ecrit (avant la position de reprise) : on l'ignore.
      if (box.start >= from) {
        state.sequence += 1;
        const moof = Buffer.from(buffer.subarray(box.start, box.start + box.size));
        rewriteMoof(moof, state.sequence, state.running);
        parts.push(moof);
        parts.push(Buffer.from(buffer.subarray(next.start, next.start + next.size)));
        consumed = next.start + next.size;
      }
      index += 1; // le mdat est traite avec le moof
      continue;
    }
  }

  if (parts.length === 0) return null;
  state.initWritten = true;
  return { chunk: Buffer.concat(parts), consumed };
}

/**
 * Position de fin du dernier fragment complet d'un segment fMP4.
 *
 * Sert a reprendre une lecture la ou l'ecriture s'etait arretee, sur une
 * frontiere de fragment : un fichier relu a partir d'une position arbitraire
 * (au milieu d'un `mdat`) donnerait des boites illisibles.
 */
export function lastCompleteFragmentEnd(buffer: Buffer): number {
  const boxes = listBoxes(buffer, 0, buffer.length);
  let end = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (box.type === 'moof') {
      const next = boxes[index + 1];
      if (next && next.type === 'mdat') {
        end = next.start + next.size;
        index += 1;
      }
    } else if (box.type === 'ftyp' || box.type === 'moov') {
      if (box.start + box.size > end) end = box.start + box.size;
    }
  }
  return end;
}

/**
 * Corrige les durees de l'en-tete une fois l'assemblage termine.
 *
 * A appeler apres le dernier `fmp4Append` et AVANT de concatener les morceaux :
 * le `moov` conserve par l'etat est alors modifie en place, et la concatenation
 * en reprend le contenu corrige. Sans cela, la duree annoncee par le fichier
 * reste celle d'un seul segment (`tkhd` et `mdhd` a zero), et le lecteur affiche
 * « 0:00 » alors que la lecture continue.
 */
export function fmp4Finalize(state: Fmp4WriterState): void {
  if (state.initMoov) patchMoovDurations(state.initMoov, state.running, state.timescales);
}

/**
 * Assemble des segments fMP4 en un seul MP4 valide.
 *
 * @returns le tampon du fichier, ou null si aucun segment exploitable.
 */
export function concatFragmentedMp4(segments: Buffer[]): Buffer | null {
  const state = createFmp4Writer();
  const parts: Buffer[] = [];
  for (const segment of segments) {
    const result = fmp4Append(state, segment);
    if (result) parts.push(result.chunk);
  }
  if (!state.initWritten || parts.length === 0) return null;
  // La duree totale n'est connue qu'ici : on corrige alors l'en-tete. Le
  // `moov` est dans le premier morceau ; on y recopie la version corrigee.
  fmp4Finalize(state);
  if (state.initMoov && parts[0]) state.initMoov.copy(parts[0], state.initOffset);
  return Buffer.concat(parts);
}

/**
 * Lit des fichiers fMP4 et les assemble en un MP4 unique.
 *
 * @returns le chemin du fichier ecrit, ou null si aucun segment n'est lisible.
 */
export async function concatFragmentedMp4Files(
  segmentPaths: string[],
  target: string,
): Promise<string | null> {
  const buffers: Buffer[] = [];
  for (const segmentPath of segmentPaths) {
    try {
      buffers.push(await fs.readFile(segmentPath));
    } catch {
      // Segment disparu (purge du tampon) : on continue avec les autres.
    }
  }
  const merged = concatFragmentedMp4(buffers);
  if (!merged) return null;
  await fs.writeFile(target, merged);
  return target;
}
