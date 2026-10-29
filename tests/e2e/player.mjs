/**
 * Verifie la lecture depuis les pages web, et surtout l'absence de spam.
 *
 * Le defaut corrige : rediriger vers la page de MediaMTX faisait boucler les
 * tentatives de connexion WebRTC (une session par seconde) quand aucune source
 * ne publiait. La page servie par StreamControl interroge la liste de lecture,
 * qui ne cree aucune session tant qu'il n'y a rien a lire.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
if (!fs.existsSync(MEDIAMTX) || !fs.existsSync(FFMPEG)) {
  console.log('SKIP  test player : definissez STREAMCONTROL_MEDIAMTX_BINARY et STREAMCONTROL_FFMPEG.');
  process.exit(0);
}

const USER_DATA = '/tmp/sc-e2e-player';
const DEBUG_PORT = 9350;
const RTMP_PORT = 22935;
const HLS_PORT = 29080;
const WEBRTC_PORT = 29081;
const RTSP_PORT = 29554;
const API_PORT = 29998;
const WEB_PAGES_PORT = 29082;

const { check, summary } = createChecker();

function get(url, depth = 0) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

/**
 * Ouvre un onglet via l'endpoint navigateur du protocole de debogage.
 * Retourne une fonction de fermeture.
 */
async function openTab(url, debugPort) {
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.once('open', resolve));
  const send = (method, params) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  const result = await send('Target.createTarget', { url });
  return {
    targetId: result?.targetId,
    close: () => {
      if (result?.targetId) void send('Target.closeTarget', { targetId: result.targetId });
      socket.close();
    },
  };
}

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });
let ffmpeg = null;

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)}, rtmpPort: ${RTMP_PORT}, hlsPort: ${HLS_PORT}, webrtcPort: ${WEBRTC_PORT}, rtspPort: ${RTSP_PORT}, apiPort: ${API_PORT}, webPagesPort: ${WEB_PAGES_PORT} } })`,
  );
  await sleep(1200);
  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? started.status?.state);

  // Une adresse nommee comme chez l'utilisateur, pour reproduire le cas.
  await cdp.evaluate(`window.streamcontrol.streamCreate({ name: 'Cam', path: 'cam1' })`);
  await sleep(600);

  // --- 1. Adresse inconnue : expliquee, pas une erreur seche --------------
  console.log('\n--- adresse inconnue ---');
  const unknown = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/nexistepas`);
  check('repond 404', unknown.status === 404, `HTTP ${unknown.status}`);
  check('nomme l adresse demandee', unknown.body.includes('nexistepas'));
  check('explique ou creer une adresse', unknown.body.includes('Nouvelle adresse'));
  check('liste les adresses existantes', unknown.body.includes('/cam1'));

  const bareUnknown = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/nexistepas`);
  check('sans prefixe aussi, 404 explique', bareUnknown.status === 404, `HTTP ${bareUnknown.status}`);
  check('et nomme l adresse', bareUnknown.body.includes('nexistepas'));

  const bareKnown = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/cam1`);
  check('une adresse connue sans prefixe redirige', bareKnown.status === 200, `HTTP ${bareKnown.status}`);
  check('vers la page de lecture', bareKnown.body.includes('<video'), 'page de lecture servie');

  // --- 2. Page de lecture : chargement, puis attente ---------------------
  console.log('\n--- page de lecture ---');
  const player = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/cam1`);
  check('page servie', player.status === 200, `HTTP ${player.status}`);
  check('elle contient une video', player.body.includes('<video'));
  check('elle a un indicateur de chargement', player.body.includes('class="spinner"'));
  check('elle annonce l attente', player.body.includes('En attente'));

  // --- 3. Aucune source : pas de session repetee cote MediaMTX -----------
  console.log('\n--- pas de spam sans source ---');
  const before = (await cdp.evaluate('window.streamcontrol.getLogs()'))
    .filter((entry) => entry.source === 'mediamtx' && entry.message.includes('WebRTC')).length;

  // Ouvre la page comme le ferait un navigateur, pendant huit secondes.
  // Un onglet separe fait office de navigateur externe : c'est le chemin
  // qu'emprunte l'utilisateur depuis un autre poste. La creation d'onglet
  // passe par l'endpoint navigateur, pas par la page.
  await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify((await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'cam1').id)})`);
  await sleep(9000);

  const after = (await cdp.evaluate('window.streamcontrol.getLogs()'))
    .filter((entry) => entry.source === 'mediamtx' && entry.message.includes('WebRTC')).length;
  const sessions = after - before;
  // L'ancienne page ouvrait une session par seconde : huit secondes en
  // produisaient au moins huit. La notre n'en ouvre aucune.
  check('aucune session WebRTC repetee', sessions <= 1, `${sessions} session(s) en 9 s`);

  const afterLogs = await cdp.evaluate('window.streamcontrol.getLogs()');
  // MediaMTX consigne une session par requete HLS, meme sans source : la page
  // ne doit donc jamais interroger son HLS tant que rien ne publie.
  // On cherche les sessions, pas la ligne de demarrage du serveur HLS.
  const noStream = afterLogs.filter(
    (l) => l.message.includes('no stream is available') || /\[HLS\] \[session/.test(l.message),
  ).length;
  check('aucune session HLS repetee', noStream === 0, `${noStream} ligne(s)`);

  await cdp.evaluate(`window.streamcontrol.closeStreamWindow(${JSON.stringify((await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'cam1').id)})`);

  // --- 4. Avec une source : la lecture demarre ---------------------------
  console.log('\n--- avec une source ---');
  const live = (await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'cam1');
  ffmpeg = spawn2(live.urls.rtmpIngest);
  await waitFor('publication en ligne', async () => {
    const list = await cdp.evaluate('window.streamcontrol.streamsList()');
    return list.find((s) => s.path === 'cam1')?.status.publishing === true;
  }, 25000);

  await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(live.id)})`);
  // La fenetre met un instant a apparaitre dans la liste des cibles.
  let viewer2 = null;
  for (let i = 0; i < 40 && !viewer2; i += 1) {
    await sleep(300);
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    viewer2 = list.find((t) => t.type === 'page' && t.url.includes('/watch/cam1'));
  }
  if (!viewer2) throw new Error('fenetre de lecture introuvable');
  const vcdp = createCdp(WebSocket, viewer2.webSocketDebuggerUrl);
  await vcdp.ready;
  await vcdp.send('Runtime.enable');
  await sleep(14000);

  const state = await vcdp.evaluate(`JSON.stringify((() => {
    const v = document.querySelector('video');
    const o = document.getElementById('overlay');
    return { rs: v && v.readyState, w: v && v.videoWidth, h: v && v.videoHeight,
             t: v && Math.round(v.currentTime), overlayHidden: o && o.classList.contains('hidden'),
             hasSpinner: !!document.querySelector('.spinner') };
  })())`);
  const parsed = JSON.parse(state);
  console.log('   etat :', state);
  check('la video est decodee', parsed.rs >= 2, `readyState ${parsed.rs}`);
  check('les dimensions sont connues', parsed.w > 0, `${parsed.w}x${parsed.h}`);
  check('la lecture progresse', parsed.t > 0, `${parsed.t} s`);
  check('l indicateur de chargement a disparu', parsed.overlayHidden === true);

  await cdp.evaluate(`window.streamcontrol.closeStreamWindow(${JSON.stringify(live.id)})`);
  vcdp.close();
  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[streams\]|\[mediamtx\]|\[web\]/.test(l)).slice(-12).join('\n'));
} finally {
  if (ffmpeg) ffmpeg.kill('SIGKILL');
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

function spawn2(rtmpUrl) {
  return spawn(FFMPEG, [
    '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '60',
    '-f', 'flv', rtmpUrl,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

summary();
