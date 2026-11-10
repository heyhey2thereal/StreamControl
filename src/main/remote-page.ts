/**
 * Page web de StreamControl Remote.
 *
 * Elle est servie par le serveur de pages de StreamControl et ouverte depuis un
 * telephone du reseau local. La page se suffit a elle-meme : tout le HTML, le
 * CSS et le JavaScript sont dans cette chaine, sans ressource externe.
 *
 * Parcours d'acces :
 * 1. si un mot de passe est defini, il est demande d'abord ;
 * 2. l'appareil demande ensuite un appairage, valide sur le poste ;
 * 3. le jeton recu est conserve dans le navigateur du telephone.
 *
 * Le jeton est reverifie a chaque requete : retirer l'appareil depuis le poste
 * deconnecte le telephone au cycle suivant (reponse 401).
 */
import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n';
import type { RemotePermissions } from '../shared/types';

export interface RemotePageOptions {
  /** Langue de l'interface du poste. */
  language: string;
  /** Vrai si un mot de passe d'acces est defini. */
  requiresPassword: boolean;
  /** Autorisations accordees a cette categorie d'appareil. */
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
export function renderRemoteDisabled(language: string): string {
  const t = createTranslator(isLanguage(language) ? language : DEFAULT_LANGUAGE);
  return `<!doctype html>
<html lang="${escapeHtml(language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamControl Remote</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0d0f11; color:#e9ecef;
         font:15px/1.6 "Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:560px; margin:0 auto; padding:56px 22px; }
  h1 { font-size:19px; margin:0 0 10px; }
  p { color:#a8b0b8; }
</style></head>
<body><div class="wrap">
  <h1>StreamControl Remote</h1>
  <p>${escapeHtml(t('remote.disabledBody'))}</p>
</div></body></html>`;
}

/** Page principale du panneau de controle distant. */
export function renderRemotePage(options: RemotePageOptions): string {
  const language = isLanguage(options.language) ? options.language : DEFAULT_LANGUAGE;
  const t = createTranslator(language);

  // Les libelles sont injectes comme objet : le JavaScript de la page les
  // utilise sans reconstruire de texte cote serveur.
  const labels = {
    title: t('remote.title'),
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
    confirm: t('remote.confirm'),
    cancel: t('action.cancel'),
    macros: t('remote.macros'),
    noMacros: t('remote.noMacros'),
    macroDone: t('remote.macroDone'),
    liveEdge: t('remote.liveEdge'),
    downloadRecord: t('remote.downloadRecord'),
    downloadStop: t('remote.downloadStop'),
    downloadStarted: t('remote.downloadStarted'),
    downloadSaved: t('remote.downloadSaved'),
    downloadUnsupported: t('remote.downloadUnsupported'),
  };

  return `<!doctype html>
<html lang="${escapeHtml(language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#0d0f11">
<title>${escapeHtml(t('remote.title'))}</title>
<style>
  :root { color-scheme: dark; --accent:#4ea8de; --ok:#3fb950; --err:#e5484d; --warn:#d29922; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:#0b0d10; color:#e9ecef;
         font:15px/1.55 "Segoe UI",system-ui,sans-serif; padding-bottom:30px; }
  header { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:10px;
           padding:13px 16px; background:#14171b; border-bottom:1px solid #24272c; }
  header h1 { font-size:15px; margin:0; flex:1; letter-spacing:.01em; }
  .dot { width:9px; height:9px; border-radius:50%; background:#6e767e; flex:none; }
  .dot.on { background:var(--ok); }
  .dot.err { background:var(--err); }
  main { padding:14px 14px 0; }
  h2 { font-size:11.5px; text-transform:uppercase; letter-spacing:.09em;
       color:#7a828a; margin:20px 4px 9px; font-weight:600; }
  .card { border:1px solid #24272c; border-radius:10px; background:#14171b;
          padding:13px 14px; margin-bottom:10px; }
  .row { display:flex; align-items:center; gap:10px; }
  .row + .row { margin-top:9px; }
  .grow { flex:1; min-width:0; }
  .name { font-weight:600; font-size:14.5px; }
  .meta { color:#7a828a; font-size:11.5px; margin-top:2px; }
  .badge { font-size:10.5px; padding:3px 9px; border-radius:999px; flex:none;
           border:1px solid #2c3037; color:#8b929a; font-weight:600; }
  .badge.live { color:#7ee08a; border-color:#2f6b37; background:#12220f; }
  .badge.rec { color:#ff9a9e; border-color:#6b2f33; background:#221011; }
  video { width:100%; border-radius:8px; background:#000; margin-top:11px; display:block; }
  button { font:inherit; border-radius:9px; border:1px solid #2c3037; background:#1b1f24;
           color:#e9ecef; padding:12px 14px; min-height:46px; cursor:pointer; font-size:14px; }
  button:active { transform:scale(.985); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#04121c; font-weight:600; }
  button.danger { color:#ff9a9e; border-color:#4a2427; }
  button.rec { color:#ff9a9e; border-color:#6b2f33; }
  button.rec.on { background:#e5484d; border-color:#e5484d; color:#fff; }
  button.scene { width:100%; text-align:left; font-size:14px; }
  button.scene.active { border-color:var(--accent); color:#fff;
                        background:color-mix(in srgb, var(--accent) 20%, #1b1f24); }
  button:disabled { opacity:.45; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
  .grid.one { grid-template-columns:1fr; }
  .scene-list { display:flex; flex-direction:column; gap:8px; }
  .center { text-align:center; color:#a8b0b8; padding:56px 20px; }
  .spin { width:26px; height:26px; margin:0 auto 14px; border-radius:50%;
          border:3px solid #24272c; border-top-color:var(--accent);
          animation:sp .9s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .field { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
  input[type=password] { font:inherit; background:#0f1216; color:#e9ecef; min-height:48px;
                         border:1px solid #2c3037; border-radius:9px; padding:0 13px; }
  .toast { position:fixed; left:14px; right:14px; bottom:16px; z-index:5;
           padding:12px 14px; border-radius:10px; background:#1b1f24;
           border:1px solid #2c3037; font-size:13.5px; text-align:center;
           opacity:0; transform:translateY(10px); transition:.22s; pointer-events:none; }
  .toast.show { opacity:1; transform:none; }
  .toast.err { border-color:#4a2427; color:#ff9a9e; }
  .muted { color:#7a828a; font-size:13px; }
</style></head>
<body>
<header>
  <span class="dot" id="conn"></span>
  <h1>${escapeHtml(t('remote.title'))}</h1>
</header>
<div id="app"><div class="center"><div class="spin"></div><div id="msg">${escapeHtml(t('remote.connecting'))}</div></div></div>
<div class="toast" id="toast"></div>

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
  var toastTimer = null;

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (isError ? ' err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2600);
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
      // On efface tout et on repart de l'appairage, sans laisser croire a une
      // simple erreur reseau.
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
      '<main><div class="card">' +
      '<div class="name">' + L.passwordTitle + '</div>' +
      '<div class="meta">' + L.passwordBody + '</div>' +
      '<div class="field" style="margin-top:12px">' +
      '<input type="password" id="pw" placeholder="' + esc(L.passwordField) + '" autocomplete="off">' +
      '</div>' +
      '<button class="primary" style="width:100%" id="pwgo">' + L.passwordSubmit + '</button>' +
      (message ? '<div class="meta" style="margin-top:10px;color:#ff9a9e">' + esc(message) + '</div>' : '') +
      '</div></main>';
    var input = document.getElementById('pw');
    var go = function () { startPairing(input.value); };
    document.getElementById('pwgo').addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    input.focus();
  }

  function showPairing() {
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

  // --- Panneau principal -------------------------------------------------
  var state = null;

  function load() {
    conn.className = 'dot on';
    api('/remote/state').then(function (data) { state = data; render(); }).catch(function () {});
  }

  function render() {
    if (!state) return;
    // Les autorisations peuvent avoir change sur le poste depuis l'ouverture :
    // l'etat les renvoie, elles prennent donc effet au prochain rendu.
    if (state.permissions) PERMISSIONS = state.permissions;
    var obs = state.obs || {};
    var html = '<main>';

    // --- Flux : etat, debit, enregistrement, lecture ---
    html += '<h2>' + L.streams + '</h2>';
    if (!state.streams || !state.streams.length) {
      html += '<div class="card muted">' + L.noStream + '</div>';
    } else {
      state.streams.forEach(function (s) {
        var meta = [];
        if (s.publishing) {
          if (s.bitrateKbps) meta.push(Math.round(s.bitrateKbps) + ' kbit/s');
          if (s.videoWidth) meta.push(s.videoWidth + 'x' + s.videoHeight);
          if (s.viewers) meta.push(s.viewers + ' vue' + (s.viewers > 1 ? 's' : ''));
        }
        html += '<div class="card"><div class="row">' +
          '<span class="grow"><div class="name">' + esc(s.name) + '</div>' +
          '<div class="meta">/' + esc(s.path) + (meta.length ? ' · ' + esc(meta.join(' · ')) : '') + '</div></span>' +
          (s.recording ? '<span class="badge rec">REC</span>' : '') +
          '<span class="badge state-badge ' + (s.publishing ? 'live' : '') + '">' +
          (s.publishing ? L.live : L.offline) + '</span></div>' +
          (s.publishing && PERMISSIONS.recording
            ? '<div class="row"><button class="grow ' + (s.recording ? 'danger' : '') +
              '" data-rec="' + esc(s.id) + '" data-on="' + (s.recording ? '0' : '1') + '">' +
              (s.recording ? L.stopRecord : L.recording) + '</button></div>'
            : '') +
          '<video controls playsinline muted preload="none" src="' + esc(s.hls) + '"></video>' +
          (s.publishing
            ? '<div class="row">' +
              '<button class="grow" data-live="' + esc(s.path) + '">' + L.liveEdge + '</button>' +
              (PERMISSIONS.download
                ? '<button class="grow rec" data-dl="' + esc(s.id) + '" data-name="' + esc(s.name) +
                  '" data-bitrate="' + esc(String(Math.round((s.bitrateKbps || 0) * 1000))) + '">' +
                  L.downloadRecord + '</button>'
                : '') +
              '</div>'
            : '') +
          '</div>';
      });
    }

    // --- Scenes OBS : transitions ---
    if (PERMISSIONS.scenes) {
      html += '<h2>' + L.scenes + '</h2>';
      if (!obs.connected) {
        html += '<div class="card muted">' + L.noObs + '</div>';
      } else {
        html += '<div class="card"><div class="scene-list">';
        (obs.scenes || []).forEach(function (scene) {
          html += '<button class="scene' + (scene.active ? ' active' : '') +
            '" data-scene="' + esc(scene.name) + '">' + esc(scene.name) + '</button>';
        });
        html += '</div>';
        if (obs.studioMode) {
          html += '<button class="primary" style="width:100%;margin-top:10px" data-action="transition">' +
            L.take + '</button>';
        }
        html += '</div>';
      }
    }

    // --- Macros : les actions toutes pretes, en un bouton ---
    if (PERMISSIONS.macros) {
      var macros = state.macros || [];
      html += '<h2>' + L.macros + '</h2>';
      if (!macros.length) {
        html += '<div class="card muted">' + L.noMacros + '</div>';
      } else {
        html += '<div class="card"><div class="grid">';
        macros.forEach(function (macro) {
          html += '<button data-macro="' + esc(macro.id) + '">' + esc(macro.name) + '</button>';
        });
        html += '</div></div>';
      }
    }

    // --- Commandes du poste ---
    if (PERMISSIONS.controls) {
      html += '<h2>' + L.controls + '</h2><div class="card"><div class="grid">';
      html += '<button data-action="lock">' + L.lock + '</button>';
      html += '<button data-action="refresh">' + L.refresh + '</button>';
      html += '<button class="' + (state.mediamtxRunning ? '' : 'primary') + '" data-action="restart-mediamtx">' +
        L.restartMediamtx + '</button>';
      html += '<button class="danger" data-action="disconnect">' + L.disconnect + '</button>';
      html += '</div>';
      if (!state.mediamtxRunning) {
        html += '<div class="meta" style="margin-top:10px">' + L.noMediamtx + '</div>';
      }
      html += '</div>';
    }

    html += '</main>';
    app.innerHTML = html;
    bind();
    updateRecordButtons();
  }

  function bind() {
    app.querySelectorAll('[data-scene]').forEach(function (b) {
      b.addEventListener('click', function () { act('/remote/scene', { scene: b.getAttribute('data-scene') }); });
    });
    app.querySelectorAll('[data-live]').forEach(function (b) {
      // Retour au direct : on vise la fin du tampon deja charge, ce qui recolle
      // a la derniere seconde sans relancer toute la session. Le lecteur HLS
      // garde sinon un petit tampon de retard.
      b.addEventListener('click', function () {
        var card = b.closest('.card');
        var video = card ? card.querySelector('video') : null;
        if (!video) return;
        if (video.buffered.length > 0) {
          video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.1;
          video.play().catch(function () {});
          toast(L.liveEdge);
          return;
        }
        // Aucun tampon connu : on recharge la source, ce qui repart du direct.
        var src = video.getAttribute('src');
        video.setAttribute('src', '');
        video.load();
        video.setAttribute('src', src);
        video.load();
        video.play().catch(function () {});
        toast(L.liveEdge);
      });
    });
    app.querySelectorAll('[data-rec]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        act('/remote/action', {
          action: 'recording',
          id: b.getAttribute('data-rec'),
          record: b.getAttribute('data-on') === '1',
        });
      });
    });
    app.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () {
        var card = b.closest('.card');
        var video = card ? card.querySelector('video') : null;
        var bitrate = Number.parseInt(b.getAttribute('data-bitrate') || '0', 10) || 0;
        toggleDownloadRecording(b.getAttribute('data-dl'), b.getAttribute('data-name'), video, bitrate);
      });
    });
    app.querySelectorAll('[data-action]').forEach(function (b) {
      b.addEventListener('click', function () { onAction(b.getAttribute('data-action')); });
    });
    app.querySelectorAll('[data-macro]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        act('/remote/action', { action: 'macro', id: b.getAttribute('data-macro') });
        setTimeout(function () { b.disabled = false; }, 1500);
      });
    });
  }

  // --- Enregistrement dans le navigateur (Telechargements) ---------------
  /** Enregistreurs en cours, par identifiant de flux. */
  var recorders = {};

  /** Choisit le premier format accepte, MP4 en priorite. */
  function pickMime() {
    var candidates = [
      'video/mp4;codecs=h264',
      'video/mp4',
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
   * La capture se fait sur l'element video lui-meme (captureStream) : le fichier
   * est donc exactement ce que le telephone recoit. Le format vise est le MP4
   * (H.264) quand le navigateur le sait ; a defaut le WebM est utilise, faute de
   * mieux. A l'arret, le navigateur telecharge le fichier dans son dossier
   * Telechargements, sans rien ecrire sur le poste central.
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

  /** Met a jour les boutons d'enregistrement selon l'etat reel. */
  function updateRecordButtons() {
    app.querySelectorAll('[data-dl]').forEach(function (b) {
      var id = b.getAttribute('data-dl');
      var active = Boolean(recorders[id]);
      b.classList.toggle('on', active);
      b.textContent = active ? L.downloadStop : L.downloadRecord;
    });
  }

  function onAction(action) {
    if (action === 'refresh') { load(); toast(L.done); return; }
    // Les actions sensibles demandent une confirmation.
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

  // Au chargement : jeton present, on entre ; sinon, mot de passe puis appairage.
  if (token()) load();
  else showPairing();

  // Rafraichissement doux : l'etat des flux et d'OBS, sans couper la video.
  // Une deconnexion (401) est detectee ici aussi : le telephone revient alors
  // de lui-meme sur l'ecran d'appairage.
  //
  // On ne reconstruit PAS la page tant que la liste des flux et les
  // autorisations sont les memes : sinon la lecture en cours serait coupee a
  // chaque cycle. Des qu'un flux apparait, disparait, ou qu'un droit change,
  // on redessine, pour que l'utilisateur n'ait jamais a rafraichir a la main.
  var lastSignature = null;
  function signature(data) {
    return JSON.stringify({
      ids: (data.streams || []).map(function (s) { return s.id + ':' + (s.publishing ? 1 : 0); }),
      permissions: data.permissions || null,
    });
  }
  setInterval(function () {
    if (!token()) return;
    api('/remote/state').then(function (data) {
      state = data;
      var current = signature(data);
      // Une lecture ou un enregistrement est en cours : on ne redessine pas,
      // sinon l'image se couperait (et la capture serait interrompue). On se
      // contente de mettre a jour les badges.
      if (app.querySelectorAll('video').length || Object.keys(recorders).length) {
        lastSignature = current;
        updateBadges(data);
        return;
      }
      if (current !== lastSignature) { lastSignature = current; render(); return; }
    }).catch(function () {});
  }, 3000);

  /** Met a jour les badges d'etat sans reconstruire le DOM. */
  function updateBadges(data) {
    var streams = data.streams || [];
    // On cible le badge d'etat par sa classe dediee : compter les badges par
    // position devenait faux des qu'un badge REC apparaissait ou disparaissait.
    var stateBadges = app.querySelectorAll('.state-badge');
    streams.forEach(function (s, index) {
      var badge = stateBadges[index];
      if (!badge) return;
      badge.className = 'badge state-badge ' + (s.publishing ? 'live' : '');
      badge.textContent = s.publishing ? L.live : L.offline;
    });
  }
})();
</script>
</body></html>`;
}
