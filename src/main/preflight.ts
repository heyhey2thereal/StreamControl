import type { AppSettings, DetectedTool, PreflightReport } from '../shared/types';
import { detectAllTools } from './detection';
import type { Logger } from './logger';
import { checkPorts, getNetworkInfo, listIPv4ViaPowerShell } from './network';
import { buildStreamUrls } from './urls';

/**
 * Resultat de la detection des outils, garde un court instant.
 *
 * La detection parcourt le disque et le registre : la relancer toutes les cinq
 * secondes pour un resultat qui ne change presque jamais coutait cher. Le
 * rafraichissement automatique reutilise ce cache ; une verification demandee
 * par l'utilisateur (`quiet = false`) force une nouvelle detection.
 */
let toolCache: { at: number; tools: DetectedTool[] } | null = null;
const TOOL_CACHE_MS = 30_000;

/** Rassemble l'etat de la machine : adresse IPv4, outils presents, ports occupes
 * et URL de diffusion. C'est la source unique utilisee par le tableau de bord.
 */
export async function buildPreflight(
  settings: AppSettings,
  logger: Logger,
  /** Rafraichissement automatique : ne journaliser que les changements. */
  quiet = false,
): Promise<PreflightReport> {
  let network = getNetworkInfo(settings.network.overrideIPv4);

  // Sur certaines configurations (VPN, cartes multiples), la lecture Node peut
  // etre incomplete : PowerShell sert alors de secours.
  if (!network.primaryIPv4 || network.allIPv4.length === 0) {
    const extra = await listIPv4ViaPowerShell();
    if (extra.length > 0) {
      const merged = [...new Set([...network.allIPv4, ...extra])];
      network = { ...network, allIPv4: merged, primaryIPv4: merged[0] ?? null };
      logger.info('preflight', `IPv4 completees par PowerShell : ${merged.join(', ')}`);
    }
  }

  const cacheFresh = toolCache !== null && Date.now() - toolCache.at < TOOL_CACHE_MS;
  let tools: DetectedTool[];
  if (quiet && cacheFresh) {
    tools = toolCache!.tools;
  } else {
    tools = await detectAllTools(
      logger,
      { mediamtx: settings.mediamtx.binaryPath, obs: settings.obsExecutablePath },
      quiet,
    );
    toolCache = { at: Date.now(), tools };
  }

  const ports = await checkPorts([
    { port: settings.mediamtx.rtmpPort, label: 'RTMP (ingestion camera)' },
    { port: settings.mediamtx.hlsPort, label: 'HLS (lecture navigateur)' },
    { port: settings.mediamtx.webrtcPort, label: 'WebRTC (lecture faible latence)' },
    { port: settings.mediamtx.rtspPort, label: 'RTSP (lecture locale)' },
    { port: settings.obs.port, label: 'WebSocket OBS' },
  ]);

  return {
    network,
    tools,
    ports,
    urls: buildStreamUrls(settings, network),
  };
}
