/**
 * Verifie le replay instantane de bout en bout.
 *
 * L'enregistrement du tampon passe par MediaMTX : on publie, on attend que des
 * segments apparaissent, puis on sauvegarde et on verifie le fichier produit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
const DEBUG_PORT = 9410;
const USER_DATA = '/tmp/sc-e2e-replay';
const BUFFER_DIR = '/tmp/sc-replay-buffer';
const REC_DIR = '/tmp/sc-replay-rec';

const { check, summary } = createChecker();

fs.rmSync(BUFFER_DIR, { recursive: true, force: true });
fs.rmSync(REC_DIR, { recursive: true, force: true });
fs.mkdirSync(BUFFER_DIR, { recursive: true });
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

  // Le replay est active. La memoire et le minimum sont courts pour un test
  // rapide : 40 s de memoire, minimum 5 s.
  await cdp.evaluate(`window.streamcontrol.saveSettings({
    mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)} },
    recording: { path: ${JSON.stringify(REC_DIR)} },
    replay: { enabled: true, bufferSeconds: 40, minimumSeconds: 5, path: ${JSON.stringify(BUFFER_DIR)} }
  })`);
  await sleep(600);

  const started = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('MediaMTX demarre', started.ok === true, started.message ?? '');

  const list = await cdp.evaluate('window.streamcontrol.streamsList()');
  const target = list[0];

  // --- Publication -------------------------------------------------------
  ffmpeg = spawn(FFMPEG, ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-t', '25',
    '-f', 'flv', `rtmp://127.0.0.1:1935/${target.path}`], { stdio: ['ignore', 'ignore', 'ignore'] });

  const published = await waitFor('le flux passe en direct', async () => {
    const current = await cdp.evaluate('window.streamcontrol.streamsList()');
    return current[0]?.status.publishing === true;
  }, 25000);
  check('la publication est acceptee', published);

  // --- Le tampon se remplit ----------------------------------------------
  const bufferDir = path.join(BUFFER_DIR, target.path);
  const gotSegments = await waitFor('des segments apparaissent', async () => {
    try {
      // Le tampon est en fMP4 : les segments sont des .mp4, rassembles ensuite
      // en un MP4 unique par le concatenateur fMP4.
      return fs.readdirSync(bufferDir).some((f) => f.endsWith('.mp4'));
    } catch {
      return false;
    }
  }, 20000);
  check('le tampon se remplit', gotSegments);

  const available = await cdp.evaluate(`window.streamcontrol.replayAvailable(${JSON.stringify(target.id)})`);
  check('duree de replay annoncee', available.seconds > 0, `${available.seconds} s`);

  await sleep(6000);

  // --- Sauvegarde --------------------------------------------------------
  // On demande une plage precise : les 30 dernieres secondes.
  const state = await cdp.evaluate(`window.streamcontrol.replayState(${JSON.stringify(target.id)})`);
  check('l etat du replay est disponible', typeof state?.availableSeconds === 'number', JSON.stringify(state));

  const saved = await cdp.evaluate(
    `window.streamcontrol.replaySave(${JSON.stringify(target.id)}, { fromSeconds: 30, toSeconds: 0 })`,
  );
  check('la sauvegarde renvoie un fichier', saved?.ok === true && typeof saved.file === 'string', JSON.stringify(saved?.message));

  // Une plage trop courte doit etre refusee (minimum 5 s dans ce test).
  const tooShort = await cdp.evaluate(
    `window.streamcontrol.replaySave(${JSON.stringify(target.id)}, { fromSeconds: 2, toSeconds: 0 })`,
  );
  check('une plage trop courte est refusee', tooShort?.ok === false, String(tooShort?.message));

  // Les replays vont dans un sous-dossier « replays » du dossier des
  // enregistrements : c'est ce que renvoie la sauvegarde.
  const replayDir = path.dirname(saved.file);
  const files = fs.existsSync(replayDir) ? fs.readdirSync(replayDir) : [];
  check('un fichier de replay existe', files.length > 0, files.join(', '));
  check('le fichier de replay est un MP4', String(saved.file).endsWith('.mp4'), String(saved.file));

  // Le MP4 doit etre reellement lisible : c'est tout l'objet du concatenateur
  // fMP4, qui corrige les temps de decodage des segments.
  const probe = await new Promise((resolve) => {
    execFile(
      FFMPEG.replace(/ffmpeg$/, 'ffprobe'),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', saved.file],
      (error, stdout) => resolve(error ? '' : String(stdout)),
    );
  });
  check('le MP4 sauvegarde est lisible', /duration=\d/.test(probe), probe.trim());

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[(replay|streams)\]/i.test(l)).slice(-15).join('\n'));
} finally {
  if (ffmpeg) ffmpeg.kill('SIGKILL');
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
