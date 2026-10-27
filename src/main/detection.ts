import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DetectedTool, DetectionKind } from '../shared/types';
import type { Logger } from './logger';

/** Dossier ou l'updater installe MediaMTX dans le profil utilisateur. */
export function userMediamtxDir(): string {
  return path.join(app.getPath('userData'), 'mediamtx-bin');
}

/** Dossiers d'installation usuels d'OBS Studio sous Windows. */
const OBS_COMMON_DIRS = [
  'C:\\Program Files\\obs-studio\\bin\\64bit',
  'C:\\Program Files\\obs-studio\\bin\\32bit',
  'C:\\Program Files (x86)\\obs-studio\\bin\\64bit',
  'C:\\Program Files (x86)\\obs-studio\\bin\\32bit',
];

/** Nom du binaire MediaMTX selon la plateforme. */
export function mediamtxBinaryName(): string {
  return process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx';
}

/** Dossiers ou l'on peut trouver mediamtx.exe si l'utilisateur l'a installe a la main. */
const MEDIAMTX_COMMON_DIRS = [
  'C:\\mediamtx',
  'C:\\Program Files\\mediamtx',
  'C:\\Program Files (x86)\\mediamtx',
];

const EXECUTABLE_NAMES: Record<DetectionKind, string[]> = {
  mediamtx: ['mediamtx.exe', 'mediamtx'],
  obs: ['obs64.exe', 'obs32.exe'],
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
};

function runCommand(
  file: string,
  args: string[],
  timeoutMs = 8000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      });
    });
  });
}

/** Verifie qu'un chemin pointe vers un fichier executable existant. */
function isExecutableFile(target: string): boolean {
  try {
    return existsSync(target);
  } catch {
    return false;
  }
}

/**
 * Resout un chemin fourni par l'utilisateur vers un fichier executable.
 * Accepte aussi bien un chemin de fichier qu'un dossier : les deux saisies
 * sont courantes, et un binaire renomme doit rester utilisable.
 */
