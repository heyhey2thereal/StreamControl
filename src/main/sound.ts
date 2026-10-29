/**
 * Lecture d'un fichier de son, pour les alertes de macro.
 *
 * Le processus principal ne peut pas jouer un fichier audio : Electron n'offre
 * cote principal que le bip systeme. Il lit donc le fichier et le transmet au
 * rendu sous forme de `data:` URL, que l'interface joue avec un element audio.
 * Cette lecture est aussi proposee a l'editeur de macros, pour verifier un son
 * au moment ou on le choisit.
 *
 * **Le resultat est mis en cache.** Sans cela, un son de plusieurs Mo etait
 * relu et encode en base64 a chaque execution : c'est ce qui faisait attendre
 * plusieurs secondes avant que le bloc « jouer un son » se declenche. Le cache
 * est indexe sur le chemin, la taille et la date de modification : remplacer le
 * fichier invalide donc l'entree sans redemarrer l'application.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Taille maximale d'un son transmis au rendu (8 Mo). */
const MAX_SOUND_BYTES = 8 * 1024 * 1024;

/** Type MIME d'un fichier de son, deduit de son extension. */
export function soundMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    default:
      return 'audio/mpeg';
  }
}

/**
 * Cache des sons deja lus.
 *
 * Borne a quelques entrees : une macro utilise une poignee de sons, il est
 * inutile de garder en memoire tous ceux que l'editeur a essayes.
 */
const cache = new Map<string, { key: string; dataUrl: string }>();
const MAX_CACHE = 8;

/**
 * Lit un fichier de son et le renvoie en URL de donnees.
 *
 * @returns l'URL de donnees, ou null si le chemin est vide, le fichier
 *   illisible, ou trop volumineux pour etre transmis.
 */
export async function readSoundFile(filePath: string): Promise<string | null> {
  const target = filePath.trim();
  if (!target) return null;

  // La cle inclut la taille et la date : un fichier remplace est relu.
  let key: string;
  try {
    const info = await stat(target);
    key = `${target}|${info.size}|${info.mtimeMs}`;
  } catch {
    cache.delete(target);
    return null;
  }

  const cached = cache.get(target);
  if (cached && cached.key === key) return cached.dataUrl;

  try {
    const data = await readFile(target);
    if (data.byteLength > MAX_SOUND_BYTES) return null;
    const dataUrl = `data:${soundMimeType(target)};base64,${data.toString('base64')}`;

    // Le cache est borne : on retire l'entree la plus ancienne.
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(target, { key, dataUrl });
    return dataUrl;
  } catch {
    return null;
  }
}

/** Vide le cache. Sert aux tests. */
export function clearSoundCache(): void {
  cache.clear();
}
