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

export interface RemotePageOptions {
  /** Langue de l'interface du poste. */
  language: string;
  /** Vrai si un mot de passe d'acces est defini. */
  requiresPassword: boolean;
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
          '<span class="badge ' + (s.publishing ? 'live' : '') + '">' +
          (s.publishing ? L.live : L.offline) + '</span></div>' +
          (s.publishing
            ? '<div class="row"><button class="grow ' + (s.recording ? 'danger' : '') +
              '" data-rec="' + esc(s.id) + '" data-on="' + (s.recording ? '0' : '1') + '">' +
              (s.recording ? L.stopRecord : L.recording) + '</button></div>'
            : '') +
          '<video controls playsinline muted preload="none" src="' + esc(s.hls) + '"></video>' +
          '</div>';
      });
    }

    // --- Scenes OBS : transitions ---
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

    // --- Macros : les actions toutes pretes, en un bouton ---
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

    // --- Commandes du poste ---
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

    html += '</main>';
    app.innerHTML = html;
    bind();
  }

  function bind() {
    app.querySelectorAll('[data-scene]').forEach(function (b) {
      b.addEventListener('click', function () { act('/remote/scene', { scene: b.getAttribute('data-scene') }); });
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
  setInterval(function () {
    if (!token()) return;
    api('/remote/state').then(function (data) {
      state = data;
      var videos = app.querySelectorAll('video');
      if (!videos.length) { render(); return; }
      // On ne reconstruit pas la liste (la lecture se couperait) : on met a
      // jour les badges et les libelles sans toucher aux balises video.
      var cards = app.querySelectorAll('.card');
      if (cards.length) updateBadges(data);
    }).catch(function () {});
  }, 4000);

  /** Met a jour les badges d'etat sans reconstruire le DOM. */
  function updateBadges(data) {
    var streams = data.streams || [];
    var badges = app.querySelectorAll('.badge');
    var index = 0;
    streams.forEach(function (s) {
      // Deux badges par flux au plus (REC puis etat) : on les parcourt dans
      // l'ordre du rendu.
      if (s.recording && badges[index]) index += 1;
      if (badges[index]) {
        badges[index].className = 'badge ' + (s.publishing ? 'live' : '');
        badges[index].textContent = s.publishing ? L.live : L.offline;
      }
      index += 1;
    });
  }
})();
</script>
</body></html>`;
}
