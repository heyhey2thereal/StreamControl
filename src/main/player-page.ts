/**
 * Page de lecture des flux, servie par StreamControl.
 *
 * Pourquoi une page maison plutot que celle de MediaMTX : la page de MediaMTX
 * tente une connexion en boucle quand aucune source ne publie, ce qui remplit
 * le journal d'une session par seconde. Ici on interroge StreamControl, qui
 * sait deja si le flux est en ligne, et on affiche un etat lisible.
 *
 * Deux modes de lecture, dans cet ordre :
 * - **WebRTC (WHEP)** : latence inferieure a la seconde, aucun tampon. C'est le
 *   mode par defaut.
 * - **HLS** : secours quand le WebRTC n'aboutit pas. Il fonctionne partout,
 *   mais accumule forcement quelques secondes de retard.
 */

import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n';

export interface PlayerPageOptions {
  /** Langue de l'interface : les pages web suivent l'application. */
  language?: string;
  /** Nom lisible du flux. */
  name: string;
  /** Chemin du flux, ex. "live". */
  path: string;
  /** Version de l'application, affichee en pied de page. */
  version: string;
  /**
   * Affichage reduit, pour un apercu integre.
   *
   * L'en-tete et le pied de page sont masques : seule l'image reste, sans
   * commandes ni cadre.
   */
  compact?: boolean;
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

/** Traducteur de la langue demandee, ou le francais par defaut. */
function translator(language: string | undefined) {
  return createTranslator(isLanguage(language) ? language : DEFAULT_LANGUAGE);
}

export function renderPlayerPage(options: PlayerPageOptions): string {
  const t = translator(options.language);
  // Les chaines de la page voyagent en JSON : le script du client les lit, et
  // la page suit ainsi la langue choisie dans l'application.
  const strings = {
    connecting: t('page.connecting'),
    connectingShort: t('page.connectingShort'),
    checking: t('page.checking'),
    waiting: t('page.waiting'),
    waitingHint: t('page.waitingHint'),
    unknownAddress: t('page.unknownAddress'),
    unknownAddressHint: t('page.unknownAddressHint'),
    serverUnreachable: t('page.serverUnreachable'),
    serverUnreachableHint: t('page.serverUnreachableHint'),
    liveHls: t('page.liveHls'),
    liveWebrtc: t('page.liveWebrtc'),
    offline: t('page.offline'),
    retry: t('page.retry'),
    interrupted: t('page.interrupted'),
    imageAppears: t('page.imageAppears'),
    otherPlayer: t('page.otherPlayer'),
    buffered: t('page.buffered'),
  };
  const name = escapeHtml(options.name);
  const path = escapeHtml(options.path);
  const version = escapeHtml(options.version);
  // En mode reduit, on masque l'en-tete et le pied de page : il ne reste que
  // l'image, pour un apercu integre au tableau de bord.
  const compactCss = options.compact
    ? '\n  header, footer { display:none; }\n  main { padding:0; }\n  .frame { border:0; border-radius:0; max-width:none; height:100%; aspect-ratio:auto; }\n  .overlay { font-size:12px; }\n'
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} - StreamControl</title>
<style>
  :root { color-scheme: dark; --accent:#4ea8de; }
  * { box-sizing: border-box; }
  body {
    margin:0; min-height:100vh; background:#06090d; color:#e6eef6;
    font:14px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    display:flex; flex-direction:column;
  }
  header {
    display:flex; align-items:center; gap:12px;
    padding:14px 20px; border-bottom:1px solid #16202b; background:#0a1017;
  }
  .dot { width:9px; height:9px; border-radius:50%; background:#55697d; flex:none; }
  .dot.live { background:#ef4444; animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  h1 { margin:0; font-size:15px; font-weight:600; letter-spacing:.2px; }
  .sub { color:#6b8299; font-size:12px; margin-left:auto; font-variant-numeric:tabular-nums; }
  main { flex:1; display:flex; align-items:stretch; justify-content:center; padding:0; min-height:0; }
  .frame {
    /* Le retour camera occupe tout l'espace disponible, sans cadre : c'est
       l'image qu'on vient voir, pas la decoration. */
    width:100%; height:100%; max-width:none; background:#000;
    border:0; border-radius:0; overflow:hidden; position:relative;
  }
  video { width:100%; height:100%; display:block; background:#000; }
  .overlay {
    position:absolute; inset:0; display:flex; flex-direction:column; gap:14px;
    align-items:center; justify-content:center; text-align:center; padding:24px;
    color:#7c93a8; font-size:13px; background:rgba(6,9,13,.72);
  }
  .overlay.hidden { display:none; }
  .overlay strong { color:#e6eef6; font-size:15px; display:block; margin-bottom:6px; font-weight:600; }
  .overlay code { font-family:Consolas,ui-monospace,monospace; color:var(--accent); }

  /* Anneau de chargement, dessine en CSS : aucune dependance. */
  .spinner {
    width:38px; height:38px; border-radius:50%;
    border:3px solid #1d2833; border-top-color:var(--accent);
    animation:spin .9s linear infinite;
  }
  .spinner.slow { animation-duration:1.7s; border-top-color:#3f5a6e; }
  @keyframes spin { to { transform:rotate(360deg) } }

  footer {
    padding:12px 20px; border-top:1px solid #16202b; background:#0a1017;
    color:#55697d; font-size:11.5px; display:flex; gap:16px; flex-wrap:wrap;
  }
  footer code { font-family:Consolas,ui-monospace,monospace; color:#22d3ee; }
  .alt { margin-top:4px; }
  .alt a { color:var(--accent); text-decoration:none; }
  ${compactCss}</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1>${name}</h1>
  <span class="sub" id="stats">${escapeHtml(strings.connectingShort)}</span>
</header>
<main>
  <div class="frame">
    <video id="video" controls autoplay muted playsinline></video>
    <div class="overlay" id="overlay">
      <div class="spinner" id="spinner"></div>
      <div>
        <strong id="overlay-title">${escapeHtml(strings.connecting)}</strong>
        <div id="overlay-detail">${escapeHtml(strings.checking)} <code>/${path}</code>...</div>
      </div>
    </div>
  </div>
</main>
<footer>
  <span>StreamControl ${version}</span>
  <span>Source : <code>/${path}</code></span>
  <span class="alt" id="alt"></span>
</footer>

<script>
(function () {
  'use strict';

  var PATH = ${JSON.stringify(options.path)};
  var T = ${JSON.stringify(strings)};

  // Tout passe par notre serveur : les ports HTTP de MediaMTX n'ecoutent que
  // sur la boucle locale, donc rien ne doit pointer directement dessus.
  var playlist = location.origin + '/hls/' + encodeURIComponent(PATH) + '/index.m3u8';
  var scriptUrl = location.origin + '/hls/' + encodeURIComponent(PATH) + '/hls.min.js';
  // Adresse de la lecture WebRTC. La barre oblique finale est conservee : la
  // page de MediaMTX, elle, resout ses ressources relativement a l'adresse.
  var webrtcUrl = location.origin + '/webrtc/' + encodeURIComponent(PATH) + '/';
  // WHEP : la lecture WebRTC passe par un POST sur cette adresse.
  var whepUrl = location.origin + '/webrtc/' + encodeURIComponent(PATH) + '/whep';
  var resourceBase = location.origin + '/webrtc/' + encodeURIComponent(PATH) + '/';
  // StreamControl sait si le flux publie : on l'interroge lui, pas MediaMTX.
  var apiUrl = location.origin + '/api/streams';

  var video = document.getElementById('video');
  var overlay = document.getElementById('overlay');
  var spinner = document.getElementById('spinner');
  var title = document.getElementById('overlay-title');
  var detail = document.getElementById('overlay-detail');
  var dot = document.getElementById('dot');
  var stats = document.getElementById('stats');
  var alt = document.getElementById('alt');

  var hls = null;
  var peer = null;
  var resource = null;
  var pollTimer = null;
  var tickTimer = null;
  /** Minuteur de correction de la latence HLS, propre a chaque session. */
  var correctTimer = null;
  var attempts = 0;
  /** Tentatives WebRTC en cours, pour ne pas abandonner au premier refus. */
  var webrtcAttempts = 0;
  /** Mode en cours : 'idle', 'webrtc' ou 'hls'. */
  var mode = 'idle';

  /** Etat affiche : chargement, attente de la source, ou erreur. */
  function show(heading, text, spinning) {
    overlay.classList.remove('hidden');
    dot.classList.remove('live');
    title.textContent = heading;
    detail.innerHTML = text;
    spinner.style.display = spinning ? '' : 'none';
    spinner.className = spinning === 'slow' ? 'spinner slow' : 'spinner';
  }

  function hide() {
    overlay.classList.add('hidden');
    dot.classList.add('live');
  }

  function formatSeconds(value) {
    var total = Math.max(0, Math.round(value));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m > 0 ? m + ' min ' + String(s).padStart(2, '0') + ' s' : s + ' s';
  }

  function updateStats() {
    if (mode === 'hls' && video.buffered.length > 0) {
      var buffered = video.buffered.end(video.buffered.length - 1) - video.buffered.start(0);
      stats.textContent = T.liveHls + ' - ' + formatSeconds(buffered) + ' ' + T.buffered;
    } else if (mode === 'webrtc') {
      stats.textContent = T.liveWebrtc;
    }
  }

  /** Charge hls.js depuis MediaMTX, une seule fois. */
  function loadHls(callback) {
    if (window.Hls) { callback(); return; }
    var script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = callback;
    // Pas de hls.js : on tente la lecture native (Safari), sinon on le dit.
    script.onerror = callback;
    document.head.appendChild(script);
  }

  /**
   * Coupe la session WebRTC et detache la piste du lecteur.
   *
   * Detacher la piste est indispensable : un MediaStream encore attache a
   * l'element video a la priorite sur \`src\`, donc le HLS ne s'afficherait
   * jamais apres une tentative WebRTC.
   */
  function closeWebrtc() {
    if (peer) { try { peer.close(); } catch (error) { void error; } peer = null; }
    if (resource) { fetch(resource, { method: 'DELETE' }).catch(function () {}); resource = null; }
    if (video.srcObject) { try { video.srcObject = null; } catch (error) { void error; } }
  }

  function stop() {
    mode = 'idle';
    if (hls) { try { hls.destroy(); } catch (error) { void error; } hls = null; }
    closeWebrtc();
    if (correctTimer) { clearInterval(correctTimer); correctTimer = null; }
    try { video.removeAttribute('src'); video.load(); } catch (error) { void error; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  /**
   * Demarre la lecture.
   *
   * On essaie d'abord le WebRTC (WHEP), qui maintient l'image sous la seconde
   * sans tampon. S'il n'aboutit pas (source H.264 avec images B, rendu
   * logiciel, reseau qui bloque l'UDP), le HLS prend le relais automatiquement.
   */
  function startPlayback() {
    if (mode !== 'idle') return;
    hide();
    stats.textContent = T.connectingShort;
    webrtcAttempts = 0;
    startWebrtc();
  }

  /** Abandonne le WebRTC et passe au HLS. */
  function fallbackToHls() {
    closeWebrtc();
    mode = 'idle';
    startHls();
  }

  /**
   * Le WebRTC n'est pas encore disponible : on reessaie, puis on bascule.
   *
   * MediaMTX refuse la session tant qu'aucune source ne publie (« stream not
   * found »). Trois essais espaces suffisent : au-dela, la source a
   * probablement des images B, que le WebRTC ne decode pas, et le HLS prend le
   * relais sans faire attendre davantage.
   */
  function retryWebrtcOrFallback(message) {
    closeWebrtc();
    mode = 'idle';
    webrtcAttempts += 1;
    if (webrtcAttempts > 3) {
      startHls();
      return;
    }
    show(T.connecting, message || T.retry, true);
    setTimeout(function () {
      if (mode === 'idle') startWebrtc();
    }, 1200);
  }

  /**
   * Verifie que l'image WebRTC avance vraiment.
   *
   * Une connexion peut etre etablie sans qu'aucune image ne defile : MediaMTX
   * accepte la session, puis n'envoie rien si le H.264 contient des images B,
   * ou si le decodeur ne suit pas. On surveille donc l'avancee du temps de
   * lecture, et le HLS prend le relais des que l'image se fige.
   */
  function watchProgress() {
    var last = -1;
    var stalls = 0;
    var timer = setInterval(function () {
      if (mode !== 'webrtc') { clearInterval(timer); return; }
      if (video.paused || video.seeking) return;
      var now = video.currentTime;
      if (now > last + 0.05) { last = now; stalls = 0; return; }
      stalls += 1;
      if (stalls >= 3) { clearInterval(timer); fallbackToHls(); }
    }, 1000);
  }

  /**
   * Lecture WebRTC par WHEP.
   *
   * On ne la declare reussie qu'a l'arrivee de la premiere image : une
   * connexion etablie sans media donnerait un ecran noir silencieux.
   */
  function startWebrtc() {
    if (peer) return;
    mode = 'webrtc';

    // Une seule connexion ICE au lieu de deux : negociation plus rapide.
    peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.addTransceiver('audio', { direction: 'recvonly' });

    peer.ontrack = function (event) {
      // Le tampon de gigue est ce qui ajoute le plus de latence. On demande au
      // decodeur de ne garder presque rien : l'image reste au plus pres du
      // direct. Un tampon trop court provoque des micro-coupures sur un reseau
      // instable, mais la source est locale ici.
      try {
        if (typeof event.receiver.playoutDelayHint === 'number' || 'playoutDelayHint' in event.receiver) {
          event.receiver.playoutDelayHint = 0;
        }
        // Anciens noms, encore utilises par Chromium selon la version.
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
        if ('jitterBufferDelayHint' in event.receiver) event.receiver.jitterBufferDelayHint = 0;
      } catch (error) {
        void error;
      }
      video.srcObject = event.streams[0];
      video.play().catch(function () {});
      stats.textContent = T.liveWebrtc;
      if (!tickTimer) tickTimer = setInterval(updateStats, 1000);
      watchProgress();
    };

    peer.oniceconnectionstatechange = function () {
      if (!peer) return;
      var state = peer.iceConnectionState;
      // On ne juge que sur les images recues : une connexion peut etre
      // « connected » sans qu'aucun media ne circule.
      if (state === 'connected') {
        setTimeout(function () {
          if (video.videoWidth === 0 && mode === 'webrtc') fallbackToHls();
        }, 5000);
        return;
      }
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (video.videoWidth === 0 && mode === 'webrtc') fallbackToHls();
      }
    };

    peer.createOffer()
      .then(function (offer) { return peer.setLocalDescription(offer); })
      .then(function () {
        return fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription.sdp,
        });
      })
      .then(function (response) {
        if (!response.ok) {
          // On lit l'erreur de MediaMTX : « stream not found » signifie que la
          // source ne publie pas encore, pas que le WebRTC est inutilisable.
          return response.text().then(function (body) {
            var detail = '';
            try { detail = JSON.parse(body).error || ''; } catch (error) { void error; }
            throw new Error(detail || ('WHEP ' + response.status));
          });
        }
        var location = response.headers.get('Location');
        if (location) {
          resource = location.indexOf('http') === 0
            ? location
            : resourceBase + location.replace(/^\\.?\\//, '');
        }
        return response.text();
      })
      .then(function (answer) {
        if (!peer) return undefined;
        return peer.setRemoteDescription({ type: 'answer', sdp: answer });
      })
      .then(function () {
        // Filet de securite : si aucune image n'arrive, le HLS prend le relais.
        setTimeout(function () {
          if (video.videoWidth === 0 && mode === 'webrtc') fallbackToHls();
        }, 10000);
      })
      .catch(function (error) {
        if (mode !== 'webrtc') return;
        var message = error && error.message ? error.message : T.connecting;
        // « stream not found » : la source n'est pas encore en ligne, on
        // reessaie. Tout autre refus est definitif, on bascule au HLS.
        if (/not found/i.test(message)) {
          retryWebrtcOrFallback(message);
        } else {
          fallbackToHls();
        }
      });
  }

  /**
   * Lecture HLS, en secours.
   *
   * Les reglages visent le direct : petit tampon, et resynchronisation des que
   * le lecteur prend du retard. Sans cela, l'image accumule plusieurs secondes
   * de decalage et se fige.
   */
  function startHls() {
    if (mode === 'hls') return;
    mode = 'hls';
    hide();
    stats.textContent = T.liveHls;

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        // Peu de tentatives : une source absente doit afficher un message,
        // pas remplir le journal de requetes repetees.
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 1000,
        // Mode faible latence : hls.js lit alors les parties de 200 ms et
        // maintient l'image a environ une seconde du direct.
        lowLatencyMode: true,
        // On vit au plus pres du direct : on ne garde qu'un segment d'avance,
        // et on rattrape le direct des qu'on prend du retard, en accelerant
        // legerement la lecture plutot qu'en sautant une image.
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.5,
        backBufferLength: 0,
      });
      hls.loadSource(playlist);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        video.play().catch(function () {});
      });
      // Le direct ne doit pas deriver : des que le lecteur prend du retard sur
      // la fin du tampon, on le replace au plus pres. Ce minuteur vit tant que
      // la session HLS dure : l'arreter sur la premiere erreur, meme passagere,
      // laissait le lecteur deriver de plusieurs secondes.
      if (correctTimer) clearInterval(correctTimer);
      correctTimer = setInterval(function () {
        if (mode !== 'hls' || video.buffered.length === 0 || video.paused) return;
        var edge = video.buffered.end(video.buffered.length - 1);
        var lag = edge - video.currentTime;
        if (lag > 1.5) video.currentTime = edge - 0.2;
      }, 2000);
      hls.on(window.Hls.Events.ERROR, function (event, data) {
        // Seule une erreur fatale interrompt la lecture. Une erreur passagere
        // ne doit pas arreter la correction de latence.
        if (data && data.fatal) {
          stop();
          waitForStream(T.interrupted);
        }
      });
    } else {
      video.src = playlist;
      video.play().catch(function () {});
      video.addEventListener('error', function () {
        stop();
        waitForStream(T.interrupted);
      }, { once: true });
    }

    if (!tickTimer) tickTimer = setInterval(updateStats, 1000);
  }

  /**
   * Interroge StreamControl tant qu'aucune source ne publie.
   *
   * StreamControl sait deja si le flux est en ligne : il lit l'API de MediaMTX.
   * On evite ainsi d'interroger MediaMTX directement, ou chaque requete ouvre
   * une session consignee dans son journal.
   */
  function waitForStream(reason) {
    stop();
    attempts += 1;
    var heading = attempts > 3 ? T.waiting : T.connecting;
    var text = reason
      ? reason + '<br>' + T.retry
      : T.waitingHint + ' <code>/' + PATH + '</code>.';
    show(heading, text, attempts > 3 ? 'slow' : true);
    stats.textContent = T.waiting;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 2000);
  }

  function poll() {
    fetch(apiUrl + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        var stream = (payload.streams || []).filter(function (entry) {
          return entry.path === PATH;
        })[0];

        if (!stream) {
          show(T.unknownAddress,
            '<code>/' + PATH + '</code> ' + T.unknownAddressHint, 'slow');
          stats.textContent = T.offline;
          pollTimer = setTimeout(poll, 3000);
          return;
        }

        if (stream.status && stream.status.publishing) {
          startPlayback();
          return;
        }

        show(T.waiting,
          T.waitingHint + ' <code>rtmp://' + location.hostname + '/...</code>.<br>' +
          T.imageAppears, 'slow');
        stats.textContent = T.offline;
        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function () {
        show(T.serverUnreachable, T.serverUnreachableHint, 'slow');
        stats.textContent = T.offline;
        pollTimer = setTimeout(poll, 3000);
      });
  }

  // Le lien WebRTC reste propose : utile dans un navigateur avec GPU.
  alt.innerHTML = T.otherPlayer + ' <a href="' + webrtcUrl + '">WebRTC</a>';

  loadHls(function () { poll(); });
})();
</script>
</body>
</html>
`;
}

/** Page affichee quand l'adresse demandee n'existe pas. */
export function renderUnknownPathPage(path: string, known: string[], language?: string): string {
  const t = translator(language);
  const requested = escapeHtml(path.replace(/^\/+|\/+$/g, '') || '-');
  const list = known.length
    ? `<ul>${known
        .map((entry) => `<li><a href="/watch/${encodeURIComponent(entry)}">/${escapeHtml(entry)}</a></li>`)
        .join('')}</ul>`
    : `<p class="muted">${escapeHtml(t('page.noAddressShort'))}</p>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t('page.unknownTitle'))} - StreamControl</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0d0f11; color:#e9ecef; font:13px/1.6 "Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:44px 24px; }
  h1 { font-size:17px; margin:0 0 6px; }
  .sub { color:#6e767e; font-size:12.5px; margin-bottom:26px; }
  code { font-family:Consolas,monospace; color:#4ea8de; word-break:break-all; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.9px; color:#6e767e;
       margin:30px 0 12px; font-weight:600; }
  ol { padding-left:20px; color:#a8b0b8; }
  ol li { margin-bottom:10px; }
  ol strong { color:#e9ecef; display:block; font-weight:500; }
  ul { list-style:none; padding:0; margin:0; }
  li a { display:block; padding:9px 12px; border:1px solid #24272c; border-radius:4px;
         background:#121417; color:#4ea8de; text-decoration:none; margin-bottom:6px; }
  li a:hover { border-color:#3f444b; }
  .muted { color:#6e767e; }
  .btn { display:inline-block; margin-top:8px; padding:7px 14px; border-radius:4px;
         background:#4ea8de; color:#0b1a24; text-decoration:none; font-weight:600; }
</style></head>
<body><div class="wrap">
  <h1>${escapeHtml(t('page.unknownTitle'))}</h1>
  <div class="sub">${t('page.unknownSub').replace('{requested}', requested)}</div>

  <h2>${escapeHtml(t('page.createTitle'))}</h2>
  <ol>
    <li><strong>${escapeHtml(t('page.createStep1'))}</strong></li>
    <li><strong>${escapeHtml(t('page.createStep2'))}</strong></li>
    <li><strong>${escapeHtml(t('page.createStep3'))}</strong> <code>${requested}</code>.</li>
  </ol>

  <h2>${escapeHtml(t('page.existingTitle'))}</h2>
  ${list}

  <a class="btn" href="/">${escapeHtml(t('page.seeAll'))}</a>
</div></body></html>`;
}
