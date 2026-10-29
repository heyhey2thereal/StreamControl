/**
 * Genere le contenu de mediamtx.yml.
 *
 * Deux principes gouvernent ce fichier :
 *
 * 1. **Un seul port expose.** Les serveurs HTTP de MediaMTX (HLS et WebRTC)
 *    n'ecoutent que sur la boucle locale. Ils ne sont donc jamais joignables
 *    depuis un autre poste, et aucune page de MediaMTX ne peut s'ouvrir par
 *    erreur. StreamControl relaie le HLS depuis son propre serveur, qui est le
 *    seul point d'entree. C'est ce qui fait qu'une adresse inexistante ne
 *    repond jamais 200.
 *
 * 2. **Aucune authentification.** MediaMTX accepte la publication sur
 *    n'importe quel chemin. Restreindre les chemins ou activer
 *    `authMethod: internal` rejette la connexion de certaines cameras avant
 *    meme la publication, ce qui a casse la camera. Une source qui publie sur une
 *    adresse inconnue est signalee dans l'interface, sans etre bloquee.
 *
 * Seul le RTMP est expose : c'est le port que la camera doit joindre.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MediamtxSettings } from '../shared/types';

/** Adresse d'ecoute des serveurs HTTP internes de MediaMTX. */
const LOOPBACK = '127.0.0.1';

export function buildMediamtxConfig(settings: MediamtxSettings): string {
  const lines = [
    '# Fichier genere par StreamControl. Les modifications manuelles seront ecrasees.',
    'logLevel: info',
    'logDestinations: [stdout]',
    'readTimeout: 10s',
    'writeTimeout: 10s',
    '',
    // API accessible uniquement en local : c'est StreamControl qui lit l'etat
    // des flux et declare les chemins.
    'api: yes',
    `apiAddress: ${LOOPBACK}:` + settings.apiPort,
    'metrics: no',
    'pprof: no',
    '',
    'rtsp: yes',
    'rtspTransports: [udp, multicast, tcp]',
    `rtspAddress: ${LOOPBACK}:` + settings.rtspPort,
    '',
    // Seul port expose : la camera publie ici, depuis le reseau.
    'rtmp: yes',
    'rtmpAddress: :' + settings.rtmpPort,
    'rtmpEncryption: "no"',
    '',
    // HLS en boucle locale : StreamControl relaie les requetes.
    'hls: yes',
    `hlsAddress: ${LOOPBACK}:` + settings.hlsPort,
    'hlsAlwaysRemux: yes',
    // lowLatency : le flux est decoupe en parties de 200 ms, ce qui permet au
    // lecteur de rester sous la seconde. La variante mpegts, plus compatible,
    // impose des segments de 1 s et donc au moins deux secondes de retard.
    'hlsVariant: lowLatency',
    'hlsSegmentCount: 7',
    // On laisse MediaMTX choisir la duree de segment : elle doit s'aligner sur
    // l'intervalle entre images cles de la source. Imposer une valeur fixe
    // provoquait des avertissements en boucle (« part duration changed from
    // 200ms to 1.602s ») et un decoupage instable des qu'une camera publiait
    // avec des images cles espacees.
    'hlsPartDuration: 200ms',
    'hlsAllowOrigins: ["*"]',
    '',
    // WebRTC en boucle locale : la page de lecture y accede par notre serveur.
    'webrtc: yes',
    `webrtcAddress: ${LOOPBACK}:` + settings.webrtcPort,
    'webrtcAllowOrigins: ["*"]',
    'webrtcLocalUDPAddress: :8189',
    'webrtcIPsFromInterfaces: yes',
    // Le navigateur qui lit le flux est sur la meme machine : sans candidat
    // local, la connexion s'etablit mais aucun media ne circule, et l'image
    // reste noire.
    'webrtcAdditionalHosts: [127.0.0.1]',
    '',
    'srt: yes',
    'srtAddress: :8890',
    '',
    'paths:',
    '  all_others:',
    '',
  ];

  return lines.join('\n');
}

/** Dossier ou StreamControl ecrit la configuration generee. */
export function generatedConfigDir(): string {
  return path.join(app.getPath('userData'), 'mediamtx');
}

export async function writeGeneratedConfig(settings: MediamtxSettings): Promise<string> {
  const directory = generatedConfigDir();
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'mediamtx.yml');
  await fs.writeFile(target, buildMediamtxConfig(settings), 'utf8');
  return target;
}
