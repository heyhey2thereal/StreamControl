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
import type { Logger } from './logger';
import type { StreamController } from './stream-controller';
import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n';
import { renderPlayerPage, renderUnknownPathPage } from './player-page';

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

  constructor(options: WebPagesOptions) {
    this.logger = options.logger;
    this.streams = options.streams;
    this.getLanguage = options.getLanguage;
    this.isMediamtxRunning = options.isMediamtxRunning;
    this.getMediamtxPorts = options.getMediamtxPorts;
    this.getActivePort = options.getActivePort;
    this.appVersion = options.appVersion;
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

    // Tout le service depend de MediaMTX : sans lui, il n'y a rien a servir.
    if (!this.isMediamtxRunning()) {
      this.sendHtml(response, 503, renderStoppedPage(this.displayPort(), this.getLanguage()));
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      this.sendHtml(response, 400, renderUnknownPathPage('/', this.streams.list().map((entry) => entry.path), this.getLanguage()));
      return;
    }

    const segments = url.pathname.split('/').filter(Boolean);

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
   * des adresses relatives a SA racine, ex. `/osmo1/whep/<secret>` : sans ce
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
