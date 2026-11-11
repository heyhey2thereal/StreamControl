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
import { promises as fs } from 'node:fs';

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
}

/** Cree un etat d'assemblage vide. */
export function createFmp4Writer(): Fmp4WriterState {
  return { sequence: 0, running: new Map(), initWritten: false };
}

/**
 * Prepare les octets a ajouter pour un segment.
 *
 * @returns les octets a ecrire, ou null si le segment n'apporte rien.
 */
export function fmp4Append(state: Fmp4WriterState, segment: Buffer): Buffer | null {
  const parts: Buffer[] = [];
  for (const box of listBoxes(segment)) {
    if (box.type === 'ftyp' || box.type === 'moov') {
      if (!state.initWritten) parts.push(Buffer.from(segment.subarray(box.start, box.start + box.size)));
      continue;
    }
    if (box.type === 'moof') {
      state.sequence += 1;
      const moof = Buffer.from(segment.subarray(box.start, box.start + box.size));
      rewriteMoof(moof, state.sequence, state.running);
      parts.push(moof);
      continue;
    }
    if (box.type === 'mdat') {
      parts.push(Buffer.from(segment.subarray(box.start, box.start + box.size)));
    }
  }
  if (parts.length === 0) return null;
  state.initWritten = true;
  return Buffer.concat(parts);
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
    const chunk = fmp4Append(state, segment);
    if (chunk) parts.push(chunk);
  }
  if (!state.initWritten || parts.length === 0) return null;
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
