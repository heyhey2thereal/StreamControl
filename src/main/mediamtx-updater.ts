import { app } from 'electron';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import extractZip from 'extract-zip';
import type { Logger } from './logger';

const RELEASE_API = 'https://api.github.com/repos/bluenviron/mediamtx/releases/latest';
const ASSET_PATTERN = /^mediamtx_v[\d.]+_windows_amd64\.zip$/i;

export interface UpdateResult {
  ok: boolean;
  version?: string;
  binaryPath?: string;
  message: string;
}

/** Dossier ou StreamControl installe la version telechargee de MediaMTX. */
export function downloadedMediamtxDir(): string {
  return path.join(app.getPath('userData'), 'mediamtx-bin');
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StreamControl',
  };
  // Un jeton est optionnel : il evite la limite de requetes anonymes.
  const token = process.env.GITHUB_TOKEN ?? process.env.STREAMCONTROL_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

interface GithubRelease {
  tag_name?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

export async function fetchLatestRelease(): Promise<{ version: string; url: string }> {
  const response = await fetch(RELEASE_API, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`API GitHub a repondu ${response.status} ${response.statusText}`);
  }
  const release = (await response.json()) as GithubRelease;
  const asset = release.assets?.find((candidate) => ASSET_PATTERN.test(candidate.name));
  if (!asset) {
    throw new Error('Aucune archive Windows amd64 trouvee dans la derniere version de MediaMTX.');
  }
  return { version: release.tag_name ?? 'inconnue', url: asset.browser_download_url };
}

/**
 * Telecharge et installe la derniere version de MediaMTX dans le profil utilisateur.
 * Aucun droit administrateur n'est necessaire : rien n'est ecrit hors de userData.
 */
export async function downloadAndInstallMediamtx(logger: Logger): Promise<UpdateResult> {
  let release: { version: string; url: string };
  try {
    release = await fetchLatestRelease();
    logger.info('updater', `Derniere version de MediaMTX : ${release.version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('updater', `Recherche de version impossible : ${message}`);
    return { ok: false, message: `Recherche de version impossible : ${message}` };
  }

  const targetDir = downloadedMediamtxDir();
  const archivePath = path.join(app.getPath('temp'), 'streamcontrol-mediamtx.zip');

  try {
    await fs.mkdir(targetDir, { recursive: true });

    logger.info('updater', `Telechargement de ${release.url}...`);
    const response = await fetch(release.url, { headers: { 'User-Agent': 'StreamControl' } });
    if (!response.ok || !response.body) {
      throw new Error(`Telechargement refuse (${response.status} ${response.statusText})`);
    }

    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archivePath));
    logger.info('updater', 'Telechargement termine, extraction en cours...');

    // Ecrit a cote du dossier final puis bascule, pour ne pas laisser une installation partielle.
    const stagingDir = `${targetDir}.staging`;
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await extractZip(archivePath, { dir: stagingDir });

    const binaryInStaging = path.join(stagingDir, 'mediamtx.exe');
    await fs.access(binaryInStaging);

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rename(stagingDir, targetDir);

    const binaryPath = path.join(targetDir, 'mediamtx.exe');
    logger.info('updater', `MediaMTX ${release.version} installe : ${binaryPath}`);

    return {
      ok: true,
      version: release.version,
      binaryPath,
      message: `MediaMTX ${release.version} installe dans ${targetDir}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('updater', `Installation de MediaMTX impossible : ${message}`);
    return { ok: false, message: `Installation impossible : ${message}` };
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    await fs.rm(`${targetDir}.staging`, { recursive: true, force: true }).catch(() => undefined);
  }
}
