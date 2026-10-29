#!/usr/bin/env node
/**
 * Telecharge le binaire MediaMTX pour la plateforme courante et le place dans
 * vendor/mediamtx. Utilise par les GitHub Actions avant empaquetage, pour que
 * chaque installeur contienne une version de MediaMTX fonctionnelle hors ligne.
 *
 * Usage : node scripts/fetch-mediamtx.mjs [--force] [--platform win32|darwin|linux]
 */
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rm, access, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import extractZip from 'extract-zip';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = path.join(projectRoot, 'vendor', 'mediamtx');
const force = process.argv.includes('--force');

const RELEASE_API = 'https://api.github.com/repos/bluenviron/mediamtx/releases/latest';

/**
 * Archive a telecharger selon la plateforme.
 *
 * MediaMTX publie une archive par systeme, toutes nommees sur le meme modele :
 * `mediamtx_vX.Y.Z_<os>_<arch>.zip` (sauf Linux, en .tar.gz).
 */
const PLATFORMS = {
  win32: { pattern: /^mediamtx_v[\d.]+_windows_amd64\.zip$/i, binary: 'mediamtx.exe', archive: 'mediamtx.zip' },
  darwin: { pattern: /^mediamtx_v[\d.]+_darwin_arm64\.tar\.gz$/i, binary: 'mediamtx', archive: 'mediamtx.tar.gz' },
  linux: { pattern: /^mediamtx_v[\d.]+_linux_amd64\.tar\.gz$/i, binary: 'mediamtx', archive: 'mediamtx.tar.gz' },
};

/** Plateforme visee : `--platform`, sinon celle qui execute le script. */
function resolvePlatform() {
  const flag = process.argv.indexOf('--platform');
  const requested = flag >= 0 ? process.argv[flag + 1] : process.platform;
  const target = PLATFORMS[requested] ?? PLATFORMS[process.platform] ?? PLATFORMS.win32;
  return { name: requested, ...target };
}

function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamControl-Build' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const platform = resolvePlatform();
  const binary = path.join(targetDir, platform.binary);
  if (!force && (await exists(binary))) {
    console.log(`[fetch-mediamtx] ${binary} deja present, rien a faire.`);
    return;
  }

  console.log('[fetch-mediamtx] Recherche de la derniere version...');
  const releaseResponse = await fetch(RELEASE_API, { headers: githubHeaders() });
  if (!releaseResponse.ok) {
    throw new Error(`API GitHub : ${releaseResponse.status} ${releaseResponse.statusText}`);
  }
  const release = await releaseResponse.json();
  const asset = (release.assets ?? []).find((candidate) => platform.pattern.test(candidate.name));
  if (!asset) {
    throw new Error(`Aucune archive ${platform.name} dans la derniere version de MediaMTX.`);
  }
  console.log(`[fetch-mediamtx] Version ${release.tag_name} : ${asset.name} (${platform.name})`);

  const archive = path.join(projectRoot, 'vendor', platform.archive);
  await mkdir(path.dirname(archive), { recursive: true });

  const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'StreamControl-Build' } });
  if (!download.ok || !download.body) {
    throw new Error(`Telechargement refuse : ${download.status} ${download.statusText}`);
  }
  await pipeline(Readable.fromWeb(download.body), createWriteStream(archive));

  const staging = path.join(projectRoot, 'vendor', 'mediamtx-staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  // Windows : archive ZIP. macOS et Linux : archive tar.gz, que l'on extrait
  // avec `tar`, present partout (y compris sur les runners GitHub).
  if (platform.archive.endsWith('.zip')) {
    await extractZip(archive, { dir: staging });
  } else {
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xzf', archive, '-C', staging], (error) =>
        error ? reject(error) : resolve(undefined),
      );
    });
  }

  const extracted = path.join(staging, platform.binary);
  if (!(await exists(extracted))) {
    throw new Error(`${platform.binary} absent de l'archive extraite.`);
  }
  // Sur macOS et Linux, l'archive ne porte pas le droit d'execution.
  if (platform.binary === 'mediamtx') await chmod(extracted, 0o755);

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await rename(staging, targetDir);
  await rm(archive, { force: true });

  console.log(`[fetch-mediamtx] Installe dans ${targetDir}`);
}

main().catch((error) => {
  console.error(`[fetch-mediamtx] Echec : ${error instanceof Error ? error.message : String(error)}`);
  console.error('[fetch-mediamtx] L\'application restera fonctionnelle : elle proposera le telechargement');
  console.error('[fetch-mediamtx] de MediaMTX depuis ses Parametres, ou l\'utilisation d\'un binaire existant.');
  process.exit(0);
});
