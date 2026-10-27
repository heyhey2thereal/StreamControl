import type { AppSettings, NetworkInfo, StreamUrls } from '../shared/types';

/** Extrait le premier segment de chemin : "live/cam1" -> "live". */
export function rootStreamPath(streamPath: string): string {
  const clean = streamPath.replace(/^\/+|\/+$/g, '');
  const [first] = clean.split('/');
  return first || 'live';
}

function hostFor(network: NetworkInfo): string {
  return network.primaryIPv4 ?? '127.0.0.1';
}

/**
 * Construit toutes les URL de diffusion a partir de l'IPv4 locale du PC.
 * Les URL d'ingestion sont celles a saisir dans l'application DJI Mimo.
 */
export function buildStreamUrls(settings: AppSettings, network: NetworkInfo): StreamUrls {
  const host = hostFor(network);
  const { rtmpPort, hlsPort, webrtcPort, rtspPort, streamPath } = settings.mediamtx;
  const path = streamPath.replace(/^\/+|\/+$/g, '') || 'live';

  return {
    streamKey: path,
    rtmpIngest: `rtmp://${host}:${rtmpPort}/${path}`,
    rtmpPlayback: `rtmp://${host}:${rtmpPort}/${path}`,
    srtIngest: `srt://${host}:8890?streamid=publish:${path}`,
    webrtc: `http://${host}:${webrtcPort}/${path}`,
    hls: `http://${host}:${hlsPort}/${path}/index.m3u8`,
    rtsp: `rtsp://${host}:${rtspPort}/${path}`,
    webrtcPlayer: `http://${host}:${webrtcPort}/${path}`,
    hlsPlayer: `http://${host}:${hlsPort}/${path}/`,
  };
}

/** Bloc de configuration a copier dans OBS pour publier vers MediaMTX. */
export function buildObsIngestHint(settings: AppSettings, network: NetworkInfo): string {
  const host = hostFor(network);
  const path = settings.mediamtx.streamPath.replace(/^\/+|\/+$/g, '') || 'live';
  return [
    'OBS > Parametres > Diffusion > Service : Personnalise...',
    `Serveur : rtmp://${host}:${settings.mediamtx.rtmpPort}/${rootStreamPath(path)}`,
    `Cle de flux : ${path.includes('/') ? path.split('/').slice(1).join('/') : 'a-la-demande'}`,
  ].join('\n');
}
