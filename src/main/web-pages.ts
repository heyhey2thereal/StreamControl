/**
 * Pages web de StreamControl.
 *
 * Ce petit serveur HTTP ne produit aucun flux : MediaMTX s'en charge. Il sert
 * uniquement la liste des adresses et les pages de lecture, et redirige vers
 * les URL de MediaMTX. Son interet est de fonctionner depuis un autre poste du
 * reseau, avec une adresse stable, meme quand les ports de MediaMTX changent.
 *
 * Regle importante : tant que MediaMTX est arrete, aucune page n'est servie.
 * Repondre une page de lecture vide laisserait croire que le flux est
 * disponible alors que rien ne tourne.
 */
import http from 'node:http';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { createReadStream, promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Logger } from './logger';
import type { StreamController } from './stream-controller';
import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n';
import { renderPlayerPage, renderUnknownPathPage } from './player-page';
import { renderRemoteDisabled, renderRemotePage } from './remote-page';
import { renderRemoteDesktopPage } from './remote-desktop-page';
import type { RemoteManager } from './remote';
import { describeDeviceKind } from './remote';
import type { RemotePermissions } from '../shared/types';
import type { ObsController } from './obs-controller';

export interface WebPagesOptions {
  logger: Logger;
  streams: StreamController;
  /** Langue de l'interface, appliquee aux pages servies. */
  getLanguage: () => string;
  /** Vrai si MediaMTX tourne : conditionne tout le service. */
  isMediamtxRunning: () => boolean;
  /** Ports de MediaMTX, necessaires pour construire les URL de lecture. */
  getMediamtxPorts: () => { hlsPort: number; webrtcPort: number };
  /** Port du serveur de pages, tel qu'il ecoute vraiment. */
  getActivePort: () => number;
  appVersion: string;
  /**
   * Ecran a afficher dans une cellule de scene quand le flux ne publie pas.
   *
   * Le texte est deja resolu (variables remplacees) et adapte au flux demande.
   * Absent : le comportement d'origine (message d'attente de StreamControl).
   */
  getSceneOffline?: (streamName: string) => {
    mode: 'black' | 'message';
    text: string;
    spinner: boolean;
    textColor: string;
    background: string;
  };
  /** Gestionnaire du panneau distant. Absent = Remote indisponible. */
  remote?: RemoteManager;
  /** OBS, pour les transitions demandees depuis le telephone. */
  obs?: ObsController;
  /** Actions du poste declenchables a distance (verrouiller, redemarrer...). */
  remoteActions?: RemoteActions;
  /**
   * Reglages du replay, pour le panneau distant : memoire et minimum.
   *
   * Absent = le replay n'est pas propose aux appareils.
   */
  getReplayConfig?: () => { enabled: boolean; bufferSeconds: number; minimumSeconds: number };
}

/** Actions du poste que le panneau distant peut declencher. */
export interface RemoteActions {
  /** Verrouille la session de travail du poste. */
  lockWorkstation: () => Promise<void>;
  /** Active ou arrete l'enregistrement d'un flux. */
  setStreamRecording: (id: string, record: boolean) => Promise<{ ok: boolean; message?: string }>;
  /** Redemarre MediaMTX. */
  restartMediamtx: () => Promise<{ ok: boolean; message?: string }>;
  /** Lance une macro depuis le telephone. */
  runMacro: (id: string) => Promise<{ ok: boolean; executed: number; message?: string }>;
  /** Macros actives, proposees comme boutons sur le telephone. */
  listMacros?: () => Array<{ id: string; name: string }>;
  /**
   * Prepare un replay d'un flux, a telecharger par l'appareil.
   *
   * Le fichier est assemble dans un dossier temporaire : c'est l'appareil qui
   * le telecharge, puis il est supprime. Rien n'est ecrit sur le poste.
   */
  buildReplay?: (id: string, options: { fromSeconds?: number; toSeconds?: number }) =>
    Promise<{ ok: boolean; file?: string; seconds?: number; message: string }>;
}

