/**
 * Reproduction du bug d'enregistrement.
 *
 * Scenario utilisateur : publier sur un flux pendant quelques secondes, puis
 * activer l'enregistrement, et regarder le dossier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
const DEBUG_PORT = 9400;
const USER_DATA = '/tmp/sc-e2e-recbug';
const REC_DIR = '/tmp/sc-recbug-out';

const { check, summary } = createChecker();

fs.rmSync(REC_DIR, { recursive: true, force: true });
fs.mkdirSync(REC_DIR, { recursive: true });

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });
let ffmpeg = null;

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  await waitFor('la visite apparait', async () =>
    await cdp.evaluate('Boolean(document.querySelector(".tour-root"))'), 6000);
  if (await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')) {
    await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Passer')); if (b) b.click(); })()`);
    await sleep(600);
  }

  // Configuration : MediaMTX embarque + dossier d'enregistrement connu.
  await cdp.evaluate(`window.streamcontrol.saveSettings({
    mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)} },
    recording: { path: ${JSON.stringify(REC_DIR)}, format: 'fmp4', segmentMinutes: 60, retainHours: 24 }
  })`);
  await sleep(500);

  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? '');

  // L'adresse par defaut est "live".
  const list = await cdp.evaluate('window.streamcontrol.streamsList()');
  const target = list[0];
  console.log('adresse cible :', target?.path, '| record =', target?.record);

  // --- 1. Publier 12 s ---------------------------------------------------
  console.log('\n--- publication ---');
  ffmpeg = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-t', '12',
    '-f', 'flv', `rtmp://127.0.0.1:1935/${target.path}`], { stdio: ['ignore', 'ignore', 'ignore'] });

  const published = await waitFor('le flux passe en direct', async () => {
    const current = await cdp.evaluate('window.streamcontrol.streamsList()');
    return current[0]?.status.publishing === true;
  }, 25000);
  check('la publication est acceptee', published);

  // --- 2. Activer l'enregistrement (comme le bouton) ---------------------
  console.log('\n--- activation ---');
  const result = await cdp.evaluate(`window.streamcontrol.streamSetRecording(${JSON.stringify(target.id)}, true)`);
  check('activation acceptee', result.ok === true, result.message ?? '');

  const recording = await waitFor('l etat passe en enregistrement', async () => {
    const current = await cdp.evaluate('window.streamcontrol.streamsList()');
    return current[0]?.status.recording === true;
  }, 8000);
  check('l interface indique l enregistrement', recording);

  // --- 3. Attendre, puis regarder le dossier -----------------------------
  await sleep(6000);
  const files = fs.existsSync(REC_DIR)
    ? fs.readdirSync(REC_DIR, { recursive: true }).filter((f) => fs.statSync(path.join(REC_DIR, f)).isFile())
    : [];
  console.log('dossier :', REC_DIR);
  console.log('contenu :', files.length ? files.join(', ') : '(vide)');
  check('un fichier est ecrit dans le dossier', files.length > 0, files.join(', '));

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[(recording|streams|mediamtx)\]/i.test(l)).slice(-20).join('\n'));
} finally {
  if (ffmpeg) ffmpeg.kill('SIGKILL');
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
