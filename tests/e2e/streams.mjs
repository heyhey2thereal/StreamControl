/**
 * Test de bout en bout de la gestion des flux dans l'application reelle :
 * creation d'adresses depuis l'interface, URL affichees, publication reelle
 * par ffmpeg vers MediaMTX, lecture HLS, fenetre de lecture, puis suppression.
 *
 * MediaMTX est indispensable : sans binaire, le test est ignore. C'est lui qui
 * recoit la publication et la redistribue.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
if (!fs.existsSync(FFMPEG) || !fs.existsSync(MEDIAMTX)) {
  console.log('SKIP  test flux : definissez STREAMCONTROL_FFMPEG et STREAMCONTROL_MEDIAMTX_BINARY.');
  process.exit(0);
}

const USER_DATA = '/tmp/sc-e2e-streams';
const DEBUG_PORT = 9343;
const RTMP_PORT = 21935;
const HLS_PORT = 28080;
const WEBRTC_PORT = 28081;
const RTSP_PORT = 28554;
const API_PORT = 29997;
const WEB_PAGES_PORT = 28082;

const { check, summary } = createChecker();

/**
 * Requete HTTP qui suit les redirections.
 *
 * MediaMTX repond un 302 vers `?cookieCheck=1` sur les URL HLS : un client qui
 * ne suit pas la redirection voit un 302 et conclut a tort que rien n'est
 * servi. C'est ce comportement qui trompait aussi les tests precedents.
 */