/** Echappe le texte insere dans le HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Page affichee quand MediaMTX n'est pas demarre. */
function renderStoppedPage(port: number, language: string): string {
  const t = createTranslator(isLanguage(language) ? language : DEFAULT_LANGUAGE);
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamControl - ${escapeHtml(t('page.serverStoppedTitle'))}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0d0f11; color:#e9ecef; font:13px/1.6 "Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:620px; margin:0 auto; padding:52px 24px; }
  h1 { font-size:17px; margin:0 0 8px; }
  .sub { color:#6e767e; font-size:12.5px; margin-bottom:26px; }
  code { font-family:Consolas,monospace; color:#4ea8de; }
  ol { padding-left:20px; color:#a8b0b8; }
  li { margin-bottom:9px; }
  .box { margin-top:24px; padding:12px 14px; border:1px solid #24272c; border-radius:4px;
         background:#121417; color:#6e767e; font-size:12px; }
</style></head>
<body><div class="wrap">
  <h1>${escapeHtml(t('page.serverStoppedTitle'))}</h1>
  <div class="sub">${escapeHtml(t('page.serverStoppedBody'))}</div>
  <ol>
    <li>${escapeHtml(t('page.serverStoppedStep1'))}</li>
    <li>${escapeHtml(t('page.serverStoppedStep2'))}</li>
    <li>${escapeHtml(t('page.serverStoppedStep3'))}</li>
  </ol>
  <div class="box">${escapeHtml(t('page.serverStoppedNote'))}</div>
</div>
<script>
  // La page se recharge d'elle-meme des que le serveur repond.
  //
  // Sans cela, une source navigateur (OBS) reste bloquee sur cet ecran : elle
  // charge la page une fois, au demarrage, et ne la recharge jamais. Il fallait
  // alors demarrer MediaMTX AVANT d'ouvrir OBS.
  (function () {
    'use strict';
    var timer = setInterval(function () {
      fetch(location.origin + '/api/streams', { cache: 'no-store' })
        .then(function (response) {
          if (response.ok) {
            clearInterval(timer);
            location.reload();
          }
        })
        .catch(function () {
          // Le serveur n'est pas encore la : on retente au prochain cycle.
        });
    }, 2000);
  })();
</script>
</body></html>`;
}

export class WebPagesServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly logger: Logger;
  private readonly streams: StreamController;
  private readonly getLanguage: () => string;
  private readonly isMediamtxRunning: () => boolean;
  private readonly getMediamtxPorts: () => { hlsPort: number; webrtcPort: number };
  /**
   * Port reellement en service.
   *
   * On interroge StreamControl plutot que de garder une copie : le port change
   * quand le reglage change, ou quand le port demande est indisponible. Une
   * copie figee ferait ouvrir la fenetre de lecture sur le mauvais port.
   */
  private readonly getActivePort: () => number;
  private readonly appVersion: string;
  private readonly getSceneOffline?: WebPagesOptions['getSceneOffline'];
  private readonly remote?: RemoteManager;
  private readonly obs?: ObsController;
  private readonly remoteActions?: RemoteActions;
  private readonly getReplayConfig?: WebPagesOptions['getReplayConfig'];
  /**
   * Replays prepares pour un appareil, en attente de telechargement.
   *
   * Le fichier est assemble a la demande, puis telecharge par l'appareil et
   * supprime. La cle est un jeton opaque : l'appareil ne connait jamais le
   * chemin sur le poste, et ne peut donc rien lire d'autre.
   */
  private readonly pendingReplays = new Map<string, { file: string; directory: string; name: string; at: number }>();

  constructor(options: WebPagesOptions) {
    this.logger = options.logger;
    this.streams = options.streams;
    this.getLanguage = options.getLanguage;
    this.isMediamtxRunning = options.isMediamtxRunning;
    this.getMediamtxPorts = options.getMediamtxPorts;
    this.getActivePort = options.getActivePort;
    this.appVersion = options.appVersion;
    this.getSceneOffline = options.getSceneOffline;
    this.remote = options.remote;
    this.obs = options.obs;
    this.remoteActions = options.remoteActions;
    this.getReplayConfig = options.getReplayConfig;
  }

  /**
   * Demarre le serveur de pages.
   *
   * Si le port demande est indisponible, on essaie les suivants : sur Windows,
   * un port peut etre refuse par le systeme (plage reservee par Hyper-V ou
   * WSL, erreur WSAEACCES), ce qui se traduit par ERR_NETWORK_ACCESS_DENIED
   * dans le navigateur. Echouer ici laisserait l'utilisateur sans aucune page.
   */
  async start(port: number, attempts = 12): Promise<number> {
    if (this.server) return this.port;

    for (let index = 0; index < attempts; index += 1) {
      const candidate = port + index;
      try {
        await this.listen(candidate);
        this.port = candidate;
        this.logger.info('web', `Pages web a l'ecoute sur le port ${candidate}.`);
        if (candidate !== port) {
          this.logger.warn(
            'web',
            `Le port ${port} est indisponible (reserve par le systeme ou deja pris). ` +
              `Les pages sont servies sur le port ${candidate}.`,
          );
        }
        return candidate;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Un port reserve par le systeme ou deja pris : on essaie le suivant.
        if (code === 'EACCES' || code === 'EADDRINUSE' || code === 'EADDRNOTAVAIL') continue;
        throw error;
      }
    }

    throw new Error(
      `Aucun port disponible entre ${port} et ${port + attempts - 1}. ` +
        'Verifiez qu\'aucune autre application ne les occupe.',
    );
  }

  /** Ouvre une seule tentative d'ecoute. */
  private listen(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((request, response) => this.handle(request, response));

      const onError = (error: NodeJS.ErrnoException) => {
        server.removeAllListeners();
        this.server = null;
        reject(error);
      };

      server.once('error', onError);
      server.listen({ port, host: '0.0.0.0' }, () => {
        server.removeListener('error', onError);
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Redemarre le serveur sur un autre port. */
  async restart(port: number): Promise<void> {
    await this.stop();
    await this.start(port);
  }

  get listening(): boolean {
    return this.server !== null;
  }

  /** Port reellement utilise, qui peut differer de celui demande. */
  get activePort(): number {
    return this.port;
  }

  /** Port a afficher dans les URL, fourni par StreamControl. */
  private displayPort(): number {
    return this.getActivePort() || this.port;
  }

  private handle(request: http.IncomingMessage, response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store');

    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      this.sendHtml(response, 400, renderUnknownPathPage('/', this.streams.list().map((entry) => entry.path), this.getLanguage()));
      return;
    }

    const segments = url.pathname.split('/').filter(Boolean);

    // --- StreamControl Remote ---------------------------------------------
    // Le panneau distant est traite AVANT le controle de MediaMTX : il doit
    // repondre meme quand MediaMTX est arrete, sinon on ne peut pas s'en servir
    // pour le redemarrer. C'est tout l'interet d'un panneau de controle.
    if (segments[0] === 'remote') {
      void this.handleRemote(request, response, segments);
      return;
    }

    // Tout le reste depend de MediaMTX : sans lui, il n'y a rien a servir.
    if (!this.isMediamtxRunning()) {
      this.sendHtml(response, 503, renderStoppedPage(this.displayPort(), this.getLanguage()));
      return;
    }

    if (url.pathname === '/api/streams') {
      this.sendJson(response, 200, {
        streams: this.streams.list().map((endpoint) => ({
          ...endpoint,
          urls: endpoint.urls,
        })),
      });
      return;
    }

    if (url.pathname === '/' || url.pathname === '') {
      this.sendHtml(response, 200, this.renderIndex());
      return;
    }

    // Le HLS passe par ici : les ports HTTP de MediaMTX n'ecoutent que sur la
    // boucle locale. On verifie d'abord que l'adresse existe, sinon une adresse
    // inventee obtiendrait le flux d'un autre.
    if (segments[0] === 'hls' && segments.length >= 2) {
      this.serveProxiedHls(request, response, url, segments.slice(1).join('/'));
      return;
    }

    // Lecture WebRTC : notre page, jamais celle de MediaMTX.
    //
    // Celle de MediaMTX affiche « stream not found » en boucle tant qu'aucune
    // source ne publie, et resout ses ressources relativement (ce qui l'a fait
    // sortir de notre prefixe). La notre attend la source, signale l'erreur
    // exacte, et retombe sur le HLS. Seul le point d'entree WHEP est relaie.
    if (segments[0] === 'webrtc' && segments.length >= 2) {
      const path = segments[1];
      const endpoint = this.streams.list().find((entry) => entry.path === path);
      if (!endpoint) {
        this.sendHtml(response, 404, renderUnknownPathPage(path, this.streams.list().map((entry) => entry.path), this.getLanguage()));
        return;
      }
      if (segments.length === 2) {
        this.sendHtml(
          response,
          200,
          renderPlayerPage({
            name: endpoint.name,
            path: endpoint.path,
            version: this.appVersion,
            language: this.getLanguage(),
          }),
        );
        return;
      }
      this.proxyTo(
        this.getMediamtxPorts().webrtcPort,
        url.pathname.replace(/^\/webrtc/, '') + (url.search ?? ''),
        response,
        request,
        0,
        '/webrtc',
      );
      return;
    }

    // Apercu integre : la meme page, sans en-tete ni pied de page. Le tableau
    // de bord l'affiche dans un cadre, ce qui evite d'ecrire un second lecteur
    // et garantit le meme comportement des deux cotes.
    if (segments[0] === 'embed' && segments.length >= 2) {
      const path = segments[1];
      const endpoint = this.streams.list().find((entry) => entry.path === path);
      if (!endpoint) {
        this.sendHtml(response, 404, renderUnknownPathPage(path, this.streams.list().map((entry) => entry.path), this.getLanguage()));
        return;
      }
      this.sendHtml(
        response,
        200,
        renderPlayerPage({
          name: endpoint.name,
          path: endpoint.path,
          version: this.appVersion,
          language: this.getLanguage(),
          compact: true,
          // L'apercu integre est ce qu'OBS affiche dans une cellule de scene :
          // c'est donc lui qui recoit l'ecran « pas de flux » choisi sur le
          // poste (noir, ou message personnalise).
          offline: this.getSceneOffline?.(endpoint.name),
        }),
      );
      return;
    }

    // Lecture : on sert notre propre page, qui gere le chargement et l'attente.
    // Rediriger vers la page de MediaMTX ferait boucler les tentatives de
    // connexion quand aucune source ne publie.
    if (segments[0] === 'watch' && segments.length >= 2) {
      const path = segments.slice(1).join('/');
      const endpoint = this.streams.list().find((entry) => entry.path === path);
      if (!endpoint) {
        // Une adresse inconnue est expliquee, avec la liste des adresses
        // existantes : une erreur seche laisse l'utilisateur bloque.
        this.sendHtml(
          response,
          404,
          renderUnknownPathPage(path, this.streams.list().map((entry) => entry.path), this.getLanguage()),
        );
        return;
      }
      this.sendHtml(
        response,
        200,
        renderPlayerPage({
          name: endpoint.name,
          path: endpoint.path,
          version: this.appVersion,
          language: this.getLanguage(),
        }),
      );
      return;
    }

    // Une adresse demandee sans prefixe est traitee comme une lecture : c'est
    // ce que fait MediaMTX, et cela evite une erreur brute sur /omso1.
    if (segments.length === 1) {
      const endpoint = this.streams.list().find((entry) => entry.path === segments[0]);
      if (endpoint) {
        response.writeHead(302, { Location: `/watch/${encodeURIComponent(endpoint.path)}` });
        response.end();
        return;
      }
      this.sendHtml(
        response,
        404,
        renderUnknownPathPage(segments[0], this.streams.list().map((entry) => entry.path), this.getLanguage()),
      );
      return;
    }

    this.sendHtml(
      response,
      404,
      renderUnknownPathPage(url.pathname.replace(/^\/+/, ''), this.streams.list().map((entry) => entry.path), this.getLanguage()),
    );
  }

  private renderIndex(): string {
    const language = this.getLanguage();
    const t = createTranslator(isLanguage(language) ? language : DEFAULT_LANGUAGE);
    const endpoints = this.streams.list();

    const cards = endpoints
      .map((endpoint) => {
        const status = endpoint.status;
        const badge = status.publishing
          ? `<span class="badge live">${escapeHtml(t('state.live'))}</span>`
          : `<span class="badge">${escapeHtml(t('page.offline'))}</span>`;
        return `
        <article class="card">
          <header><h2>${escapeHtml(endpoint.name)}</h2>${badge}</header>
          <p class="path">/${escapeHtml(endpoint.path)}</p>
          <dl>
            <dt>${escapeHtml(t('page.ingestRtmp'))}</dt><dd><code>${escapeHtml(endpoint.urls.rtmpIngest)}</code></dd>
            <dt>${escapeHtml(t('page.playbackHls'))}</dt><dd><code>${escapeHtml(endpoint.urls.hls)}</code></dd>
          </dl>
          <a class="btn" href="/watch/${encodeURIComponent(endpoint.path)}">${escapeHtml(t('page.watch'))}</a>
        </article>`;
      })
      .join('');

    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamControl - ${escapeHtml(t('page.streamsTitle'))}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#06090d; color:#e6eef6; font:14px/1.6 "Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:36px 22px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#6b8299; font-size:13px; margin-bottom:26px; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
  .card { background:#0b1119; border:1px solid #17232f; border-radius:10px; padding:16px; }
  .card header { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  .card h2 { font-size:15px; margin:0; }
  .badge { font-size:10.5px; text-transform:uppercase; letter-spacing:.6px; padding:2px 8px; border-radius:99px; border:1px solid #24333f; color:#7c93a8; }
  .badge.live { background:#ef4444; border-color:#ef4444; color:#fff; }
  .path { color:#22d3ee; font-family:Consolas,monospace; font-size:12.5px; margin:0 0 12px; }
  dl { margin:0 0 14px; font-size:12px; }
  dt { color:#6b8299; margin-top:8px; }
  dd { margin:2px 0 0; }
  code { font-family:Consolas,monospace; color:#a5c8dd; word-break:break-all; font-size:11.5px; }
  .btn { display:inline-block; padding:7px 14px; border-radius:7px; background:#22d3ee; color:#04141a; text-decoration:none; font-weight:600; font-size:12.5px; }
  .empty { color:#6b8299; padding:30px 0; }
</style></head>
<body><div class="wrap">
  <h1>StreamControl</h1>
  <div class="sub">${escapeHtml(t('page.streamsSubtitle', { version: this.appVersion }))}</div>
  <div class="grid">${cards || `<p class="empty">${escapeHtml(t('page.noAddress'))}</p>`}</div>
</div></body></html>`;
  }

  /**
   * Relaie le HLS de MediaMTX, apres avoir verifie que l'adresse existe.
   *
   * C'est ce qui rend impossible l'acces a une adresse inventee : notre serveur
   * refuse avant meme de contacter MediaMTX. Les URL de MediaMTX ne sont pas
   * exposees au reseau, donc rien ne peut le contourner.
   */
  private serveProxiedHls(
    request: http.IncomingMessage,
    response: ServerResponse,
    url: URL,
    requested: string,
  ): void {
    // `requested` peut contenir la suite du chemin : /hls/omso1/index.m3u8.
    // Seul le premier segment identifie l'adresse.
    const path = requested.split('/').filter(Boolean)[0] ?? '';
    const addresses = this.streams.list();
    const endpoint = addresses.find((entry) => entry.path === path);
    if (!endpoint) {
      this.sendHtml(response, 404, renderUnknownPathPage(path, addresses.map((entry) => entry.path)));
      return;
    }
    // On transmet le chemin complet, parametres compris : MediaMTX identifie
    // la session de lecture par `?session=...`, et les segments en dependent.
    const upstreamPath = url.pathname.replace(/^\/hls/, '') + (url.search ?? '');
    this.proxyTo(this.getMediamtxPorts().hlsPort, upstreamPath, response, request);
  }

  /**
   * Routes du panneau distant.
   *
   * `/remote` sert la page mobile ; `/remote/pair` cree une demande d'acces ;
   * `/remote/pair/<id>` donne son etat ; `/remote/state` lit l'etat courant ;
   * `/remote/scene` et `/remote/action` executent une commande OBS. Toutes les
   * routes sauf l'appairage exigent un jeton d'appareil valide.
   */
  private async handleRemote(
    request: http.IncomingMessage,
    response: ServerResponse,
    segments: string[],
  ): Promise<void> {
    if (!this.remote || !this.remote.enabled) {
      this.sendHtml(response, 200, renderRemoteDisabled(this.getLanguage()));
      return;
    }

    // La page elle-meme est servie sans jeton : c'est elle qui declenche
    // l'appairage. Les donnees, elles, exigent un jeton.
    if (segments.length === 1) {
      // La nature de l'appareil vient de son navigateur : le telephone recoit
      // la version mobile, l'ordinateur la vue complete des flux.
      const kind = describeDeviceKind(request.headers['user-agent']);
      const permissions = this.remote.permissionsFor(kind);
      const options = {
        language: this.getLanguage(),
        requiresPassword: this.remote.hasPassword,
        permissions,
      };
      this.sendHtml(response, 200, kind === 'desktop' ? renderRemoteDesktopPage(options) : renderRemotePage(options));
      return;
    }

    // --- Appairage --------------------------------------------------------
    if (segments[1] === 'pair') {
      // Nouvelle demande : cree et affiche la pop-up sur le poste.
      if (segments.length === 2 && request.method === 'POST') {
        const body = await this.readJsonBody(request);
        // Le mot de passe d'acces est exige AVANT de deranger le poste.
        if (this.remote.hasPassword && !this.remote.checkPassword(String(body.password ?? ''))) {
          this.sendJson(response, 403, { error: 'password' });
          return;
        }
        const address = request.socket.remoteAddress ?? '';
        const pair = this.remote.requestPair(request.headers['user-agent'], address);
        this.sendJson(response, 200, { id: pair.id });
        return;
      }
      // Etat d'une demande : l'appareil interroge jusqu'a la decision.
      if (segments.length === 3 && request.method === 'GET') {
        this.sendJson(response, 200, this.remote.status(segments[2]));
        return;
      }
      this.sendJson(response, 404, { error: 'unknown' });
      return;
    }

    // --- Telechargement d'un replay (avant le controle de jeton) ----------
    // Le fichier est servi sur un jeton opaque, a usage unique. La balise
    // `download` d'un navigateur ne peut PAS envoyer d'en-tete d'autorisation :
    // exiger `X-Remote-Token` ici rendait le telechargement impossible (« fichier
    // non disponible »). C'est donc le jeton d'URL qui autorise, et il n'est
    // valable qu'une fois.
    if (segments[1] === 'replay' && segments.length === 3 && request.method === 'GET') {
      this.servePendingReplay(response, segments[2]);
      return;
    }

    // --- Tout le reste exige un jeton ------------------------------------
    const device = this.remote.verify(request.headers['x-remote-token'] as string | undefined);
    if (!device) {
      this.sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    this.remote.touch(device.token);

    // Les autorisations sont relues a chaque requete : une case decochee dans
    // l'interface du poste prend effet immediatement, sans reappairage. Masquer
    // une section ne suffit pas, le serveur doit la refuser aussi.
    const permissions = this.remote.permissionsFor(device.kind ?? 'desktop');

    if (segments[1] === 'state' && request.method === 'GET') {
      this.sendJson(response, 200, await this.remoteState(permissions));
      return;
    }

    const body = request.method === 'POST' ? await this.readJsonBody(request) : {};

    if (segments[1] === 'scene' && request.method === 'POST') {
      if (!permissions.scenes) {
        this.sendJson(response, 403, { ok: false, message: 'Action non autorisee.' });
        return;
      }
      const scene = typeof body.scene === 'string' ? body.scene : '';
      if (!this.obs) {
        this.sendJson(response, 503, { ok: false, message: 'OBS indisponible.' });
        return;
      }
      const status = await this.obs.setScene(scene);
      this.sendJson(response, 200, { ok: true, obs: status });
      return;
    }

    if (segments[1] === 'action' && request.method === 'POST') {
      const action = typeof body.action === 'string' ? body.action : '';
      const result = await this.runRemoteAction(action, body, permissions);
      this.sendJson(response, result.status, result.payload);
      return;
    }

    // --- Replay depuis un appareil ----------------------------------------
    // L'extrait est assemble sur le poste, puis telecharge par l'appareil et
    // supprime : rien ne reste dans le dossier des replays du poste.
    if (segments[1] === 'replay') {
      if (!permissions.download) {
        this.sendJson(response, 403, { ok: false, message: 'Action non autorisee.' });
        return;
      }
      // Preparation : assemble l'extrait et renvoie un jeton de telechargement.
      if (segments.length === 2 && request.method === 'POST') {
        await this.prepareReplayDownload(response, body);
        return;
      }
      // Telechargement : sert le fichier prepare, puis le supprime.
      if (segments.length === 3 && request.method === 'GET') {
        this.servePendingReplay(response, segments[2]);
        return;
      }
      this.sendJson(response, 404, { error: 'unknown' });
      return;
    }

    this.sendJson(response, 404, { error: 'unknown' });
  }

  /**
   * Prepare un replay et renvoie un jeton de telechargement.
   *
   * Le fichier assemble est ecrit dans un dossier temporaire, jamais dans le
   * dossier des replays du poste. Un balayage supprime les extraits trop vieux
   * (un appareil qui a ferme la page avant de telecharger ne doit pas laisser
   * de fichiers derriere lui).
   */
  private async prepareReplayDownload(
    response: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const actions = this.remoteActions;
    if (!actions?.buildReplay) {
      this.sendJson(response, 503, { ok: false, message: 'Replay indisponible.' });
      return;
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      this.sendJson(response, 400, { ok: false, message: 'Flux manquant.' });
      return;
    }

    const fromSeconds = typeof body.fromSeconds === 'number' ? body.fromSeconds : undefined;
    const toSeconds = typeof body.toSeconds === 'number' ? body.toSeconds : undefined;

    const result = await actions.buildReplay(id, { fromSeconds, toSeconds });
    if (!result.ok || !result.file) {
      this.sendJson(response, 200, { ok: false, message: result.message });
      return;
    }

    this.sweepPendingReplays();
    const token = randomUUID();
    const directory = path.dirname(result.file);
    // Le nom du flux sert de nom de fichier au telechargement : l'appareil
    // n'herite pas d'un « replay.mp4 » anonyme.
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'replay';
    this.pendingReplays.set(token, { file: result.file, directory, name, at: Date.now() });
    this.sendJson(response, 200, {
      ok: true,
      token,
      seconds: result.seconds ?? 0,
      url: `/remote/replay/${token}`,
      name,
      message: result.message,
    });
  }

  /** Sert un replay prepare, puis supprime le fichier et son dossier. */
  private servePendingReplay(response: ServerResponse, token: string): void {
    const entry = this.pendingReplays.get(token);
    if (!entry) {
      this.sendJson(response, 404, { ok: false, message: 'Replay expire ou deja telecharge.' });
      return;
    }
    this.pendingReplays.delete(token);

    const cleanup = () => void fs.rm(entry.directory, { recursive: true, force: true }).catch(() => {});
    let stream;
    try {
      stream = createReadStream(entry.file);
    } catch {
      cleanup();
      this.sendJson(response, 404, { ok: false, message: 'Fichier introuvable.' });
      return;
    }

    // Nom de fichier lisible : le nom du flux, nettoye, horodate.
    const safe = entry.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'replay';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${safe}_${stamp}.mp4"`,
      'Cache-Control': 'no-store',
    });
    stream.pipe(response);
    stream.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  }

  /** Supprime les replays prepares mais jamais telecharges (plus de 10 min). */
  private sweepPendingReplays(): void {
    const limit = Date.now() - 10 * 60 * 1000;
    for (const [token, entry] of this.pendingReplays) {
      if (entry.at < limit) {
        this.pendingReplays.delete(token);
        void fs.rm(entry.directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Execute une action demandee depuis le telephone ou l'ordinateur.
   *
   * Toutes ces actions passent par les controleurs du poste : l'appareil ne
   * fait que les declencher, il n'a aucun acces direct au systeme. Chaque
   * action verifie l'autorisation correspondante.
   */
  private async runRemoteAction(
    action: string,
    body: Record<string, unknown>,
    permissions: RemotePermissions,
  ): Promise<{ status: number; payload: unknown }> {
    const denied = { status: 403, payload: { ok: false, message: 'Action non autorisee.' } };

    // Actions OBS.
    if (action === 'transition' || action === 'stream' || action === 'record') {
      if (!permissions.scenes) return denied;
      if (!this.obs) return { status: 503, payload: { ok: false, message: 'OBS indisponible.' } };
      let status;
      if (action === 'transition') status = await this.obs.transition();
      else if (action === 'stream') status = await this.obs.toggleStreaming();
      else status = await this.obs.toggleRecording();
      return { status: 200, payload: { ok: true, obs: status } };
    }

    // Actions du poste, fournies par StreamControl.
    const actions = this.remoteActions;
    if (!actions) return { status: 503, payload: { ok: false, message: 'Action indisponible.' } };

    switch (action) {
      case 'lock': {
        if (!permissions.controls) return denied;
        await actions.lockWorkstation();
        return { status: 200, payload: { ok: true } };
      }
      case 'recording': {
        if (!permissions.recording) return denied;
        const id = typeof body.id === 'string' ? body.id : '';
        const record = body.record === true;
        const result = await actions.setStreamRecording(id, record);
        return { status: 200, payload: { ok: result.ok, message: result.message } };
      }
      case 'restart-mediamtx': {
        if (!permissions.controls) return denied;
        const result = await actions.restartMediamtx();
        return { status: 200, payload: { ok: result.ok, message: result.message } };
      }
      case 'macro': {
        if (!permissions.macros) return denied;
        // Une macro lancee depuis l'appareil : c'est l'action la plus utile
        // du panneau distant, puisqu'elle peut tout enchainer.
        const id = typeof body.id === 'string' ? body.id : '';
        const result = await actions.runMacro(id);
        return { status: 200, payload: { ok: result.ok, executed: result.executed, message: result.message } };
      }
      default:
        return { status: 400, payload: { ok: false, message: 'Action inconnue.' } };
    }
  }

  /** Etat consolide pour l'appareil : flux, OBS, services.
   *
   * Asynchrone : la duree de replay reellement disponible demande une lecture du
   * tampon, et l'appareil doit la connaitre pour ne pas demander un extrait plus
   * long que ce qui est memorise.
   */
  private async remoteState(permissions: RemotePermissions): Promise<unknown> {
    // Duree reellement memorisee par flux : l'appareil ne doit pas proposer plus
    // que ce qui existe (le serveur le refuserait de toute facon).
    const available = new Map<string, number>();
    if (this.getReplayConfig?.().enabled) {
      await Promise.all(
        this.streams.list().map(async (endpoint) => {
          try {
            available.set(endpoint.id, await this.streams.replayAvailable(endpoint.id));
          } catch {
            available.set(endpoint.id, 0);
          }
        }),
      );
    }

    return {
      streams: this.streams.list().map((endpoint) => ({
        id: endpoint.id,
        name: endpoint.name,
        path: endpoint.path,
        publishing: endpoint.status.publishing,
        recording: endpoint.status.recording,
        bitrateKbps: endpoint.status.bitrateKbps,
        viewers: endpoint.status.viewers,
        videoWidth: endpoint.status.videoWidth,
        videoHeight: endpoint.status.videoHeight,
        // Duree de replay reellement disponible pour ce flux, en secondes.
        replaySeconds: available.get(endpoint.id) ?? 0,
        hls: `/hls/${endpoint.path}/index.m3u8`,
        // Lecture WebRTC (WHEP) : bien plus proche du direct que le HLS. Le
        // panneau distant l'essaie en premier, comme la page de lecture du
        // poste, et retombe sur le HLS si elle n'aboutit pas.
        webrtc: `/webrtc/${endpoint.path}/`,
        whep: `/webrtc/${endpoint.path}/whep`,
      })),
      obs: this.obs?.getStatus() ?? null,
      mediamtxRunning: this.isMediamtxRunning(),
      // Les macros actives, pour les proposer comme boutons sur l'appareil.
      macros: this.remoteActions?.listMacros?.() ?? [],
      // Reglages du replay : l'appareil sait ainsi si l'extraction est
      // possible, et quelle plage demander.
      replay: this.getReplayConfig?.() ?? null,
      permissions,
    };
  }

  /** Lit un corps JSON, avec une borne de taille. */
  private readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let raw = '';
      let tooLarge = false;
      request.on('data', (chunk) => {
        if (tooLarge) return;
        raw += chunk;
        if (raw.length > 64 * 1024) {
          tooLarge = true;
          raw = '';
        }
      });
      request.on('end', () => {
        if (tooLarge || !raw) {
          resolve({});
          return;
        }
        try {
          const parsed: unknown = JSON.parse(raw);
          resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
        } catch {
          resolve({});
        }
      });
      request.on('error', () => resolve({}));
    });
  }

  /**
   * Relaie une requete vers un serveur local de MediaMTX.
   *
   * La methode et le corps sont transmis tels quels : la lecture WebRTC passe
   * par un POST (WHEP) avec une offre SDP, et ne fonctionnerait pas en GET.
   *
   * MediaMTX repond un 302 vers `?cookieCheck=1` sur les URL HLS : un lecteur
   * qui ne suit pas la redirection croit que rien n'est servi. On suit donc la
   * redirection ici, pour que le client recoive toujours la ressource.
   *
   * `publicPrefix` est le prefixe de notre relais (`/webrtc`). MediaMTX renvoie
   * des adresses relatives a SA racine, ex. `/live/whep/<secret>` : sans ce
   * prefixe, le lecteur sortirait de notre chemin et obtiendrait un 404, ce qui
   * interrompt une session pourtant etablie.
   */
  private proxyTo(
    port: number,
    path: string,
    response: ServerResponse,
    request?: http.IncomingMessage,
    depth = 0,
    publicPrefix = '',
  ): void {
    const upstreamRequest = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: request?.method ?? 'GET',
        headers: {
          // On ne transmet que ce qui identifie la reponse attendue : les
          // en-tetes du client (hote, cookie, referer) ne concernent pas
          // MediaMTX et fausseraient sa reponse.
          'Content-Type': request?.headers['content-type'] ?? 'application/octet-stream',
        },
      },
      (upstream) => {
        const location = upstream.headers.location;

        // Redirection interne : on la suit, sans l'exposer au client.
        if (upstream.statusCode && upstream.statusCode >= 300 && upstream.statusCode < 400 && location && depth < 5) {
          upstream.resume();
          const next = location.startsWith('http')
            ? new URL(location).pathname + (new URL(location).search ?? '')
            : location;
          this.proxyTo(port, next, response, undefined, depth + 1, publicPrefix);
          return;
        }

        const headers: Record<string, string> = {
          'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
          // La duree change a chaque requete : aucune mise en cache.
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          // WHEP renvoie son offre dans cet en-tete : sans lui, le navigateur
          // ne peut pas etablir la session.
          'Access-Control-Expose-Headers': 'Location, Link',
        };
        if (upstream.headers.location) {
          const raw = String(upstream.headers.location);
          // Adresse absolue de MediaMTX : on la ramene sous notre prefixe.
          headers['Location'] =
            publicPrefix && raw.startsWith('/') ? `${publicPrefix}${raw}` : raw;
        }
        // LL-HLS s'appuie sur ces deux en-tetes pour savoir quand redemander la
        // liste : les perdre ferait retomber le lecteur sur une cadence lente.
        if (upstream.headers['server-control']) headers['Server-Control'] = String(upstream.headers['server-control']);
        if (upstream.headers.etag) headers['ETag'] = String(upstream.headers.etag);
        if (upstream.headers['content-length']) {
          headers['Content-Length'] = String(upstream.headers['content-length']);
        }
        response.writeHead(upstream.statusCode ?? 200, headers);
        upstream.pipe(response);
      },
    );

    upstreamRequest.on('error', () => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('MediaMTX ne repond pas.');
    });

    // Le corps de la requete (offre SDP) est transmis a MediaMTX.
    if (request) request.pipe(upstreamRequest);
    else upstreamRequest.end();
  }

  private sendJson(response: ServerResponse, status: number, payload: unknown): void {
    this.sendBuffer(
      response,
      status,
      Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      'application/json; charset=utf-8',
    );
  }

  private sendHtml(response: ServerResponse, status: number, html: string): void {
    this.sendBuffer(response, status, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  }

  private sendText(response: ServerResponse, status: number, text: string): void {
    this.sendBuffer(response, status, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8');
  }

  private sendBuffer(response: ServerResponse, status: number, body: Buffer, contentType: string): void {
    response.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': body.length,
    });
    response.end(body);
  }
}
