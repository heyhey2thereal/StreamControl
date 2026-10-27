/**
 * Verifie les pages web et la fenetre de lecture.
 *
 * Depuis que MediaMTX est le seul serveur de flux :
 * - les pages web ne repondent plus tant que MediaMTX est arrete ;
 * - la fenetre de lecture charge la page de MediaMTX, sur la boucle locale ;
 * - les Parametres ne proposent plus de telecharger MediaMTX, deja livre.
 */
import fs from 'node:fs';
import http from 'node:http';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
if (!fs.existsSync(MEDIAMTX)) {
  console.log('SKIP  test pages : definissez STREAMCONTROL_MEDIAMTX_BINARY.');
  process.exit(0);
}

const USER_DATA = '/tmp/sc-e2e-pages';
const DEBUG_PORT = 9346;
const RTMP_PORT = 41935;
const HLS_PORT = 48080;
const WEBRTC_PORT = 48081;
const RTSP_PORT = 48554;
const API_PORT = 49997;
const WEB_PAGES_PORT = 48082;

const { check, summary } = createChecker();

function get(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ mediamtx: { rtmpPort: ${RTMP_PORT}, hlsPort: ${HLS_PORT}, webrtcPort: ${WEBRTC_PORT}, rtspPort: ${RTSP_PORT}, apiPort: ${API_PORT}, webPagesPort: ${WEB_PAGES_PORT} } })`,
  );
  await sleep(1000);

  // --- 1. MediaMTX arrete : les pages refusent de servir ------------------
  console.log('\n--- MediaMTX arrete ---');
  const stopped = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('les pages repondent 503', stopped.status === 503, `HTTP ${stopped.status}`);
  check('la cause est expliquee', stopped.body.includes('MediaMTX'));

  const initialStreams = await cdp.evaluate('window.streamcontrol.streamsList()');
  check(
    'la fenetre de lecture est refusee',
    (await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(initialStreams[0].id)})`)) === false,
  );

  // --- 2. MediaMTX demarre : les pages reviennent -------------------------
  console.log('\n--- MediaMTX demarre ---');
  await cdp.evaluate(`window.streamcontrol.saveSettings({ mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)} } })`);
  await sleep(600);
  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? started.status?.state);

  const running = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('les pages repondent', running.status === 200, `HTTP ${running.status}`);
  check('elles listent les adresses', running.body.includes('/live'));

  const unknown = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/cam1282282`);
  check('une adresse inconnue repond 404', unknown.status === 404, `HTTP ${unknown.status}`);

  // --- 3. La fenetre de lecture passe par la boucle locale ----------------
  console.log('\n--- fenetre de lecture ---');
  const streams = await cdp.evaluate('window.streamcontrol.streamsList()');
  const target = streams[0];
  check('une adresse existe', Boolean(target), target?.path);

  const opened = await cdp.evaluate(`window.streamcontrol.openStreamWindow(${JSON.stringify(target.id)})`);
  check('fenetre ouverte sans erreur', opened === true);

  await sleep(4000);

  // La page ouverte doit venir de MediaMTX, via la boucle locale : c'est ce qui
  // evite le blocage par un pare-feu ou un antivirus.
  const windows = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const viewer = windows.find((w) => w.type === 'page' && w.url.includes(`:${WEB_PAGES_PORT}/watch/`));
  check('une fenetre de lecture est ouverte', Boolean(viewer), viewer?.url ?? 'introuvable');
  check(
    'elle passe par la boucle locale, pas par le reseau',
    Boolean(viewer) && !viewer.url.includes('192.168.') && !viewer.url.includes('10.'),
    viewer?.url ?? '',
  );
  check(
    'elle utilise 127.0.0.1',
    Boolean(viewer) && viewer.url.includes('127.0.0.1'),
    viewer?.url ?? '',
  );

  // --- 3. Plus de bouton de telechargement MediaMTX -----------------------
  console.log('\n--- parametres ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Parametres'));
    b.click();
  })()`);
  await sleep(900);

  const settingsText = await cdp.evaluate('document.body.textContent');
  check(
    'plus de bouton de telechargement MediaMTX',
    !settingsText.includes('Telecharger MediaMTX'),
  );
  check(
    'le texte explique que le binaire est fourni',
    settingsText.includes('fourni avec StreamControl'),
  );

  // --- 4. La vue URL se construit sur les adresses creees ----------------
  console.log('\n--- vue URL ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('URL de diffusion'));
    b.click();
  })()`);
  await sleep(900);

  const sections = await cdp.evaluate('document.querySelectorAll(".urls-section").length');
  check('une section par adresse', sections >= 1, `${sections} section(s)`);

  // Les sections sont repliees par defaut : on les ouvre pour lire les URL,
  // comme le ferait l'utilisateur.
  check('les sections sont repliees par defaut', !(await cdp.evaluate('Boolean(document.querySelector(".urls-body"))')));
  await cdp.evaluate(`(() => { document.querySelectorAll('.urls-toggle').forEach((b) => b.click()); })()`);
  await sleep(400);

  const urlsText = await cdp.evaluate('document.body.textContent');
  check('les URL viennent des adresses', urlsText.includes(`:${RTMP_PORT}/`), `port ${RTMP_PORT}`);
  check(
    'aucune mention DJI dans les libelles',
    !urlsText.includes('DJI Mimo / OBS'),
  );

  // --- 5. Les pages web suivent la langue de l'interface ----------------
  console.log('\n--- langue des pages web ---');
  await cdp.evaluate(`window.streamcontrol.saveSettings({ ui: { language: 'en' } })`);
  await sleep(900);

  const watchEn = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/live`);
  check('la page de lecture est traduite', watchEn.body.includes('Connecting to the stream'), watchEn.body.slice(0, 60));
  check('plus de texte francais', !watchEn.body.includes('Connexion au flux'));

  const indexEn = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('la liste est traduite', indexEn.body.includes('Available streams'), indexEn.body.slice(0, 60));

  const unknownEn = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/watch/nexistepas`);
  check('la page inconnue est traduite', unknownEn.body.includes('Unknown address'));

  // La page d'attente n'apparait que MediaMTX arrete : on l'arrete pour la voir.
  await cdp.evaluate('window.streamcontrol.stopMediamtx()');
  await sleep(1800);
  const stoppedEn = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('la page arretee est traduite', stoppedEn.body.includes('Stream server stopped'), stoppedEn.body.slice(0, 80));
  check(
    'elle se recharge toute seule',
    /setInterval/.test(stoppedEn.body) && /api\/streams/.test(stoppedEn.body),
    'boucle de rafraichissement presente',
  );

  // Retour au francais : les pages doivent suivre aussi.
  await cdp.evaluate(`window.streamcontrol.saveSettings({ ui: { language: 'fr' } })`);
  await sleep(900);
  const backFr = await get(`http://127.0.0.1:${WEB_PAGES_PORT}/`);
  check('le retour au francais est suivi', backFr.body.includes('Serveur de flux arrete'), backFr.body.slice(0, 80));

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[streams\]|\[mediamtx\]/.test(l)).slice(-10).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
