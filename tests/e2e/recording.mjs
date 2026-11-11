/**
 * Verifie l'enregistrement a la demande, avec le replay actif.
 *
 * C'est le cas reel de l'utilisateur : quand le replay est actif, c'est la
 * **capture** (voir capture.ts) qui ecrit l'enregistrement, en suivant le
 * tampon. Trois garanties sont verifiees ici :
 *
 * 1. l'enregistrement demarre tout de suite (pas plusieurs secondes plus tard) ;
 * 2. il s'arrete tout de suite, et **sans rien perdre** : la duree du fichier
 *    correspond au temps d'enregistrement ;
 * 3. le fichier est un MP4 lisible, duree annoncee correcte (les lecteurs de
 *    Windows affichaient « 00:00 »).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
const DEBUG_PORT = 9400;
const USER_DATA = '/tmp/sc-e2e-recbug';
const REC_DIR = '/tmp/sc-recbug-out';
const BUFFER_DIR = '/tmp/sc-recbug-buffer';

const { check, summary } = createChecker();

fs.rmSync(REC_DIR, { recursive: true, force: true });
fs.rmSync(BUFFER_DIR, { recursive: true, force: true });
fs.mkdirSync(REC_DIR, { recursive: true });
fs.mkdirSync(BUFFER_DIR, { recursive: true });

/** Duree d'un fichier MP4, via ffprobe. */
function probeDuration(file) {
  return new Promise((resolve) => {
    execFile(
      FFMPEG.replace(/ffmpeg$/, 'ffprobe'),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      (error, stdout) => resolve(error ? 0 : Number(String(stdout).trim()) || 0),
    );
  });
}

/** Fichiers .mp4 sous un dossier, recursivement. */
function mp4Files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { recursive: true })
    .filter((f) => String(f).endsWith('.mp4'))
    .map((f) => path.join(directory, f))
    .filter((f) => fs.statSync(f).isFile());
}

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

  // Le replay est actif : c'est la capture qui ecrit l'enregistrement.
  await cdp.evaluate(`window.streamcontrol.saveSettings({
    mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)} },
    recording: { path: ${JSON.stringify(REC_DIR)}, format: 'fmp4', segmentMinutes: 60, retainHours: 24 },
    replay: { enabled: true, bufferSeconds: 60, minimumSeconds: 5, path: ${JSON.stringify(BUFFER_DIR)} }
  })`);
  await sleep(500);

  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? '');

  const list = await cdp.evaluate('window.streamcontrol.streamsList()');
  const target = list[0];

  // --- Publication -------------------------------------------------------
  console.log('\n--- publication ---');
  ffmpeg = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-t', '40',
    '-f', 'flv', `rtmp://127.0.0.1:1935/${target.path}`], { stdio: ['ignore', 'ignore', 'ignore'] });

  const published = await waitFor('le flux passe en direct', async () => {
    const current = await cdp.evaluate('window.streamcontrol.streamsList()');
    return current[0]?.status.publishing === true;
  }, 25000);
  check('la publication est acceptee', published);

  // On laisse le tampon se remplir un peu.
  await sleep(4000);

  // --- Activation : l'enregistrement doit demarrer tout de suite ---------
  console.log('\n--- activation ---');
  const enabledAt = Date.now();
  const result = await cdp.evaluate(`window.streamcontrol.streamSetRecording(${JSON.stringify(target.id)}, true)`);
  check('activation acceptee', result.ok === true, result.message ?? '');

  // Un fichier doit apparaitre tres vite (moins de 3 s), pas apres l'attente
  // d'un segment complet.
  const appeared = await waitFor('le fichier apparait vite', async () => mp4Files(REC_DIR).length > 0, 4000);
  const delay = Date.now() - enabledAt;
  check('le fichier apparait en moins de 3 s', appeared && delay < 3000, `${delay} ms`);

  const recording = await waitFor('l etat passe en enregistrement', async () => {
    const current = await cdp.evaluate('window.streamcontrol.streamsList()');
    return current[0]?.status.recording === true;
  }, 8000);
  check('l interface indique l enregistrement', recording);

  // --- On enregistre ~8 s, puis on arrete --------------------------------
  const recordStart = Date.now();
  await sleep(8000);
  const stoppedAt = Date.now();
  await cdp.evaluate(`window.streamcontrol.streamSetRecording(${JSON.stringify(target.id)}, false)`);
  const elapsed = Math.round((stoppedAt - recordStart) / 1000);
  console.log('duree enregistree (mesuree) :', elapsed, 's');

  await sleep(1500);
  const files = mp4Files(REC_DIR);
  check('un fichier est ecrit dans le dossier', files.length > 0, files.join(', '));

  if (files.length > 0) {
    const file = files[0];
    const duration = await probeDuration(file);
    console.log('fichier :', path.basename(file), '| duree :', duration, 's');
    // Sans perte : la duree du fichier doit etre proche du temps d'enregistrement
    // (on tolere 1,5 s de marge, l'ecriture etant en temps reel).
    check(
      'la duree du fichier correspond au temps enregistre',
      duration >= elapsed - 1.5 && duration <= elapsed + 1.5,
      `${duration} s pour ${elapsed} s enregistrees`,
    );
    check('la duree annoncee n est pas zero', duration > 0, `${duration} s`);
  }

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[(recording|capture|streams|mediamtx)\]/i.test(l)).slice(-20).join('\n'));
} finally {
  if (ffmpeg) ffmpeg.kill('SIGKILL');
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
