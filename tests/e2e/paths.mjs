/**
 * Verifie que seules les adresses creees dans l'interface existent.
 *
 * Le defaut corrige : MediaMTX acceptait n'importe quel chemin (regle
 * `all_others`), donc une adresse inventee fonctionnait et sa page s'ouvrait.
 * Chaque adresse de l'interface est desormais declaree explicitement.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
if (!fs.existsSync(MEDIAMTX) || !fs.existsSync(FFMPEG)) {
  console.log('SKIP  test paths : definissez STREAMCONTROL_MEDIAMTX_BINARY et STREAMCONTROL_FFMPEG.');
  process.exit(0);
}

const USER_DATA = '/tmp/sc-e2e-paths';
const DEBUG_PORT = 9351;
const RTMP_PORT = 23935;
const HLS_PORT = 30080;
const WEBRTC_PORT = 30081;
const RTSP_PORT = 30554;
const API_PORT = 30997;
const WEB_PAGES_PORT = 30082;

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
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }),
      );
    }).on('error', () => resolve({ status: 0, body: '', headers: {} }));
  });
}

/**
 * Interroge un port TCP et retourne vrai s'il repond.
 *
 * Sert a verifier que les serveurs HTTP de MediaMTX ne sont PAS joignables
 * depuis le reseau : c'est ce qui garantit qu'aucune page de MediaMTX ne peut
 * s'ouvrir, et qu'une adresse inventee ne peut pas repondre.
 */
