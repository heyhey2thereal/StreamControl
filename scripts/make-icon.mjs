#!/usr/bin/env node
/**
 * Genere l'icone de l'application.
 *
 * Le dessin est decrit par des champs de distance signee, ce qui donne des
 * bords nets a toutes les tailles sans suréchantillonnage. Le rendu est
 * deterministe : relancer le script produit exactement la meme image.
 *
 * Usage : node scripts/make-icon.mjs [taille]
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Le dessin est defini sur une grille de reference, puis mis a l'echelle. */
const REF = 512;

const COLORS = {
  // Fond : presque noir, legerement bleute, comme l'interface.
  top: [25, 29, 35],
  bottom: [14, 17, 21],
  edge: [255, 255, 255, 0.10],
  accent: [78, 168, 222],
  accentDeep: [46, 122, 170],
  live: [248, 81, 73],
  core: [233, 236, 239],
};

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Champ de distance signee d'un rectangle arrondi (negatif a l'interieur). */
function roundedRectSdf(px, py, x0, y0, x1, y1, radius) {
  const halfW = (x1 - x0) / 2;
  const halfH = (y1 - y0) / 2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);

  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/**
 * Champ de distance signee d'un arc epais, avec extremites arrondies.
 * Les angles sont exprimes en radians, 0 pointant vers la droite et les
 * valeurs positives vers le bas (repere ecran).
 */
function arcSdf(px, py, cx, cy, radius, startAngle, endAngle, halfWidth) {
  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  if (angle >= startAngle && angle <= endAngle) {
    return Math.abs(distance - radius) - halfWidth;
  }

  // Hors de l'intervalle angulaire : on se raccorde au bout le plus proche.
  const endA = [cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle)];
  const endB = [cx + radius * Math.cos(endAngle), cy + radius * Math.sin(endAngle)];
  const toA = Math.hypot(px - endA[0], py - endA[1]);
  const toB = Math.hypot(px - endB[0], py - endB[1]);
  return Math.min(toA, toB) - halfWidth;
}

/** Champ de distance signee d'un disque. */
function circleSdf(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) - radius;
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Compose une couche de couleur sur un fond, selon la couverture du SDF. */
function over(base, color, coverage) {
  const alpha = clamp01(coverage);
  if (alpha <= 0) return base;
  return [
    base[0] + (color[0] - base[0]) * alpha,
    base[1] + (color[1] - base[1]) * alpha,
    base[2] + (color[2] - base[2]) * alpha,
  ];
}

/** Convertit une distance en couverture, avec un bord antialiase d'un pixel. */
const coverage = (distance) => clamp01(0.5 - distance);

function render(SIZE) {
  const scale = SIZE / REF;
  const rows = [];
  const inset = 14;
  const rectRadius = 112;
  const edgeWidth = 1.6;

  // Les arcs rayonnent depuis le coin inferieur gauche vers le haut et la droite.
  const origin = { x: 132, y: 382 };
  const arcs = [
    { radius: 92, halfWidth: 21 },
    { radius: 166, halfWidth: 21 },
    { radius: 240, halfWidth: 21 },
  ];
  const startAngle = -Math.PI / 2;
  const endAngle = 0;

  for (let y = 0; y < SIZE; y += 1) {
    const row = Buffer.alloc(1 + SIZE * 3);
    row[0] = 0; // filtre PNG : aucun

    for (let x = 0; x < SIZE; x += 1) {
      // Coordonnees sur la grille de reference.
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;

      let color = [0, 0, 0];

      // --- Fond : rectangle arrondi, avec un degrade vertical discret ---
      const plateDistance = roundedRectSdf(px, py, inset, inset, REF - inset, REF - inset, rectRadius);
      const plateCoverage = coverage(plateDistance);

      if (plateCoverage > 0) {
        const gradient = clamp01(py / REF);
        const base = mix(COLORS.top, COLORS.bottom, gradient);
        color = over([0, 0, 0], base, plateCoverage);
      }

      // --- Liseré interieur : donne du relief sur un fond sombre ---
      const edgeDistance = Math.abs(plateDistance + edgeWidth / 2) - edgeWidth / 2;
      const edgeCoverage = coverage(edgeDistance) * plateCoverage;
      color = over(color, [255, 255, 255], edgeCoverage * COLORS.edge[3]);

      // --- Arcs de diffusion ---
      let arcDistance = Infinity;
      for (const arc of arcs) {
        arcDistance = Math.min(
          arcDistance,
          arcSdf(px, py, origin.x, origin.y, arc.radius, startAngle, endAngle, arc.halfWidth),
        );
      }
      const arcCoverage = coverage(arcDistance);
      if (arcCoverage > 0) {
        // Les arcs lointains s'eclaircissent : cela suggere la propagation.
        const depth = clamp01((Math.hypot(px - origin.x, py - origin.y) - 80) / 220);
        color = over(color, mix(COLORS.accentDeep, COLORS.accent, depth), arcCoverage);
      }

      // --- Point d'emission ---
      const coreDistance = circleSdf(px, py, origin.x, origin.y, 26);
      color = over(color, COLORS.core, coverage(coreDistance));

      // --- Temoin « en direct » ---
      const liveDistance = circleSdf(px, py, 398, 114, 40);
      color = over(color, COLORS.live, coverage(liveDistance));

      row[1 + x * 3] = Math.round(clamp01(color[0] / 255) * 255);
      row[2 + x * 3] = Math.round(clamp01(color[1] / 255) * 255);
      row[3 + x * 3] = Math.round(clamp01(color[2] / 255) * 255);
    }

    rows.push(row);
  }

  return Buffer.concat(rows);
}

