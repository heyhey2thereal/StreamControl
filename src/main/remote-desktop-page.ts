/**
 * Page web de StreamControl Remote, version ordinateur.
 *
 * Un appareil du reseau qui n'est pas le poste central (un autre PC, un
 * portable) recoit cette page plutot que la version mobile. Elle montre tous
 * les flux en grille, avec leurs parametres, et permet d'enregistrer une
 * lecture **dans le navigateur** : le fichier part alors dans le dossier
 * Telechargements de l'appareil, sans rien ecrire sur le poste central.
 *
 * Tout le HTML, le CSS et le JavaScript tiennent dans cette chaine, sans
 * ressource externe hors hls.js, servi par MediaMTX via notre relais.
 *
 * Les autorisations viennent du poste : une section absente n'est pas seulement
 * masquee, elle est aussi refusee par le serveur. Masquer ne suffit pas.
 */
import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n';
import type { RemotePermissions } from '../shared/types';

export interface RemoteDesktopPageOptions {
  /** Langue de l'interface du poste. */
  language: string;
  /** Vrai si un mot de passe d'acces est defini. */
  requiresPassword: boolean;
  /** Autorisations accordees aux ordinateurs. */
  permissions: RemotePermissions;
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

/** Page servie quand le panneau distant est desactive. */
export function renderRemoteDesktopPage(options: RemoteDesktopPageOptions): string {
  const language = isLanguage(options.language) ? options.language : DEFAULT_LANGUAGE;
  const t = createTranslator(language);

  const labels = {
    title: t('remote.title'),
    desktopBadge: t('remote.desktopBadge'),
    passwordTitle: t('remote.passwordTitle'),
    passwordBody: t('remote.passwordBody'),
    passwordField: t('remote.passwordField'),
    passwordSubmit: t('remote.passwordSubmit'),
    passwordWrong: t('remote.passwordWrong'),
    connecting: t('remote.connecting'),
    waiting: t('remote.waiting'),
    refused: t('remote.refused'),
    expired: t('remote.expired'),
    retry: t('remote.retry'),
    streams: t('remote.streams'),
    noStream: t('remote.noStream'),
    live: t('state.live'),
    offline: t('state.offline'),
    scenes: t('remote.scenes'),
    noObs: t('remote.noObs'),
    take: t('remote.take'),
    recording: t('recording.start'),
    stopRecord: t('recording.stop'),
    controls: t('remote.controls'),
    lock: t('remote.lock'),
    restartMediamtx: t('remote.restartMediamtx'),
    disconnect: t('remote.disconnect'),
    refresh: t('remote.refresh'),
    confirmLock: t('remote.confirmLock'),
    confirmRestart: t('remote.confirmRestart'),
    done: t('remote.done'),
    failed: t('remote.failed'),
    noMediamtx: t('remote.noMediamtx'),
    confirmDisconnect: t('remote.confirmDisconnect'),
    cancel: t('action.cancel'),
    macros: t('remote.macros'),
    noMacros: t('remote.noMacros'),
    // Enregistrement dans le navigateur.
    downloadRecord: t('remote.downloadRecord'),
    downloadStop: t('remote.downloadStop'),
    downloadStarted: t('remote.downloadStarted'),
    downloadSaved: t('remote.downloadSaved'),
    downloadUnsupported: t('remote.downloadUnsupported'),
    downloadHint: t('remote.downloadHint'),
    watch: t('remote.watch'),
    stopWatch: t('remote.stopWatch'),
    playAll: t('remote.playAll'),
    stopAll: t('remote.stopAll'),
    liveEdge: t('remote.liveEdge'),
    fullscreen: t('remote.fullscreen'),
    fullscreenUnsupported: t('remote.fullscreenUnsupported'),
    viewers: t('remote.viewers'),
    noPermission: t('remote.noPermission'),
    // Replay a la demande : extrait telecharge sur l'appareil.
    replay: t('remote.replay'),
    replayTitle: t('remote.replayTitle'),
    replayHint: t('remote.replayHint'),
    replayFrom: t('remote.replayFrom'),
    replayTo: t('remote.replayTo'),
    replayMemory: t('remote.replayMemory'),
    replayWhole: t('remote.replayWhole'),
    replaySave: t('remote.replaySave'),
    replayBusy: t('remote.replayBusy'),
    replayDone: t('remote.replayDone'),
    replayFailed: t('remote.replayFailed'),
    replayDisabled: t('remote.replayDisabled'),
    replayUnavailable: t('remote.replayUnavailable'),
  };

  return `<!doctype html>
<html lang="${escapeHtml(language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0d0f11">
<title>${escapeHtml(t('remote.title'))}</title>
<style>
  :root { color-scheme: dark; --accent:#4ea8de; --ok:#3fb950; --err:#e5484d; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; background:#0b0d10; color:#e9ecef;
         font:14px/1.55 "Segoe UI",system-ui,sans-serif; padding-bottom:40px; }
  header { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:12px;
           padding:12px 22px; background:#14171b; border-bottom:1px solid #24272c; }
  header h1 { font-size:15px; margin:0; letter-spacing:.01em; }
  .tag { font-size:10.5px; padding:3px 9px; border-radius:999px; border:1px solid #2c3037;
         color:#8b929a; font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
  .dot { width:9px; height:9px; border-radius:50%; background:#6e767e; flex:none; }
  .dot.on { background:var(--ok); }
  .dot.err { background:var(--err); }
  .spacer { flex:1; }
  main { max-width:1500px; margin:0 auto; padding:18px 22px 0; }
  h2 { font-size:11.5px; text-transform:uppercase; letter-spacing:.09em;
       color:#7a828a; margin:26px 4px 11px; font-weight:600; }
  h2:first-child { margin-top:4px; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); }
  .card { border:1px solid #24272c; border-radius:11px; background:#14171b;
          padding:13px 14px; }
  .row { display:flex; align-items:center; gap:10px; }
  .row + .row { margin-top:9px; }
  .grow { flex:1; min-width:0; }
  .name { font-weight:600; font-size:14.5px; }
  .meta { color:#7a828a; font-size:11.5px; margin-top:2px; }
  .badge { font-size:10.5px; padding:3px 9px; border-radius:999px; flex:none;
           border:1px solid #2c3037; color:#8b929a; font-weight:600; }
  .badge.live { color:#7ee08a; border-color:#2f6b37; background:#12220f; }
  .badge.rec { color:#ff9a9e; border-color:#6b2f33; background:#221011; }
  video { width:100%; aspect-ratio:16/9; border-radius:8px; background:#000; margin-top:11px; display:block; }
  button { font:inherit; border-radius:9px; border:1px solid #2c3037; background:#1b1f24;
           color:#e9ecef; padding:9px 13px; cursor:pointer; font-size:13px; }
  button:active { transform:scale(.99); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#04121c; font-weight:600; }
  button.danger { color:#ff9a9e; border-color:#4a2427; }
  button.rec { color:#ff9a9e; border-color:#6b2f33; }
  button.rec.on { background:#e5484d; border-color:#e5484d; color:#fff; }
  button.scene { width:100%; text-align:left; }
  button.scene.active { border-color:var(--accent); color:#fff;
                        background:color-mix(in srgb, var(--accent) 20%, #1b1f24); }
  button:disabled { opacity:.45; cursor:default; }
  .scene-list { display:flex; flex-direction:column; gap:8px; }
  .actions { display:flex; gap:9px; flex-wrap:wrap; margin-top:11px; }
  .actions button { flex:1; min-width:130px; }
  /* Un flux hors ligne garde sa carte mais perd son image : elle laisserait
     croire a une diffusion active. */
  .card.offline video { display:none; }
  .card.offline { opacity:.85; }
  /* Plein ecran : la carte occupe tout l'ecran, l'image prend la place. */
  .card:fullscreen { border:0; border-radius:0; padding:12px; display:flex;
                     flex-direction:column; background:#000; }
  .card:-webkit-full-screen { border:0; border-radius:0; padding:12px; display:flex;
                              flex-direction:column; background:#000; }
  .card:fullscreen video, .card:-webkit-full-screen video { flex:1; min-height:0; aspect-ratio:auto; height:auto; }
  .card:-webkit-full-screen video { flex:1; min-height:0; aspect-ratio:auto; height:auto; }
  .macros { display:flex; gap:9px; flex-wrap:wrap; }
  .macros button { flex:0 1 auto; }
  .center { text-align:center; color:#a8b0b8; padding:70px 20px; }
  .spin { width:26px; height:26px; margin:0 auto 14px; border-radius:50%;
          border:3px solid #24272c; border-top-color:var(--accent);
          animation:sp .9s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .field { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
  input[type=password] { font:inherit; background:#0f1216; color:#e9ecef; height:44px;
                         border:1px solid #2c3037; border-radius:9px; padding:0 13px; max-width:340px; }
  .toast { position:fixed; left:50%; transform:translate(-50%,10px); bottom:22px; z-index:5;
           padding:11px 18px; border-radius:10px; background:#1b1f24;
           border:1px solid #2c3037; font-size:13.5px; text-align:center;
           opacity:0; transition:.22s; pointer-events:none; }
  .toast.show { opacity:1; transform:translate(-50%,0); }
  .toast.err { border-color:#4a2427; color:#ff9a9e; }
  .muted { color:#7a828a; font-size:13px; }
  .hint { color:#7a828a; font-size:12px; margin-top:6px; }
  /* Modale : extraire un replay. */
  .modal { position:fixed; inset:0; z-index:8; display:none; align-items:center;
           justify-content:center; background:rgba(0,0,0,.55); padding:18px; }
  .modal.open { display:flex; }
  .modal-card { background:#14171b; border:1px solid #24272c; border-radius:12px;
                padding:18px; max-width:460px; width:100%; }
  .modal-card h3 { margin:0 0 6px; font-size:15px; }
  .modal-card .meta { margin-bottom:12px; }
  .replay-fields { display:flex; gap:12px; margin:12px 0; }
  .replay-fields label { flex:1; display:flex; flex-direction:column; gap:6px;
                         font-size:12px; color:#8b929a; }
  .replay-fields input { font:inherit; background:#0f1216; color:#e9ecef; height:42px;
                         border:1px solid #2c3037; border-radius:9px; padding:0 11px; }
  .modal-actions { display:flex; gap:9px; justify-content:flex-end; margin-top:12px; }
</style></head>
<body>
<header>
  <span class="dot" id="conn"></span>
  <h1>${escapeHtml(t('remote.title'))}</h1>
  <span class="tag">${escapeHtml(t('remote.desktopBadge'))}</span>
  <span class="spacer"></span>
  <button id="reload" style="display:none">${escapeHtml(t('remote.refresh'))}</button>
</header>
<div id="app"><div class="center"><div class="spin"></div><div id="msg">${escapeHtml(t('remote.connecting'))}</div></div></div>
<div class="toast" id="toast"></div>
<div class="modal" id="replay-modal">
  <div class="modal-card">
    <h3 id="replay-title"></h3>
    <div class="meta" id="replay-memory"></div>
    <div class="hint" id="replay-hint"></div>
    <div class="replay-fields">
      <label>${escapeHtml(t('remote.replayFrom'))}
        <input type="number" id="replay-from" min="0" step="1" value="0"></label>
      <label>${escapeHtml(t('remote.replayTo'))}
        <input type="number" id="replay-to" min="0" step="1" value="0"></label>
    </div>
    <div class="modal-actions">
      <button id="replay-whole" type="button"></button>
      <button id="replay-cancel" type="button">${escapeHtml(t('action.cancel'))}</button>
      <button class="primary" id="replay-go" type="button"></button>
    </div>
  </div>
</div>

<script>
(function () {
  'use strict';
  var L = ${JSON.stringify(labels)};
  var REQUIRES_PASSWORD = ${options.requiresPassword ? 'true' : 'false'};
  var PERMISSIONS = ${JSON.stringify(options.permissions)};
  var TOKEN_KEY = 'streamcontrol-remote-token';
  var app = document.getElementById('app');
  var conn = document.getElementById('conn');
  var toastEl = document.getElementById('toast');
  var reloadBtn = document.getElementById('reload');
  var toastTimer = null;
  var state = null;
  /** Lectures en cours, par identifiant de flux : { hls }. */
  var playing = {};
  /** Enregistreurs du navigateur, par identifiant de flux. */
  var recorders = {};
  /** Vrai une fois la grille construite : on ne la reconstruit plus ensuite. */
  var gridReady = false;

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (isError ? ' err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2800);
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function api(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (token()) options.headers['X-Remote-Token'] = token();
    if (options.body) options.headers['Content-Type'] = 'application/json';
    return fetch(path, options).then(function (response) {
      // Jeton refuse : l'appareil a ete retire du poste, ou le jeton a expire.
      if (response.status === 401) {
        clearToken();
        showPairing();
        throw new Error('unauthorized');
      }
      return response.json();
    });
  }

  // --- Etapes d'acces ----------------------------------------------------
  function showPassword(message) {
    conn.className = 'dot';
    app.innerHTML =
      '<main><div class="card" style="max-width:460px">' +
      '<div class="name">' + L.passwordTitle + '</div>' +
      '<div class="meta">' + L.passwordBody + '</div>' +
      '<div class="field" style="margin-top:12px">' +
      '<input type="password" id="pw" placeholder="' + esc(L.passwordField) + '" autocomplete="off">' +
      '</div>' +
      '<button class="primary" id="pwgo">' + L.passwordSubmit + '</button>' +
      (message ? '<div class="meta" style="margin-top:10px;color:#ff9a9e">' + esc(message) + '</div>' : '') +
      '</div></main>';
    var input = document.getElementById('pw');
    var go = function () { startPairing(input.value); };
    document.getElementById('pwgo').addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    input.focus();
  }

  function showPairing() {
    reloadBtn.style.display = 'none';
    if (REQUIRES_PASSWORD) { showPassword(''); return; }
    startPairing('');
  }

  function startPairing(password) {
    conn.className = 'dot';
    app.innerHTML = '<div class="center"><div class="spin"></div><div id="msg"></div></div>';
    var msg = document.getElementById('msg');
    msg.textContent = L.connecting;
    fetch('/remote/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || '' }),
    })
      .then(function (r) {
        if (r.status === 403) { showPassword(L.passwordWrong); throw new Error('password'); }
        return r.json();
      })
      .then(function (data) {
        msg.textContent = L.waiting;
        poll(data.id, 0);
      })
      .catch(function (error) {
        if (error && error.message === 'password') return;
        msg.textContent = L.expired;
      });
  }

  function poll(id, attempt) {
    var msg = document.getElementById('msg');
    if (!msg) return;
    if (attempt > 80) { msg.textContent = L.expired; return; }
    fetch('/remote/pair/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'accepted' && data.token) { setToken(data.token); load(); return; }
        if (data.status === 'refused') { msg.textContent = L.refused; return; }
        if (data.status === 'expired') { msg.textContent = L.expired; return; }
        setTimeout(function () { poll(id, attempt + 1); }, 1500);
      })
      .catch(function () { setTimeout(function () { poll(id, attempt + 1); }, 2000); });
  }

  // --- Lecture des flux (WebRTC d'abord, puis HLS) ------------------------
  //
  // On ne joue QUE les flux demandes. Lancer tous les flux d'un coup sature
  // le decodeur du navigateur : il finit par mettre la lecture en pause de
  // lui-meme (ou par afficher une image figee), et consomme beaucoup de
  // reseau. Chaque flux reste donc en pause tant qu'on ne l'a pas demande.
  //
  // On essaie d'abord le WebRTC (WHEP), comme la page de lecture du poste :
  // c'est ce qui donne une image vraiment au direct, sans les secondes de
  // retard du HLS. Le HLS ne sert que de secours.
  function loadHlsLibrary(callback) {
    if (window.Hls) { callback(); return; }
    // hls.js est servi par MediaMTX, via notre relais : aucune ressource
    // externe, et rien a installer cote navigateur.
    var first = (state && state.streams && state.streams[0]) || null;
    var base = first ? first.hls : '';
    var src = base ? base.replace(/index\\.m3u8.*$/, 'hls.min.js') : '/hls/live/hls.min.js';
    var script = document.createElement('script');
    script.src = src;
    script.onload = callback;
    script.onerror = callback;
    document.head.appendChild(script);
  }

  /** Demarre la lecture d'un flux : WebRTC (WHEP) d'abord, HLS en secours. */
  function startPlayback(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    if (!id || !video || playing[id]) return;

    // On reserve la place tout de suite, pour qu'un double clic ne lance pas
    // deux sessions sur le meme flux.
    playing[id] = { mode: 'connecting', hls: null, peer: null, resource: null, timer: null, webrtcAttempts: 0 };
    updatePlayButtons();
    startWebrtc(card);
  }

  /**
   * Lecture WebRTC (WHEP).
   *
   * C'est le mode au plus pres du direct : aucun tampon, l'image arrive sous
   * la seconde. On ne le declare reussi qu'a l'arrivee de la premiere image ;
   * sinon le HLS prend le relais.
   */
  function startWebrtc(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    var entry = playing[id];
    if (!entry || !video) return;
    var whep = card.getAttribute('data-whep');
    if (!whep) { startHls(card); return; }

    entry.mode = 'webrtc';
    var peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    entry.peer = peer;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.addTransceiver('audio', { direction: 'recvonly' });

    peer.ontrack = function (event) {
      // Le tampon de gigue est ce qui ajoute le plus de latence : on demande au
      // decodeur de ne garder presque rien, comme la page de lecture du poste.
      try {
        if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0;
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
        if ('jitterBufferDelayHint' in event.receiver) event.receiver.jitterBufferDelayHint = 0;
      } catch (e) { /* certains navigateurs refusent : sans consequence. */ }
      video.srcObject = event.streams[0];
      video.play().catch(function () {});
      watchWebrtc(card);
    };

    peer.oniceconnectionstatechange = function () {
      if (!playing[id] || playing[id].peer !== peer) return;
      var st = peer.iceConnectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        if (video.videoWidth === 0) startHls(card);
      }
    };

    peer.createOffer()
      .then(function (offer) { return peer.setLocalDescription(offer); })
      .then(function () {
        return fetch(whep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription.sdp,
        });
      })
      .then(function (response) {
        if (!response.ok) throw new Error('WHEP ' + response.status);
        var location = response.headers.get('Location');
        if (location) {
          entry.resource = location.indexOf('http') === 0
            ? location
            : card.getAttribute('data-webrtc') + location.replace(/^\\.?\\//, '');
        }
        return response.text();
      })
      .then(function (answer) {
        if (!playing[id] || playing[id].peer !== peer) return undefined;
        return peer.setRemoteDescription({ type: 'answer', sdp: answer });
      })
      .then(function () {
        // Filet de securite : si aucune image n'arrive, le HLS prend le relais.
        setTimeout(function () {
          if (playing[id] && playing[id].mode === 'webrtc' && video.videoWidth === 0) startHls(card);
        }, 8000);
      })
      .catch(function () {
        if (playing[id] && playing[id].mode === 'webrtc') startHls(card);
      });
  }

  /**
   * Surveille l'image WebRTC : si elle se fige, on retombe sur le HLS.
   *
   * Une connexion peut etre etablie sans qu'aucune image ne defile (H.264 avec
   * images B, decodeur qui ne suit pas). On regarde donc l'avancee du temps.
   */
  function watchWebrtc(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    var last = -1;
    var stalls = 0;
    var timer = setInterval(function () {
      var entry = playing[id];
      if (!entry || entry.mode !== 'webrtc') { clearInterval(timer); return; }
      if (video.paused || video.seeking) return;
      if (video.currentTime > last + 0.05) { last = video.currentTime; stalls = 0; return; }
      stalls += 1;
      if (stalls >= 4) { clearInterval(timer); startHls(card); }
    }, 1000);
    var entry = playing[id];
    if (entry) entry.timer = timer;
  }

  /** Lecture HLS, en secours du WebRTC. */
  function startHls(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    var entry = playing[id];
    if (!entry || !video || entry.mode === 'hls') return;

    // On coupe une eventuelle session WebRTC avant de passer au HLS.
    if (entry.peer) { try { entry.peer.close(); } catch (e) {} entry.peer = null; }
    if (entry.resource) { fetch(entry.resource, { method: 'DELETE' }).catch(function () {}); entry.resource = null; }
    if (video.srcObject) { try { video.srcObject = null; } catch (e) {} }
    if (entry.timer) { clearInterval(entry.timer); entry.timer = null; }

    entry.mode = 'hls';
    var src = card.getAttribute('data-hls');

    function attach() {
      var hls = new window.Hls({
        // Memes reglages que la page de lecture du poste : on vit au plus
        // pres du direct, sans tampon inutile.
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.5,
        backBufferLength: 0,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      entry.hls = hls;
      video.play().catch(function () {});
      // Le direct ne doit pas deriver : des que le lecteur prend du retard sur
      // la fin du tampon, on le replace au plus pres.
      entry.timer = setInterval(function () {
        if (!playing[id] || video.paused || video.buffered.length === 0) return;
        var edge = video.buffered.end(video.buffered.length - 1);
        if (edge - video.currentTime > 1.5) video.currentTime = edge - 0.2;
      }, 2000);
    }

    if (window.Hls && window.Hls.isSupported()) {
      attach();
    } else if (window.Hls) {
      // HLS natif (Safari).
      video.src = src;
      video.play().catch(function () {});
    } else {
      loadHlsLibrary(function () {
        if (playing[id] && playing[id].mode === 'hls') attach();
      });
    }
  }

  /** Arrete la lecture d'un flux et libere sa session (WebRTC et HLS). */
  function stopPlayback(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    var entry = playing[id];
    if (entry) {
      if (entry.timer) clearInterval(entry.timer);
      if (entry.hls) { try { entry.hls.destroy(); } catch (e) {} }
      if (entry.peer) { try { entry.peer.close(); } catch (e) {} }
      if (entry.resource) { fetch(entry.resource, { method: 'DELETE' }).catch(function () {}); }
      delete playing[id];
    }
    if (video) {
      if (video.srcObject) { try { video.srcObject = null; } catch (e) {} }
      try { video.removeAttribute('src'); video.load(); } catch (e) {}
    }
    updatePlayButtons();
  }

  /**
   * Saute a la derniere seconde du direct.
   *
   * On vise la fin du tampon deja charge : c'est ce qu'il y a de plus proche
   * du direct, et cela fonctionne sans relancer toute la session. On complete
   * par la position de direct de hls.js si elle est connue, puis par un
   * rechargement en dernier recours.
   */
  function jumpToLive(card) {
    var id = card.getAttribute('data-id');
    var video = card.querySelector('video');
    var entry = playing[id];

    // En WebRTC, l'image est deja au direct : on ne fait rien.
    if (entry && entry.mode === 'webrtc') { toast(L.done); return; }

    if (video) {
      if (video.buffered.length > 0) {
        video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.1;
        video.play().catch(function () {});
        toast(L.done);
        return;
      }
      if (entry && entry.hls) {
        try {
          var livePosition = entry.hls.liveSyncPosition;
          if (typeof livePosition === 'number' && isFinite(livePosition)) {
            video.currentTime = livePosition;
            video.play().catch(function () {});
            toast(L.done);
            return;
          }
        } catch (e) {
          // Position indisponible : on retombe sur le rechargement ci-dessous.
        }
      }
    }

    stopPlayback(card);
    if (id) startPlayback(card);
    toast(L.done);
  }

  /**
   * Bascule l'image en plein ecran.
   *
   * On passe par l'API Fullscreen du navigateur, sur la carte entiere (et non
   * sur la balise video) : les commandes restent alors accessibles sur un PC.
   * La variante webkitRequestFullscreen couvre Safari, encore repandu.
   */
  function toggleFullscreen(card) {
    var target = card;
    var doc = document;
    var isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (isFull) {
      if (doc.exitFullscreen) doc.exitFullscreen().catch(function () {});
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      return;
    }
    var request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!request) { toast(L.fullscreenUnsupported, true); return; }
    try {
      var result = request.call(target);
      if (result && result.catch) result.catch(function () { toast(L.fullscreenUnsupported, true); });
    } catch (e) {
      toast(L.fullscreenUnsupported, true);
    }
  }

  /** Met a jour les boutons lecture / direct selon l'etat reel. */
  function updatePlayButtons() {
    app.querySelectorAll('.card[data-id]').forEach(function (card) {
      var id = card.getAttribute('data-id');
      var play = card.querySelector('[data-play]');
      var live = card.querySelector('[data-live]');
      var active = Boolean(playing[id]);
      if (play) play.textContent = active ? L.stopWatch : L.watch;
      if (live) live.style.display = active ? '' : 'none';
    });
  }

  // --- Enregistrement dans le navigateur ---------------------------------
  /** Choisit le premier format accepte par le navigateur. */
  function pickMime() {
    var candidates = [
      'video/mp4;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < candidates.length; i += 1) {
      if (window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function stamp() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function safeName(name) {
    return String(name || 'flux').replace(/[^\\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'flux';
  }

  /**
   * Enregistre la lecture affichee, puis la telecharge.
   *
   * La capture se fait sur l'element video lui-meme (captureStream) : le
   * fichier est donc exactement ce que l'appareil recoit. A l'arret, le
   * navigateur ouvre son enregistrement de fichier habituel : le fichier va
   * dans le dossier Telechargements, sans rien ecrire sur le poste central.
   *
   * @param bitsPerSecond debit vise. Sans lui, le navigateur re-encode a son
   *   propre debit, souvent bien plus eleve que la source : c'est ce qui
   *   gonflait le fichier et la consommation.
   */
  function toggleDownloadRecording(id, name, video, bitsPerSecond) {
    var existing = recorders[id];
    if (existing) { try { existing.stop(); } catch (e) {} return; }
    if (!window.MediaRecorder) { toast(L.downloadUnsupported, true); return; }
    var stream = null;
    if (video.captureStream) stream = video.captureStream();
    else if (video.mozCaptureStream) stream = video.mozCaptureStream();
    if (!stream) { toast(L.downloadUnsupported, true); return; }

    var mime = pickMime();
    var options = {};
    if (mime) options.mimeType = mime;
    // On plafonne le debit sur celui de la source : sans cela, le navigateur
    // re-encode bien au-dela, et le fichier comme la consommation explosent.
    if (bitsPerSecond && bitsPerSecond > 0) {
      options.videoBitsPerSecond = Math.round(bitsPerSecond);
      options.audioBitsPerSecond = 128000;
    }
    var recorder;
    try {
      recorder = new window.MediaRecorder(stream, options);
    } catch (e) { toast(L.downloadUnsupported, true); return; }

    var chunks = [];
    recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
    recorder.onstop = function () {
      delete recorders[id];
      updateRecordButtons();
      var type = (mime || 'video/webm').split(';')[0];
      var ext = type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: type });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeName(name) + '_' + stamp() + '.' + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast(L.downloadSaved);
    };
    recorder.start(1000);
    recorders[id] = recorder;
    updateRecordButtons();
    toast(L.downloadStarted);
  }

  function updateRecordButtons() {
    app.querySelectorAll('[data-dl]').forEach(function (b) {
      var id = b.getAttribute('data-dl');
      var active = Boolean(recorders[id]);
      b.classList.toggle('on', active);
      b.textContent = active ? L.downloadStop : L.downloadRecord;
    });
  }

  // --- Replay a la demande -----------------------------------------------
  //
  // L'extrait est assemble par le poste, puis telecharge ici. Rien n'est ecrit
  // sur le poste central : le fichier y est prepare dans un dossier temporaire,
  // telecharge, puis supprime.
  var replayTarget = null;

  function openReplayModal(id, name) {
    if (!state || !state.replay || !state.replay.enabled) { toast(L.replayDisabled, true); return; }
    replayTarget = { id: id, name: name };
    var memory = state.replay.bufferSeconds || 0;
    document.getElementById('replay-title').textContent = L.replayTitle + (name ? ' - ' + name : '');
    document.getElementById('replay-memory').textContent = L.replayMemory.replace('{seconds}', String(memory));
    document.getElementById('replay-hint').textContent = L.replayHint;
    document.getElementById('replay-whole').textContent = L.replayWhole;
    document.getElementById('replay-go').textContent = L.replaySave;
    document.getElementById('replay-from').value = String(memory);
    document.getElementById('replay-to').value = '0';
    document.getElementById('replay-modal').classList.add('open');
  }

  function closeReplayModal() {
    replayTarget = null;
    document.getElementById('replay-modal').classList.remove('open');
  }

  function submitReplay() {
    if (!replayTarget) return;
    var from = Number.parseInt(document.getElementById('replay-from').value, 10);
    var to = Number.parseInt(document.getElementById('replay-to').value, 10);
    if (!isFinite(from)) from = 0;
    if (!isFinite(to)) to = 0;
    var go = document.getElementById('replay-go');
    go.disabled = true;
    toast(L.replayBusy);
    api('/remote/replay', {
      method: 'POST',
      body: JSON.stringify({ id: replayTarget.id, fromSeconds: from, toSeconds: to }),
    })
      .then(function (result) {
        go.disabled = false;
        if (!result || result.ok !== true || !result.url) {
          toast((result && result.message) || L.replayFailed, true);
          return;
        }
        closeReplayModal();
        // On declenche le telechargement : le navigateur range le fichier dans
        // son dossier Telechargements.
        var a = document.createElement('a');
        a.href = result.url;
        a.download = safeName(replayTarget ? replayTarget.name : 'replay') + '.mp4';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(L.replayDone);
      })
      .catch(function () {
        go.disabled = false;
        toast(L.replayFailed, true);
      });
  }

  document.getElementById('replay-go').addEventListener('click', submitReplay);
  document.getElementById('replay-cancel').addEventListener('click', closeReplayModal);
  document.getElementById('replay-whole').addEventListener('click', function () {
    var memory = (state && state.replay && state.replay.bufferSeconds) || 0;
    document.getElementById('replay-from').value = String(memory);
    document.getElementById('replay-to').value = '0';
  });
  document.getElementById('replay-modal').addEventListener('click', function (event) {
    if (event.target === document.getElementById('replay-modal')) closeReplayModal();
  });

  // --- Panneau principal -------------------------------------------------
  function load() {
    conn.className = 'dot on';
    reloadBtn.style.display = '';
    api('/remote/state').then(function (data) {
      state = data;
      applyState();
    }).catch(function () {});
  }

  /**
   * Construit la coquille de la page, une seule fois.
   *
   * Les conteneurs existent toujours, meme vides : une section non autorisee
   * est simplement masquee. On ne reconstruit donc JAMAIS la grille des flux,
   * ce qui aurait pour effet de couper la lecture et les enregistrements en
   * cours, et faisait disparaitre un flux nouvellement connecte jusqu'au
   * prochain rafraichissement.
   */
  function buildShell() {
    app.innerHTML =
      '<main>' +
      '<div id="sec-streams"><div class="row" style="align-items:flex-end">' +
      '<h2 class="grow" style="margin-bottom:11px">' + L.streams + '</h2>' +
      '<div style="display:flex;gap:8px;margin-bottom:9px">' +
      '<button data-all="play">' + L.playAll + '</button>' +
      '<button data-all="stop">' + L.stopAll + '</button>' +
      '</div></div>' +
      '<div class="grid" id="streams"></div></div>' +
      '<div id="sec-obs"><h2>' + L.scenes + '</h2><div id="obs"></div></div>' +
      '<div id="sec-macros"><h2>' + L.macros + '</h2><div id="macros"></div></div>' +
      '<div id="sec-controls"><h2>' + L.controls + '</h2><div id="controls"></div></div>' +
      '</main>';
    app.addEventListener('click', onClick);
    gridReady = true;
  }

  /** Applique l'etat courant : sections et flux, sans reconstruire la grille. */
  function applyState() {
    if (!state) return;
    if (state.permissions) PERMISSIONS = state.permissions;
    if (!gridReady) buildShell();
    renderStreams(state.streams || []);
    renderObs(state.obs || {});
    renderMacros(state.macros || []);
    renderControls();
    updatePlayButtons();
    updateRecordButtons();
  }

  /** Le flux est-il en ligne et jouable ? */
  function isPlayable(s) {
    return Boolean(s && s.publishing);
  }

  /** Carte d'un flux : en-tete, image, boutons. */
  function createCard(s) {
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-id', s.id);
    card.innerHTML =
      '<div class="row">' +
      '<span class="grow"><div class="name"></div><div class="meta"></div></span>' +
      '<span class="badges"></span></div>' +
      '<video controls playsinline muted preload="none"></video>' +
      '<div class="actions"></div>' +
      '<div class="hint"></div>';
    syncCard(card, s);
    return card;
  }

  /** Met a jour une carte existante, sans toucher a la balise video. */
  function syncCard(card, s) {
    card.setAttribute('data-hls', s.hls || '');
    card.setAttribute('data-webrtc', s.webrtc || '');
    card.setAttribute('data-whep', s.whep || '');
    var playable = isPlayable(s);
    card.classList.toggle('offline', !playable);

    card.querySelector('.name').textContent = s.name || s.path;
    var meta = [];
    if (playable) {
      if (s.bitrateKbps) meta.push(Math.round(s.bitrateKbps) + ' kbit/s');
      if (s.videoWidth) meta.push(s.videoWidth + 'x' + s.videoHeight);
      if (s.viewers) meta.push(s.viewers + ' ' + L.viewers);
    }
    card.querySelector('.meta').textContent = '/' + s.path + (meta.length ? ' · ' + meta.join(' · ') : '');

    var badges = '';
    if (s.recording) badges += '<span class="badge rec">REC</span>';
    badges += '<span class="badge ' + (playable ? 'live' : '') + '">' + (playable ? L.live : L.offline) + '</span>';
    card.querySelector('.badges').innerHTML = badges;

    // Les boutons sont reconstruits a chaque mise a jour : ce ne sont pas des
    // elements media, les remplacer ne coupe rien.
    var actions = '';
    if (playable) {
      actions += '<button data-play>' + L.watch + '</button>';
      actions += '<button data-live>' + L.liveEdge + '</button>';
      actions += '<button data-full>' + L.fullscreen + '</button>';
    }
    // Replay a la demande : l'extrait est telecharge sur cet appareil.
    if (PERMISSIONS.download && playable && state && state.replay && state.replay.enabled) {
      actions += '<button data-replay="' + esc(s.id) + '" data-name="' + esc(s.name) + '">' + L.replay + '</button>';
    }
    if (PERMISSIONS.download && playable) {
      // Le debit de la source est transmis au MediaRecorder : il enregistre
      // alors au meme debit au lieu de re-encoder bien au-dela.
      actions += '<button class="rec" data-dl="' + esc(s.id) + '" data-name="' + esc(s.name) +
        '" data-bitrate="' + esc(String(Math.round((s.bitrateKbps || 0) * 1000))) + '">' +
        L.downloadRecord + '</button>';
    }
    if (PERMISSIONS.recording && playable) {
      actions += '<button class="' + (s.recording ? 'danger' : '') + '" data-rec="' + esc(s.id) +
        '" data-on="' + (s.recording ? '0' : '1') + '">' + (s.recording ? L.stopRecord : L.recording) + '</button>';
    }
    card.querySelector('.actions').innerHTML = actions;
    card.querySelector('.hint').textContent = PERMISSIONS.download && playable ? L.downloadHint : '';
  }

  /**
   * Aligne la grille sur la liste des flux, sans la reconstruire.
   *
   * Un flux apparait des sa connexion, disparait a sa deconnexion, et les
   * cartes deja affichees gardent leur lecture : c'est ce qui permet de voir un
   * flux arriver sans rafraichir la page.
   */
  function renderStreams(streams) {
    var container = document.getElementById('streams');
    if (!container) return;

    if (!streams.length) {
      // Plus aucun flux : on arrete tout et on affiche le message.
      container.querySelectorAll('.card[data-id]').forEach(function (card) {
        stopPlayback(card);
        card.remove();
      });
      if (!container.querySelector('.muted')) {
        container.innerHTML = '<div class="card muted">' + L.noStream + '</div>';
      }
      return;
    }
    var empty = container.querySelector('.muted');
    if (empty) empty.remove();

    // On construit les cartes dans l'ordre voulu, sans les deplacer quand elles
    // sont deja a leur place. Deplacer un element en plein ecran (appendChild,
    // insertBefore) fait sortir le navigateur du plein ecran : un simple
    // rafraichissement toutes les 2 s faisait donc « sortir tout seul » du
    // plein ecran. On ne deplace que ce qui a reellement change de position.
    var desired = [];
    streams.forEach(function (s) {
      var card = container.querySelector('.card[data-id="' + cssEscape(s.id) + '"]');
      if (!card) card = createCard(s);
      else syncCard(card, s);
      desired.push(card);
    });

    var reference = null;
    for (var index = desired.length - 1; index >= 0; index -= 1) {
      var node = desired[index];
      if (node.parentNode !== container || node.nextElementSibling !== reference) {
        container.insertBefore(node, reference);
      }
      reference = node;
    }

    // Un flux disparu emporte sa carte, et sa lecture est arretee.
    var keep = {};
    desired.forEach(function (node) { keep[node.getAttribute('data-id')] = true; });
    container.querySelectorAll('.card[data-id]').forEach(function (card) {
      if (!keep[card.getAttribute('data-id')]) {
        stopPlayback(card);
        card.remove();
      }
    });
  }

  /** Echappe une valeur pour un selecteur d'attribut. */
  function cssEscape(value) {
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }

  function renderObs(obs) {
    var section = document.getElementById('sec-obs');
    var container = document.getElementById('obs');
    if (!section || !container) return;
    section.style.display = PERMISSIONS.scenes ? '' : 'none';
    if (!PERMISSIONS.scenes) return;

    if (!obs.connected) {
      container.innerHTML = '<div class="card muted">' + L.noObs + '</div>';
      return;
    }
    var html = '<div class="card" style="max-width:640px"><div class="scene-list">';
    (obs.scenes || []).forEach(function (scene) {
      html += '<button class="scene' + (scene.active ? ' active' : '') +
        '" data-scene="' + esc(scene.name) + '">' + esc(scene.name) + '</button>';
    });
    html += '</div>';
    if (obs.studioMode) {
      html += '<button class="primary" style="width:100%;margin-top:10px" data-action="transition">' + L.take + '</button>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function renderMacros(macros) {
    var section = document.getElementById('sec-macros');
    var container = document.getElementById('macros');
    if (!section || !container) return;
    section.style.display = PERMISSIONS.macros ? '' : 'none';
    if (!PERMISSIONS.macros) return;

    if (!macros.length) {
      container.innerHTML = '<div class="card muted">' + L.noMacros + '</div>';
      return;
    }
    var html = '<div class="card"><div class="macros">';
    macros.forEach(function (macro) {
      html += '<button data-macro="' + esc(macro.id) + '">' + esc(macro.name) + '</button>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  }

  function renderControls() {
    var section = document.getElementById('sec-controls');
    var container = document.getElementById('controls');
    if (!section || !container) return;
    section.style.display = PERMISSIONS.controls ? '' : 'none';
    if (!PERMISSIONS.controls) return;

    var html = '<div class="card" style="max-width:640px"><div class="actions">';
    html += '<button data-action="lock">' + L.lock + '</button>';
    html += '<button class="' + (state.mediamtxRunning ? '' : 'primary') + '" data-action="restart-mediamtx">' +
      L.restartMediamtx + '</button>';
    html += '<button class="danger" data-action="disconnect">' + L.disconnect + '</button>';
    html += '</div>';
    if (!state.mediamtxRunning) html += '<div class="hint">' + L.noMediamtx + '</div>';
    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * Un seul ecouteur, sur le conteneur : les cartes etant reconstruites ou
   * remplacees, s'abonner a chacune accumulerait les ecouteurs.
   */
  function onClick(event) {
    var button = event.target.closest('button');
    if (!button || !app.contains(button)) return;
    var card = button.closest('.card[data-id]');

    if (button.hasAttribute('data-play')) {
      var id = card.getAttribute('data-id');
      if (playing[id]) stopPlayback(card);
      else startPlayback(card);
      return;
    }
    if (button.hasAttribute('data-live')) { jumpToLive(card); return; }
    if (button.hasAttribute('data-full')) { toggleFullscreen(card); return; }
    if (button.hasAttribute('data-replay')) {
      openReplayModal(button.getAttribute('data-replay'), button.getAttribute('data-name'));
      return;
    }
    if (button.hasAttribute('data-dl')) {
      // Enregistrer suppose que l'image defile : si le flux n'est pas en
      // lecture, on la demarre, sinon la capture serait vide (image figee).
      if (card && !playing[card.getAttribute('data-id')]) startPlayback(card);
      var bitrate = Number.parseInt(button.getAttribute('data-bitrate') || '0', 10) || 0;
      toggleDownloadRecording(button.getAttribute('data-dl'), button.getAttribute('data-name'),
        card ? card.querySelector('video') : null, bitrate);
      return;
    }
    if (button.hasAttribute('data-rec')) {
      button.disabled = true;
      act('/remote/action', {
        action: 'recording',
        id: button.getAttribute('data-rec'),
        record: button.getAttribute('data-on') === '1',
      });
      return;
    }
    if (button.hasAttribute('data-all')) {
      var mode = button.getAttribute('data-all');
      app.querySelectorAll('.card[data-id]').forEach(function (c) {
        if (mode === 'play') startPlayback(c);
        else stopPlayback(c);
      });
      return;
    }
    if (button.hasAttribute('data-scene')) {
      act('/remote/scene', { scene: button.getAttribute('data-scene') });
      return;
    }
    if (button.hasAttribute('data-macro')) {
      button.disabled = true;
      act('/remote/action', { action: 'macro', id: button.getAttribute('data-macro') });
      setTimeout(function () { button.disabled = false; }, 1500);
      return;
    }
    if (button.hasAttribute('data-action')) { onAction(button.getAttribute('data-action')); return; }
  }

  function onAction(action) {
    if (action === 'refresh') { load(); toast(L.done); return; }
    var question = action === 'lock' ? L.confirmLock
      : action === 'restart-mediamtx' ? L.confirmRestart
      : action === 'disconnect' ? L.confirmDisconnect : null;
    if (question && !window.confirm(question)) return;
    if (action === 'disconnect') { clearToken(); showPairing(); return; }
    act('/remote/action', { action: action });
  }

  function act(path, body) {
    api(path, { method: 'POST', body: JSON.stringify(body) })
      .then(function (result) {
        if (result && result.ok === false) { toast(result.message || L.failed, true); return; }
        toast(L.done);
        load();
      })
      .catch(function () {});
  }

  reloadBtn.addEventListener('click', function () { load(); toast(L.done); });

  if (token()) load();
  else showPairing();

  // Rafraichissement doux : on aligne la grille sur l'etat reel toutes les 2 s.
  // C'est ce qui fait apparaitre un flux des sa connexion, sans rafraichir la
  // page, et sans couper la lecture ni les enregistrements en cours.
  setInterval(function () {
    if (!token()) return;
    api('/remote/state').then(function (data) {
      state = data;
      applyState();
    }).catch(function () {});
  }, 2000);
})();
</script>
</body></html>`;
}
