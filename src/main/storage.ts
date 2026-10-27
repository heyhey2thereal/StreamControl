/**
 * Inventaire des fichiers de l'application.
 *
 * StreamControl eparpille ses fichiers : binaires telecharges, configuration
 * generee, parametres, journaux. Ce module dit ou ils se trouvent, pour que
 * l'interface puisse ouvrir le dossier d'un clic. Il ne deplace rien.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface StorageEntry {
  /** Cle stable, utilisee par l'interface. */
  key: string;
  label: string;
  /** Emplacement actuel, s'il existe. */
  current: string;
  /** Emplacement vise dans le dossier de rangement. */
  target: string;
  exists: boolean;
}

export interface GatherResult {
  ok: boolean;
  /** Dossier de rangement utilise. */
  directory: string;
  moved: string[];
  failed: Array<{ label: string; reason: string }>;
  message: string;
}

/** Dossier de rangement par defaut, dans le profil utilisateur. */
export function defaultStorageDir(): string {
  return path.join(app.getPath('userData'), 'StreamControl');
}

/** Resout le dossier de rangement effectif. */
export function resolveStorageDir(configured: string): string {
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : defaultStorageDir();
}

/**
 * Inventorie les fichiers de l'application et l'emplacement vise pour chacun.
 * L'inventaire est affiche dans l'interface avant tout deplacement.
 */
export async function listStorageEntries(configuredDir: string): Promise<StorageEntry[]> {
  const userData = app.getPath('userData');
  const target = resolveStorageDir(configuredDir);

  const candidates: Array<{ key: string; label: string; current: string; folder: string }> = [
    {
      key: 'settings',
      label: 'Parametres',
      current: path.join(userData, 'settings.json'),
      folder: 'config',
    },
    {
      key: 'mediamtx-binary',
      label: 'MediaMTX telecharge',
      current: path.join(userData, 'mediamtx-bin'),
      folder: 'bin',
    },
    {
      key: 'mediamtx-config',
      label: 'Configuration MediaMTX',
      current: path.join(userData, 'mediamtx'),
      folder: 'config',
    },
    {
      key: 'logs',
      label: 'Journaux',
      current: path.join(userData, 'logs'),
      folder: 'logs',
    },
  ];

  const entries: StorageEntry[] = [];
  for (const candidate of candidates) {
    entries.push({
      key: candidate.key,
      label: candidate.label,
      current: candidate.current,
      target: path.join(target, candidate.folder, path.basename(candidate.current)),
      exists: await pathExists(candidate.current),
    });
  }

  return entries;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