/** Assemble un fichier PNG a partir des lignes de pixels RVB. */
function encodePng(raw, size) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits par composante
  header[9] = 2; // RVB
  header[10] = 0; // compression deflate
  header[11] = 0; // filtrage adaptatif
  header[12] = 0; // pas d'entrelacement

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Table de controle CRC32, exigee par le format PNG. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

/** Assemble un fichier ICO a partir de plusieurs PNG de tailles differentes. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserve
  header.writeUInt16LE(1, 2); // type : icone
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    // 256 est note 0 : la taille ne tient pas sur un octet.
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // nombre de couleurs de la palette
    entry.writeUInt8(0, 3); // reserve
    entry.writeUInt16LE(1, 4); // plans
    entry.writeUInt16LE(32, 6); // bits par pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/** Assemble un fichier PNG RGBA (avec transparence) a partir des lignes. */
function encodePngRgba(raw, size) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits par composante
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Dessine uniquement les motifs (arcs, point d'emission, temoin), sans le
 * plateau arrondi ni son liseré.
 *
 * Sert d'embleme pour l'ecran de verrouillage : le logo y est agrandi en
 * filigrane, et un cadre y ferait une tache grise au lieu d'un symbole.
 */
function renderEmblem(SIZE) {
  const scale = SIZE / REF;
  const rows = [];

  const origin = { x: 132, y: 382 };
  const arcs = [
    { radius: 92, halfWidth: 21 },
    { radius: 166, halfWidth: 21 },
    { radius: 240, halfWidth: 21 },
  ];
  const startAngle = -Math.PI / 2;
  const endAngle = 0;

  for (let y = 0; y < SIZE; y += 1) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0;

    for (let x = 0; x < SIZE; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;

      // Composition « over » en alpha droit : la couleur accumulee est ponderee
      // par la couverture deja atteinte, puis on ajoute le nouveau motif.
      let alpha = 0;
      let rgb = [0, 0, 0];

      const paint = (mask, tint) => {
        if (mask <= 0) return;
        const outA = mask + alpha * (1 - mask);
        if (outA <= 0) return;
        const weight = (alpha * (1 - mask)) / outA;
        rgb = [
          tint[0] * (1 - weight) + rgb[0] * weight,
          tint[1] * (1 - weight) + rgb[1] * weight,
          tint[2] * (1 - weight) + rgb[2] * weight,
        ];
        alpha = outA;
      };

      let arcDistance = Infinity;
      for (const arc of arcs) {
        arcDistance = Math.min(
          arcDistance,
          arcSdf(px, py, origin.x, origin.y, arc.radius, startAngle, endAngle, arc.halfWidth),
        );
      }
      const depth = clamp01((Math.hypot(px - origin.x, py - origin.y) - 80) / 220);
      paint(coverage(arcDistance), mix(COLORS.accentDeep, COLORS.accent, depth));

      paint(coverage(circleSdf(px, py, origin.x, origin.y, 26)), COLORS.core);
      paint(coverage(circleSdf(px, py, 398, 114, 40)), COLORS.live);

      row[1 + x * 4] = Math.round(clamp01(rgb[0] / 255) * 255);
      row[2 + x * 4] = Math.round(clamp01(rgb[1] / 255) * 255);
      row[3 + x * 4] = Math.round(clamp01(rgb[2] / 255) * 255);
      row[4 + x * 4] = Math.round(clamp01(alpha) * 255);
    }

    rows.push(row);
  }

  return Buffer.concat(rows);
}

const buildDir = path.join(projectRoot, 'build');
mkdirSync(buildDir, { recursive: true });

// Tailles utilisees par Windows : barre des taches, explorateur, bureau.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = SIZES.map((size) => ({ size, data: encodePng(render(size), size) }));

const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');

// Le PNG de 512 sert aux plateformes non Windows et aux pages web.
const largePng = encodePng(render(512), 512);
writeFileSync(pngPath, largePng);

const ico = encodeIco(images);
writeFileSync(icoPath, ico);

// Embleme transparent (motifs seuls, sans plateau) : ecran de verrouillage.
const emblem = encodePngRgba(renderEmblem(512), 512);
const emblemPath = path.join(buildDir, 'emblem.png');
writeFileSync(emblemPath, emblem);

// Le rendu est copie dans le rendu React : Vite le sert comme un asset.
const assetsDir = path.join(projectRoot, 'src', 'renderer', 'assets');
mkdirSync(assetsDir, { recursive: true });
writeFileSync(path.join(assetsDir, 'logo.png'), largePng);
writeFileSync(path.join(assetsDir, 'emblem.png'), emblem);

console.log(`Icone PNG 512x512 : ${pngPath} (${largePng.length} octets)`);
console.log(`Icone ICO ${SIZES.join(', ')} : ${icoPath} (${ico.length} octets)`);
console.log(`Embleme transparent : ${emblemPath} (${emblem.length} octets)`);
console.log(`Copies pour le rendu : ${assetsDir}/logo.png, ${assetsDir}/emblem.png`);