export function resolveExecutablePath(input: string, executableNames: string[]): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isExecutableFile(trimmed)) return trimmed;

  try {
    if (!statSync(trimmed).isDirectory()) return null;
  } catch {
    return null;
  }

  for (const name of executableNames) {
    const candidate = path.join(trimmed, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** Cherche un executable dans le PATH systeme. */
async function searchInPath(names: string[]): Promise<string | undefined> {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const separator = process.platform === 'win32' ? ';' : ':';
  const directories = pathValue.split(separator).filter(Boolean);

  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Dossier des ressources embarquees (vendor/mediamtx copie par electron-builder). */
export function bundledMediamtxDir(): string {
  return path.join(process.resourcesPath ?? app.getAppPath(), 'mediamtx');
}

async function readDirectorySafe(target: string): Promise<string[]> {
  try {
    return await fs.readdir(target);
  } catch {
    return [];
  }
}

/** Trouve un executable en explorant un dossier et ses sous-dossiers immediats. */
async function searchDirectory(target: string, names: string[], depth = 1): Promise<string | undefined> {
  const entries = await readDirectorySafe(target);
  for (const name of names) {
    if (entries.includes(name)) return path.join(target, name);
  }
  if (depth <= 0) return undefined;
  for (const entry of entries) {
    const child = path.join(target, entry);
    try {
      const stat = await fs.stat(child);
      if (stat.isDirectory()) {
        const found = await searchDirectory(child, names, depth - 1);
        if (found) return found;
      }
    } catch {
      // Dossier inaccessible : on continue l'exploration.
    }
  }
  return undefined;
}

/** Interroge le registre Windows (App Paths / Uninstall) pour localiser un logiciel. */
async function searchWindowsRegistry(kind: DetectionKind): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;

  if (kind === 'obs') {
    const appPathResult = await runCommand('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\obs64.exe',
      '/ve',
    ]);
    const match = /REG_SZ\s+(.+obs64\.exe)/i.exec(appPathResult.stdout);
    if (match) return match[1].trim().replace(/"/g, '');
  }

  const uninstallRoots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const namePattern = kind === 'obs' ? /obs studio/i : /mediamtx/i;

  for (const root of uninstallRoots) {
    const listResult = await runCommand('reg.exe', ['query', root, '/s', '/f', kind === 'obs' ? 'OBS Studio' : 'mediamtx']);
    if (!listResult.ok && !listResult.stdout) continue;
    if (!namePattern.test(listResult.stdout)) continue;

    for (const line of listResult.stdout.split(/\r?\n/)) {
      const installMatch = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(line);
      if (!installMatch) continue;
      const directory = installMatch[1].trim().replace(/^"|"$/g, '');
      const found = await searchDirectory(directory, EXECUTABLE_NAMES[kind], 3);
      if (found) return found;
    }
  }

  return undefined;
}

async function readVersion(
  executable: string,
  kind: DetectionKind,
): Promise<string | undefined> {
  // OBS et ffmpeg n'exposent pas d'option --version commune fiable en une passe ;
  // on tente une lecture non bloquante et on ignore les echecs.
  if (kind === 'mediamtx') {
    const result = await runCommand(executable, ['--version'], 6000);
    const text = `${result.stdout}\n${result.stderr}`;
    const match = /v?(\d+\.\d+\.\d+)/.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

export interface DetectionContext {
  logger: Logger;
  /** Chemin explicite fourni par l'utilisateur (prioritaire). */
  overridePath?: string;
  /**
   * Passe a true lors d'un rafraichissement automatique : seuls les
   * changements sont alors journalises, pour ne pas noyer la console.
   */
  quiet?: boolean;
}

/**
 * Memoire des derniers resultats, pour ne journaliser que les changements.
 * La detection tourne a chaque rafraichissement de l'interface : sans cela,
 * les memes lignes se repetent indefiniment.
 */
const lastDetection = new Map<string, string>();

/** Journalise un resultat de detection, seulement s'il a change. */
function logDetection(context: DetectionContext, kind: string, summary: string, message: string): void {
  const previous = lastDetection.get(kind);
  if (context.quiet && previous === summary) return;
  lastDetection.set(kind, summary);
  context.logger.info('detection', message);
}

/**
 * Detecte un outil dans cet ordre :
 * 1. chemin force par l'utilisateur, 2. ressources embarquees (MediaMTX),
 * 3. emplacements d'installation usuels, 4. registre Windows, 5. PATH.
 */
export async function detectTool(
  kind: DetectionKind,
  context: DetectionContext,
): Promise<DetectedTool> {
  const names = EXECUTABLE_NAMES[kind];
  const override = (context.overridePath ?? '').trim();

  if (override) {
    const candidate = resolveExecutablePath(override, names);
    if (candidate) {
      const version = await readVersion(candidate, kind);
      logDetection(context, kind, `settings:${candidate}`, `${kind} : binaire impose par les parametres (${candidate})`);
      return { kind, found: true, path: candidate, origin: 'settings', version };
    }
    const previous = lastDetection.get(`${kind}:override`);
    if (previous !== override) {
      lastDetection.set(`${kind}:override`, override);
      context.logger.warn(
        'detection',
        `${kind} : aucun executable trouve a l'emplacement indique (${override}), detection automatique.`,
      );
    }
  }

  if (kind === 'mediamtx') {
    // Une version telechargee par l'utilisateur prime sur celle livree dans l'installeur.
    const downloaded = path.join(userMediamtxDir(), mediamtxBinaryName());
    if (isExecutableFile(downloaded)) {
      const version = await readVersion(downloaded, kind);
      logDetection(context, kind, `downloaded:${downloaded}`, `MediaMTX telecharge utilise (${downloaded})`);
      return { kind, found: true, path: downloaded, origin: 'downloaded', version };
    }

    const bundled = path.join(bundledMediamtxDir(), mediamtxBinaryName());
    if (isExecutableFile(bundled)) {
      const version = await readVersion(bundled, kind);
      logDetection(context, kind, `bundled:${bundled}`, `MediaMTX embarque utilise (${bundled})`);
      return { kind, found: true, path: bundled, origin: 'bundled', version };
    }
  }

  const commonDirs = kind === 'obs' ? OBS_COMMON_DIRS : kind === 'mediamtx' ? MEDIAMTX_COMMON_DIRS : [];
  for (const directory of commonDirs) {
    const found = await searchDirectory(directory, names, 2);
    if (found) {
      const version = await readVersion(found, kind);
      logDetection(context, kind, `common:${found}`, `${kind} trouve dans un dossier usuel (${found})`);
      return { kind, found: true, path: found, origin: 'common-dir', version };
    }
  }

  const registryPath = await searchWindowsRegistry(kind);
  if (registryPath) {
    const version = await readVersion(registryPath, kind);
    logDetection(context, kind, `registry:${registryPath}`, `${kind} trouve via le registre Windows (${registryPath})`);
    return { kind, found: true, path: registryPath, origin: 'registry', version };
  }

  const pathHit = await searchInPath(names);
  if (pathHit) {
    const version = await readVersion(pathHit, kind);
    logDetection(context, kind, `path:${pathHit}`, `${kind} trouve dans le PATH (${pathHit})`);
    return { kind, found: true, path: pathHit, origin: 'path', version };
  }

  logDetection(context, kind, 'absent', `${kind} introuvable sur cette machine.`);
  return { kind, found: false };
}

export async function detectAllTools(
  logger: Logger,
  overrides: Partial<Record<DetectionKind, string>>,
  quiet = false,
): Promise<DetectedTool[]> {
  const kinds: DetectionKind[] = ['mediamtx', 'obs', 'ffmpeg'];
  const results: DetectedTool[] = [];
  for (const kind of kinds) {
    results.push(await detectTool(kind, { logger, overridePath: overrides[kind], quiet }));
  }
  return results;
}