function get(url, depth = 0) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(get(next, depth + 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
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

  // --- 0. Ports de test, puis demarrage de MediaMTX ----------------------
  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ mediamtx: { rtmpPort: ${RTMP_PORT}, hlsPort: ${HLS_PORT}, webrtcPort: ${WEBRTC_PORT}, rtspPort: ${RTSP_PORT}, apiPort: ${API_PORT}, webPagesPort: ${WEB_PAGES_PORT} } })`,
  );
  await sleep(1000);
  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)} } })`,
  );
  await sleep(600);

  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? `etat=${started.status?.state}`);

  // --- 1. Etat du serveur et adresse par defaut --------------------------
  const service = await cdp.evaluate('window.streamcontrol.getMediamtxStatus()');
  check('MediaMTX actif', service.state === 'running', service.state);

  let streams = await cdp.evaluate('window.streamcontrol.streamsList()');
  check('adresse par defaut creee', streams.length >= 1, `${streams.length} adresse(s)`);
  check(
    'URL RTMP pointe sur MediaMTX',
    streams[0].urls.rtmpIngest === `rtmp://${streams[0].urls.rtmpIngest.split('//')[1].split(':')[0]}:${RTMP_PORT}/live`,
    streams[0].urls.rtmpIngest,
  );
  check('le HLS passe par notre serveur', streams[0].urls.hls.endsWith(`:${WEB_PAGES_PORT}/hls/live/index.m3u8`), streams[0].urls.hls);
  check(
    'la page de lecture pointe sur StreamControl',
    streams[0].urls.watch.endsWith(`:${WEB_PAGES_PORT}/watch/live`),
    streams[0].urls.watch,
  );
  check(
    'la lecture directe passe par notre serveur',
    streams[0].urls.mediamtxWatch.endsWith(`:${WEB_PAGES_PORT}/webrtc/live/`),
    streams[0].urls.mediamtxWatch,
  );
  // Les URL de lecture sont servies par StreamControl sur ce poste : elles
  // passent par la boucle locale, pas par l'adresse du reseau.
  check(
    'les URL de lecture passent par 127.0.0.1',
    streams[0].urls.hls.includes('127.0.0.1') &&
      streams[0].urls.watch.includes('127.0.0.1') &&
      streams[0].urls.mediamtxWatch.includes('127.0.0.1') &&
      streams[0].urls.api.includes('127.0.0.1'),
    `${streams[0].urls.watch}`,
  );
  // L'ingestion reste sur l'IPv4 du LAN : c'est la camera qui publie.
  const lan = await cdp.evaluate('window.streamcontrol.getPreflight().then(p => p.network.primaryIPv4)');
  check(
    'l ingestion utilise l adresse du reseau',
    streams[0].urls.rtmpIngest.includes(`//${lan}:`),
    `${streams[0].urls.rtmpIngest} (LAN ${lan})`,
  );

  // --- 2. Navigation vers la vue Flux -----------------------------------
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Flux'));
    if (b) b.click();
    return Boolean(b);
  })()`);
  await sleep(700);

  const heading = await cdp.evaluate('document.querySelector("h1")?.textContent');
  check('vue Flux accessible', heading === 'Flux', heading);

  const cardCount = await cdp.evaluate('document.querySelectorAll(".endpoint").length');
  check('cartes affichees', cardCount >= 1, `${cardCount} carte(s)`);

  // --- 3. Creation depuis l'interface -----------------------------------
  console.log('\n--- creation depuis l interface ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Nouvelle adresse'));
    if (b) b.click();
    return Boolean(b);
  })()`);
  await sleep(600);

  check('formulaire ouvert', await cdp.evaluate('Boolean(document.querySelector(".endpoint-form"))'));
  check(
    'trois protocoles proposes',
    (await cdp.evaluate('document.querySelectorAll(".protocol-option").length')) === 3,
  );

  // Saisit un nom : le chemin doit se deduire tout seul.
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.endpoint-form .input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Camera Studio');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);

  const derivedPath = await cdp.evaluate('document.querySelectorAll(".endpoint-form .input")[1].value');
  check('chemin deduit du nom', derivedPath === 'camera-studio', derivedPath);

  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.endpoint-form button')].find(x => x.textContent.includes('Creer'));
    if (b) b.click();
    return Boolean(b);
  })()`);
  await sleep(1500);

  streams = await cdp.evaluate('window.streamcontrol.streamsList()');
  const created = streams.find((s) => s.path === 'camera-studio');
  check('adresse creee', Boolean(created), `${streams.length} adresses`);
  check('URL propre a la nouvelle adresse', created?.urls.rtmpIngest.endsWith('/camera-studio'), created?.urls.rtmpIngest);
  check('formulaire referme', await cdp.evaluate('!document.querySelector(".endpoint-form")'));

  // --- 4. Regles de gestion ---------------------------------------------
  console.log('\n--- regles de gestion ---');
  const duplicate = await cdp.evaluate(`window.streamcontrol.streamCreate({ name: 'Doublon', path: 'camera-studio' })`);
  check('chemin en double refuse', duplicate.ok === false, duplicate.message);

  const secured = await cdp.evaluate(
    `window.streamcontrol.streamCreate({ name: 'Protege', path: 'prive', streamKey: 'secret42' })`,
  );
  check('adresse avec cle creee', secured.ok === true);
  const withKey = await cdp.evaluate('window.streamcontrol.streamsList()');
  check('cle conservee', withKey.some((s) => s.streamKey === 'secret42'));

  // --- 5. Publication reelle --------------------------------------------
  console.log('\n--- publication reelle par ffmpeg ---');
  ffmpeg = spawn(FFMPEG, [
    '-re',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-t', '40',
    '-f', 'flv', created.urls.rtmpIngest,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // On attend des etats reels plutot qu'un delai fixe : ffmpeg met un temps
  // variable a s'initialiser, ce qui rendait le test instable.
  const readStream = async () => {
    const list = await cdp.evaluate('window.streamcontrol.streamsList()');
    return list.find((s) => s.path === 'camera-studio');
  };

  const published = await waitFor('la publication demarre', async () => (await readStream())?.status.publishing === true);
  check('publication detectee', published);

  // L'etat vient de l'API MediaMTX : on attend qu'elle rapporte les dimensions
  // reelles, preuve que le flux est bien en ligne et decode.
  const hasVideo = await waitFor(
    'les dimensions et le debit soient mesures',
    async () => {
      const stream = await readStream();
      return stream?.status.videoWidth === 640 && stream.status.bitrateKbps > 0;
    },
    30_000,
  );
  void hasVideo;

  const liveStream = await readStream();
  check(
    'dimensions remontees',
    liveStream?.status.videoWidth === 640,
    `${liveStream?.status.videoWidth}x${liveStream?.status.videoHeight}`,
  );
  check('audio detecte', liveStream?.status.hasAudio === true);
  check('debit mesure', (liveStream?.status.bitrateKbps ?? 0) > 0, `${liveStream?.status.bitrateKbps} kbit/s`);

  // --- 6. Lecture ---------------------------------------------------------
  console.log('\n--- lecture ---');
  const playlistReady = await waitFor('un segment HLS soit disponible', async () => {
    const response = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/hls/camera-studio/index.m3u8`);
    return response.status === 200 && response.body.toString().includes('#EXTM3U');
  }, 25_000);

  const playlist = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/hls/camera-studio/index.m3u8`);
  check('liste de lecture servie par notre serveur', playlist.status === 200, `HTTP ${playlist.status}`);
  check('liste de lecture exploitable', playlistReady);

  // --- 7. Pages web de StreamControl -------------------------------------
  console.log('\n--- pages web ---');
  const pagesIndex = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('page d accueil servie', pagesIndex.status === 200, `HTTP ${pagesIndex.status}`);
  check('elle liste les adresses', pagesIndex.body.toString().includes('camera-studio'));

  const pagesApi = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/api/streams`);
  check('API JSON repond', pagesApi.status === 200 && JSON.parse(pagesApi.body.toString()).streams.length >= 3);

  // La page de lecture est servie par StreamControl : elle affiche un
  // indicateur de chargement et interroge notre API, jamais MediaMTX.
  const watchPage = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/camera-studio`);
  check('la page de lecture est servie', watchPage.status === 200, `HTTP ${watchPage.status}`);
  check('elle contient une video', watchPage.body.toString().includes('<video'));
  check('elle affiche un indicateur de chargement', watchPage.body.toString().includes('class="spinner"'));

  // --- 8. Fenetre de lecture integree ------------------------------------
  console.log('\n--- fenetre de lecture ---');
  check(
    'fenetre ouverte',
    (await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(liveStream.id)})`)) === true,
  );
  await sleep(4000);

  const windows = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const viewer = windows.find((w) => w.type === 'page' && w.url.includes(`:${WEB_PAGES_PORT}/watch/camera-studio`));
  check('la fenetre charge la page de MediaMTX', Boolean(viewer), viewer?.url ?? 'introuvable');

  check('fenetre fermee', (await cdp.evaluate(`window.streamcontrol.closeStreamWindow(${JSON.stringify(liveStream.id)})`)) === true);

  // --- 9. MediaMTX arrete : plus rien ne repond --------------------------
  console.log('\n--- MediaMTX arrete ---');
  await cdp.evaluate('window.streamcontrol.stopMediamtx()');
  await sleep(2500);

  const stoppedService = await cdp.evaluate('window.streamcontrol.getMediamtxStatus()');
  check('MediaMTX arrete', stoppedService.state === 'stopped', stoppedService.state);

  const stoppedPage = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('les pages web refusent de servir', stoppedPage.status === 503, `HTTP ${stoppedPage.status}`);
  check('elles expliquent la cause', stoppedPage.body.toString().includes('MediaMTX'));

  check(
    'la fenetre de lecture est refusee',
    (await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(liveStream.id)})`)) === false,
  );

  // MediaMTX relance : les pages reviennent.
  await cdp.evaluate('window.streamcontrol.startMediamtx()');
  await sleep(3000);
  const backPage = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('les pages reviennent apres redemarrage', backPage.status === 200, `HTTP ${backPage.status}`);

  // --- 10. Desactivation et suppression ----------------------------------
  console.log('\n--- desactivation et suppression ---');
  const disabled = await cdp.evaluate(
    `window.streamcontrol.streamUpdate(${JSON.stringify(liveStream.id)}, { enabled: false })`,
  );
  check('adresse desactivable', disabled.ok === true && disabled.endpoint.enabled === false);
  await cdp.evaluate(`window.streamcontrol.streamUpdate(${JSON.stringify(liveStream.id)}, { enabled: true })`);

  check('adresse supprimee', (await cdp.evaluate(`window.streamcontrol.streamDelete(${JSON.stringify(liveStream.id)})`)).ok === true);
  const afterDelete = await cdp.evaluate('window.streamcontrol.streamsList()');
  check('absente de la liste', !afterDelete.some((s) => s.path === 'camera-studio'), `${afterDelete.length} restantes`);

  // --- 11. Persistance ---------------------------------------------------
  await sleep(800);
  const onDisk = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8'));
  check('adresses persistees', Array.isArray(onDisk.streams) && onDisk.streams.length >= 2, `${onDisk.streams?.length} adresses`);
  check('suppression persistee', !onDisk.streams.some((s) => s.path === 'camera-studio'));
  check('ports persistes', onDisk.mediamtx?.rtmpPort === RTMP_PORT, `RTMP ${onDisk.mediamtx?.rtmpPort}`);

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log('--- journal de l application ---');
  console.log(app.getLog().split('\n').filter((l) => /\[streams\]|\[engine\]|\[rtmp\]/.test(l)).slice(-12).join('\n'));
} finally {
  if (ffmpeg) ffmpeg.kill('SIGKILL');
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