function reachable(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Requete brute, pour lire le statut et l'en-tete d'authentification. */
function rawGet(url, depth = 0) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        resolve(rawGet(new URL(res.headers.location, url).toString(), depth + 1));
        return;
      }
      res.resume();
      resolve({ status: res.statusCode, wwwAuth: res.headers['www-authenticate'] ?? '' });
    }).on('error', () => resolve({ status: 0, wwwAuth: '' }));
  });
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
  await sleep(1000);
  await cdp.evaluate(`window.streamcontrol.streamCreate({ name: 'Cam', path: 'cam1' })`);
  await sleep(800);

  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? started.status?.state);
  await sleep(2000);

  // --- 1. Les serveurs HTTP de MediaMTX sont en boucle locale -------------
  // C'est le point central : si ces ports ne repondent pas depuis le reseau,
  // aucune page de MediaMTX ne peut s'ouvrir, et une adresse inventee ne peut
  // pas obtenir de flux en contournant notre serveur.
  console.log('\n--- un seul point d entree ---');
  const lan = await cdp.evaluate('window.streamcontrol.getPreflight().then(p => p.network.primaryIPv4)');
  check('IPv4 locale connue', typeof lan === 'string' && lan.length > 0, lan);

  check('HLS de MediaMTX non joignable depuis le reseau', (await reachable(lan, HLS_PORT)) === false, `port ${HLS_PORT}`);
  check('WebRTC de MediaMTX non joignable depuis le reseau', (await reachable(lan, WEBRTC_PORT)) === false, `port ${WEBRTC_PORT}`);
  check('API de MediaMTX non joignable depuis le reseau', (await reachable(lan, API_PORT)) === false, `port ${API_PORT}`);
  check('RTMP joignable depuis le reseau (la camera en a besoin)', (await reachable(lan, RTMP_PORT)) === true, `port ${RTMP_PORT}`);
  check('pages web joignables depuis le reseau', (await reachable(lan, WEB_PAGES_PORT)) === true, `port ${WEB_PAGES_PORT}`);

  // --- 2. Aucune adresse inventee ne repond ------------------------------
  console.log('\n--- adresse inventee ---');
  for (const route of ['watch', 'hls', 'webrtc']) {
    const response = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/${route}/cam1zhdzdzdzd/index.m3u8`);
    check(`/${route} d une adresse inventee renvoie 404`, response.status === 404, `HTTP ${response.status}`);
  }

  const phantom = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/cam1zhdzdzdzd`);
  check('la page dit que l adresse n existe pas', /inconnue|existe pas/i.test(phantom.body));
  check('elle nomme l adresse demandee', phantom.body.includes('cam1zhdzdzdzd'));
  check('elle explique comment en creer une', phantom.body.includes('Nouvelle adresse'));
  check('elle liste les adresses existantes', phantom.body.includes('/cam1'));
  check('ce n est pas une reponse JSON', !phantom.body.trim().startsWith('{'), phantom.body.slice(0, 40));
  check('aucune demande d authentification', !phantom.headers['www-authenticate'], phantom.headers['www-authenticate'] ?? 'aucun');

  // --- 3. L'adresse reelle fonctionne ------------------------------------
  console.log('\n--- adresse reelle ---');
  const live = (await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'cam1');
  check(
    'l URL RTMP est bien formee',
    /^rtmp:\/\/[0-9.]+:\d+\/cam1$/.test(live.urls.rtmpIngest),
    live.urls.rtmpIngest,
  );
  check('la page web pointe sur notre serveur', live.urls.watch.includes(`:${WEB_PAGES_PORT}/watch/cam1`), live.urls.watch);
  check('le HLS passe par notre serveur', live.urls.hls.includes(`:${WEB_PAGES_PORT}/hls/cam1`), live.urls.hls);
  check('l API pointe sur notre serveur', live.urls.api.includes(`:${WEB_PAGES_PORT}/api/streams`), live.urls.api);
  // Les URL de lecture passent par la boucle locale : Windows bloque une
  // requete d'un poste vers sa propre adresse de reseau.
  check(
    'les URL de lecture passent par 127.0.0.1',
    [live.urls.hls, live.urls.watch, live.urls.mediamtxWatch, live.urls.api].every((u) =>
      u.includes('127.0.0.1'),
    ),
    live.urls.watch,
  );
  // L'adresse WebRTC finit par une barre oblique : la page de MediaMTX resout
  // « whep » relativement, sans quoi la lecture ne renvoie rien.
  check(
    'l URL WebRTC finit par une barre oblique',
    live.urls.mediamtxWatch.endsWith('/webrtc/cam1/'),
    live.urls.mediamtxWatch,
  );
  // La page WebRTC est la notre, jamais celle de MediaMTX : elle attend la
  // source et signale l'erreur exacte, au lieu de boucler sur « stream not
  // found ». Seul le point d'entree WHEP est relaie.
  const noSlash = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/webrtc/cam1`);
  check('la page WebRTC repond', noSlash.status === 200, `HTTP ${noSlash.status}`);
  check('c est notre page de lecture, pas celle de MediaMTX', noSlash.body.includes('StreamControl'), noSlash.body.slice(0, 60));
  check('elle ne depend pas de reader.js de MediaMTX', !noSlash.body.includes('reader.js'));
  // Sans la redirection, « whep » se resoudrait hors du chemin du flux.
  const whepBad = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/webrtc/whep`);
  check('un whep hors du chemin du flux est refuse', whepBad.status === 404, `HTTP ${whepBad.status}`);
  // La page avec barre oblique se comporte pareil.
  const withSlash = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/webrtc/cam1/`);
  check('la page WebRTC avec barre oblique repond aussi', withSlash.status === 200, `HTTP ${withSlash.status}`);

  ffmpeg = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '60',
    '-f', 'flv', live.urls.rtmpIngest], { stdio: ['ignore', 'ignore', 'ignore'] });

  const published = await waitFor('le flux passe en direct', async () => {
    const list = await cdp.evaluate('window.streamcontrol.streamsList()');
    return list.find((s) => s.path === 'cam1')?.status.publishing === true;
  }, 25000);
  check('la publication est acceptee', published);

  // Le HLS relaie par notre serveur doit renvoyer une vraie liste de lecture.
  const playlist = await waitFor('le HLS est servi par notre serveur', async () => {
    const response = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/hls/cam1/index.m3u8`);
    return response.status === 200 && response.body.includes('#EXTM3U');
  }, 25000);
  check('notre serveur sert le HLS', playlist);

  // --- 3b. La session WebRTC reste sous notre prefixe --------------------
  // MediaMTX renvoie son adresse de session relative a SA racine
  // (`/cam1/whep/<secret>`). Le lecteur la suit telle quelle : sans notre
  // prefixe, il sort de notre chemin et obtient un 404, ce qui interrompt une
  // session pourtant etablie (« stream not found »). On verifie que l'adresse
  // renvoyee reste sous `/webrtc`.
  console.log('\n--- session WebRTC ---');
  // La sonde tourne dans la fenetre de lecture : elle est servie par notre
  // serveur, donc une URL relative y vise bien notre relais (la page de
  // l'application, elle, est servie par le serveur de developpement).
  await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(live.id)})`);
  let whepViewer = null;
  for (let i = 0; i < 40 && !whepViewer; i += 1) {
    await sleep(400);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    whepViewer = targets.find((t) => t.type === 'page' && t.url.includes('/watch/cam1'));
  }
  const whepCdp = createCdp(WebSocket, whepViewer.webSocketDebuggerUrl);
  await whepCdp.ready;
  await whepCdp.send('Runtime.enable');
  const whep = await whepCdp.evaluate(`(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = pc.localDescription.sdp;
    const response = await fetch('/webrtc/cam1/whep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdp,
    });
    const location = response.headers.get('Location');
    const out = { status: response.status, location, patch: null };
    if (response.ok) {
      await response.text();
      // Fragment trickle-ICE construit sur les memes identifiants que l'offre,
      // comme le fait le lecteur : un fragment etranger declencherait une
      // renégociation cote MediaMTX, qui repondrait alors 200 et non 204.
      const ufrag = (sdp.match(/a=ice-ufrag:(\\S+)/) || [])[1] || 'x';
      const pwd = (sdp.match(/a=ice-pwd:(\\S+)/) || [])[1] || 'yyyyyyyyyyyyyyyyyyyyyyyy';
      const fragment =
        'a=ice-ufrag:' + ufrag + '\\r\\na=ice-pwd:' + pwd +
        '\\r\\nm=video 9 UDP/TLS/RTP/SAVPF 96\\r\\na=mid:0\\r\\n' +
        'a=candidate:1 1 UDP 2130706431 127.0.0.1 55555 typ host\\r\\n';
      const patch = await fetch(location, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' },
        body: fragment,
      });
      out.patch = patch.status;
      await patch.text();
    }
    pc.close();
    return JSON.stringify(out);
  })()`);
  const whepResult = JSON.parse(whep);
  check('la session WHEP est acceptee', whepResult.status === 201, `HTTP ${whepResult.status}`);
  check(
    'l adresse de session reste sous notre prefixe',
    typeof whepResult.location === 'string' && whepResult.location.startsWith('/webrtc/'),
    whepResult.location,
  );
  // Le PATCH (trickle ICE) doit aboutir. MediaMTX repond 204 sans rien a
  // envoyer, 200 quand il a un fragment a renvoyer ; 404 est l'echec, et c'est
  // exactement ce qui arrivait quand l'adresse sortait de notre prefixe.
  check(
    'un PATCH sur la session est accepte',
    whepResult.patch === 204 || whepResult.patch === 200,
    `HTTP ${whepResult.patch}`,
  );
  whepCdp.close();
  await cdp.evaluate(`window.streamcontrol.closeStreamWindow(${JSON.stringify(live.id)})`);
  await sleep(600);

  // --- 4. La camera publie, quelle que soit la forme de son URL ----------
  // Aucune authentification n'est active : une camera ne peut pas etre rejetee
  // avant meme la publication.
  console.log('\n--- publication de la camera ---');
  for (const suffix of ['cam1/cle', 'cam1?key=abc', 'cam1/macle/42']) {
    const probe = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-t', '4',
      '-f', 'flv', `rtmp://127.0.0.1:${RTMP_PORT}/${suffix}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    const code = await new Promise((resolve) => probe.on('exit', (value) => resolve(value)));
    check(`publication acceptee sur ${suffix}`, code === 0, `code ${code}`);
  }

  // --- 5. Une adresse creee apres le demarrage fonctionne ----------------
  console.log('\n--- ordre reel ---');
  await cdp.evaluate(`window.streamcontrol.streamCreate({ name: 'Tardif', path: 'tardif' })`);
  await sleep(1500);
  const tardif = (await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'tardif');
  const late = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-t', '4',
    '-f', 'flv', tardif.urls.rtmpIngest], { stdio: ['ignore', 'ignore', 'pipe'] });
  const lateCode = await new Promise((resolve) => late.on('exit', (code) => resolve(code)));
  check('adresse creee apres le demarrage : publication acceptee', lateCode === 0, `code ${lateCode}`);

  // --- 6. Une adresse supprimee n'est plus lisible -----------------------
  console.log('\n--- suppression ---');
  const tardifId = (await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path === 'tardif').id;
  await cdp.evaluate(`window.streamcontrol.streamDelete(${JSON.stringify(tardifId)})`);
  await sleep(1000);
  const afterDelete = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/hls/tardif/index.m3u8`);
  check('le HLS d une adresse supprimee renvoie 404', afterDelete.status === 404, `HTTP ${afterDelete.status}`);

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

summary();
