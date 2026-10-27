/**
 * Verification des mises a jour de StreamControl.
 *
 * L'API GitHub repond sans authentification sur un depot public ; un jeton
 * reste necessaire pour un depot prive. On lit donc, dans l'ordre, la
 * configuration de publication embarquee (electron-builder ecrit
 * `app-update.yml` dans l'application installee), puis un jeton d'environnement
 * pour le developpement. Sans jeton, la requete part quand meme : un depot
 * public repond, un depot prive renvoie 404 et la verification est ignoree.
 * Une verification impossible ne doit jamais bloquer le demarrage.
 *
 * La comparaison porte sur le NOM de la version publiee, pas sur un numero :
 * une meme version peut etre reconstruite avec des correctifs, et l'utilisateur
 * doit alors etre prevenu. Seule une version explicitement ecartee
 * (`ui.dismissedUpdateVersion`) cesse d'etre proposee.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppUpdateInfo } from '../shared/types';
import type { Logger } from './logger';

const GITHUB_API = 'https://api.github.com';

/**
 * Adresse de l'API interrogee. `STREAMCONTROL_UPDATE_API` permet de pointer un
 * serveur local : c'est ce qui rend la verification testable de bout en bout.
 */
function apiBase(): string {
  return (process.env.STREAMCONTROL_UPDATE_API ?? GITHUB_API).replace(/\/+$/, '');
}

/** Longueur maximale des notes affichees dans la fenetre de mise a jour. */
const MAX_NOTES_LENGTH = 1600;

/** Configuration de publication lue dans l'application installee. */
interface UpdateConfig {
  owner: string;
  repo: string;
  token?: string;
}

/** Lit `app-update.yml`, ecrit par electron-builder a cote du binaire. */
async function readUpdateConfig(): Promise<UpdateConfig | null> {
  const candidates = [
    // Chemin force, pour les tests de bout en bout.
    process.env.STREAMCONTROL_UPDATE_CONFIG ?? '',
    path.join(process.resourcesPath ?? '', 'app-update.yml'),
    path.join(app.getAppPath(), 'app-update.yml'),
    path.join(app.getAppPath(), '..', 'app-update.yml'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8');
      const owner = /owner:\s*(.+)/.exec(content)?.[1]?.trim();
      const repo = /repo:\s*(.+)/.exec(content)?.[1]?.trim();
      const token = /token:\s*(.+)/.exec(content)?.[1]?.trim();
      if (owner && repo) return { owner, repo, token };
    } catch {
      // Fichier absent : on essaie le suivant.
    }
  }

  return null;
}

/** En-tetes d'appel a l'API GitHub. */
function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StreamControl',
  };
  const effective = token ?? process.env.STREAMCONTROL_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (effective) headers.Authorization = `Bearer ${effective}`;
  return headers;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

/** Retire le balisage Markdown pour un affichage en texte simple. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTES_LENGTH);
}

/**
 * Interroge la derniere version publiee.
 *
 * @param force true pour ignorer la version ecartee par l'utilisateur.
 * @returns null si la verification est impossible (aucune configuration, reseau
 *   injoignable) ou si l'utilisateur a ecarte cette version.
 */
export async function checkAppUpdate(
  logger: Logger,
  options: { currentVersion: string; dismissedVersion: string; token?: string; force?: boolean },
): Promise<AppUpdateInfo | null> {
  // Le jeton vient du reglage, puis de la configuration de publication, puis de
  // l'environnement. Il est facultatif : sans lui, un depot public repond quand
  // meme, et un depot prive renvoie 404 (verification alors ignoree).
  const updateConfig = await readUpdateConfig();
  const token = options.token?.trim() || updateConfig?.token;
  const headers = githubHeaders(token);

  const config = updateConfig ?? { owner: 'heyhey2thereal', repo: 'StreamControl' };

  let release: GithubRelease;
  try {
    const response = await fetch(`${apiBase()}/repos/${config.owner}/${config.repo}/releases/latest`, {
      headers,
    });
    if (!response.ok) {
      logger.warn('updater', `Verification des mises a jour : HTTP ${response.status}`);
      return null;
    }
    release = (await response.json()) as GithubRelease;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('updater', `Verification des mises a jour impossible : ${message}`);
    return null;
  }

  const version = release.tag_name ?? release.name ?? '';
  if (!version) return null;

  // L'utilisateur a demande a ne plus etre rappele pour cette version precise.
  if (!options.force && options.dismissedVersion === version) {
    logger.info('updater', `Version ${version} ecartee par l'utilisateur, aucune notification.`);
    return null;
  }

  const current = options.currentVersion;
  const normalized = (value: string) => value.replace(/^v/i, '');
  const installer = release.assets?.find((asset) => /Setup.*\.exe$/i.test(asset.name));

  const info: AppUpdateInfo = {
    version,
    currentVersion: current,
    different: normalized(version) !== normalized(current),
    notes: stripMarkdown(release.body ?? ''),
    downloadUrl: installer?.browser_download_url ?? release.html_url ?? '',
    releaseUrl: release.html_url ?? '',
    publishedAt: release.published_at,
  };

  logger.info(
    'updater',
    `Mise a jour disponible : ${version} (installee : ${current}` +
      `${info.different ? '' : ', meme version'}).`,
  );
  return info;
}
