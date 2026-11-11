/**
 * Verifie le replay instantane de bout en bout.
 *
 * L'enregistrement du tampon passe par MediaMTX : on publie, on attend que des
 * segments apparaissent, puis on sauvegarde et on verifie le fichier produit.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const MEDIAMTX = process.env.STREAMCONTROL_MEDIAMTX_BINARY ?? '/tmp/mediamtx/mediamtx';
const FFMPEG = process.env.STREAMCONTROL_FFMPEG ?? '/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg';
const DEBUG_PORT = 9410;
const USER_DATA = '/tmp/sc-e2e-replay';
const BUFFER_DIR = '/tmp/sc-replay-buffer';
const REC_DIR = '/tmp/sc-replay-rec';
const WEB_PAGES_PORT = 48096;
const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

const { check, summary } = createChecker();

/** Requete HTTP avec en-tetes et corps optionnel. */
function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const payload = body ? Buffer.from(body) : null;
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    if (payload) req.write(payload);
    req.end();
  });
}

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
    mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX)}, webPagesPort: ${WEB_PAGES_PORT} },
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
  // On demande une plage sure : la duree disponible, bornee. Demander plus que
  // ce qui est memorise est refuse (voir plus bas), donc on lit d'abord l'etat.
  const state = await cdp.evaluate(`window.streamcontrol.replayState(${JSON.stringify(target.id)})`);
  check('l etat du replay est disponible', typeof state?.availableSeconds === 'number', JSON.stringify(state));

  const wanted = Math.max(5, Math.min(30, Math.floor(state.availableSeconds || 0)));
  const saved = await cdp.evaluate(
    `window.streamcontrol.replaySave(${JSON.stringify(target.id)}, { fromSeconds: ${wanted}, toSeconds: 0 })`,
  );
  check('la sauvegarde renvoie un fichier', saved?.ok === true && typeof saved.file === 'string', JSON.stringify(saved?.message));

  // Une plage trop courte doit etre refusee (minimum 5 s dans ce test).
  const tooShort = await cdp.evaluate(
    `window.streamcontrol.replaySave(${JSON.stringify(target.id)}, { fromSeconds: 2, toSeconds: 0 })`,
  );
  check('une plage trop courte est refusee', tooShort?.ok === false, String(tooShort?.message));

  // Une plage plus longue que ce qui est memorise doit etre refusee : c'est le
  // defaut corrige (« un replay de 300 s alors que le flux n'a que 32 s »).
  const tooLong = await cdp.evaluate(
    `window.streamcontrol.replaySave(${JSON.stringify(target.id)}, { fromSeconds: ${Math.ceil((state.availableSeconds || 0) + 5)}, toSeconds: 0 })`,
  );
  check('une plage plus longue que la memoire est refusee', tooLong?.ok === false, String(tooLong?.message));

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
  // La duree annoncee doit correspondre a la plage demandee (30 s demandees,
  // mais bornee par la memoire de 40 s et la disponibilite reelle). Le defaut
  // corrige : l'en-tete gardait la duree d'un seul segment, et le lecteur
  // affichait « 0:00 » alors que la lecture continuait.
  const announced = Number((probe.match(/duration=([\d.]+)/) || [])[1] || 0);
  check('la duree annoncee correspond au fichier', announced >= 5, `${announced} s annoncees`);

  // --- Onglet Replay : barre de lecture a deux poignees ------------------
  console.log('\n--- onglet Replay ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('Replay'));
    if (b) b.click();
  })()`);
  await sleep(900);
  check('l onglet Replay existe', await cdp.evaluate('Boolean(document.querySelector(".replay-timeline"))'));
  const handles = await cdp.evaluate('document.querySelectorAll(".replay-handle").length');
  check('deux poignees sont presentes', handles === 2, `${handles} poignee(s)`);

  // Deplacer la poignee de gauche change la duree demandee.
  const before = await cdp.evaluate('document.querySelector(".replay-summary")?.textContent ?? ""');
  await cdp.evaluate(`(() => {
    const bar = document.querySelector('.replay-bar');
    const handle = document.querySelectorAll('.replay-handle')[0];
    const rect = bar.getBoundingClientRect();
    const down = new PointerEvent('pointerdown', { clientX: rect.left + rect.width * 0.5, bubbles: true });
    handle.dispatchEvent(down);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.5, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  })()`);
  await sleep(400);
  const after = await cdp.evaluate('document.querySelector(".replay-summary")?.textContent ?? ""');
  check('deplacer une poignee change la duree', before !== after, `${before} -> ${after}`);

  // Pellicule : une vignette par seconde, et un apercu du clip du tampon.
  check('la pellicule est presente', await cdp.evaluate('Boolean(document.querySelector(".replay-filmstrip-canvas"))'));
  check('l apercu de la selection est present', await cdp.evaluate('Boolean(document.querySelector(".replay-preview video"))'));
  // Le clip du tampon est servi avec support des requetes partielles : sans
  // cela, la video ne peut pas se deplacer dans le temps.
  const clipUrl = await cdp.evaluate(
    `window.streamcontrol.streamsList().then((list) => (list || []).find((s) => s.id === ${JSON.stringify(target.id)})?.urls?.replayClip ?? '')`,
  );
  const clip = await request(clipUrl, { headers: { Range: 'bytes=0-1023' } });
  check('le clip du tampon repond en 206', clip.status === 206, `HTTP ${clip.status}`);
  check('le clip annonce les plages', clip.headers['accept-ranges'] === 'bytes', String(clip.headers['accept-ranges']));
  check('le clip est un MP4', String(clip.headers['content-type']).includes('video/mp4'), String(clip.headers['content-type']));

  // --- Replay demande depuis un appareil du reseau -----------------------
  //
  // Le panneau distant prepare l'extrait sur le poste, l'appareil le
  // telecharge, puis le fichier temporaire est supprime : rien ne doit rester
  // dans le dossier des replays du poste.
  console.log('\n--- replay depuis un appareil ---');
  await cdp.evaluate(`window.streamcontrol.saveSettings({ remote: { enabled: true, desktop: { download: true } } })`);
  await sleep(900);

  const base = `http://127.0.0.1:${WEB_PAGES_PORT}`;
  const pair = await request(`${base}/remote/pair`, {
    method: 'POST',
    headers: { 'User-Agent': PC_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '' }),
  });
  const pairId = JSON.parse(pair.body).id;
  await cdp.evaluate(`window.streamcontrol.remoteApprove(${JSON.stringify(pairId)}, true)`);
  await sleep(400);
  const token = JSON.parse((await request(`${base}/remote/pair/${pairId}`)).body).token;
  check('un appareil obtient un jeton', Boolean(token));

  const authHeaders = { 'User-Agent': PC_UA, 'X-Remote-Token': token };

  // L'etat annonce les reglages du replay : l'appareil sait quoi demander.
  const remoteState = JSON.parse((await request(`${base}/remote/state`, { headers: authHeaders })).body);
  check('l etat porte les reglages du replay', remoteState.replay && remoteState.replay.enabled === true, JSON.stringify(remoteState.replay));

  // Preparation de l'extrait. Le nom du flux est transmis : il sert de nom de
  // fichier au telechargement. On demande une plage sure : la duree reellement
  // disponible, publiee dans l'etat (`replaySeconds`).
  const remoteStream = (remoteState.streams || []).find((s) => s.id === target.id) || {};
  const remoteWanted = Math.max(5, Math.min(10, Math.floor(remoteStream.replaySeconds || 0)));
  check('l etat publie la duree de replay disponible', typeof remoteStream.replaySeconds === 'number', JSON.stringify(remoteStream.replaySeconds));
  const prepared = await request(`${base}/remote/replay`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: target.id, name: target.name, fromSeconds: remoteWanted, toSeconds: 0 }),
  });
  const preparedBody = JSON.parse(prepared.body);
  check('l appareil prepare un replay', preparedBody.ok === true && typeof preparedBody.url === 'string', prepared.body.slice(0, 120));

  // Telechargement : le corps est un MP4, et le fichier temporaire disparait.
  // On telecharge SANS en-tete d'autorisation : c'est ce que fait la balise
  // `download` d'un navigateur, et c'etait la cause du « fichier non
  // disponible ». Le jeton d'URL, a usage unique, suffit.
  const download = await request(`${base}${preparedBody.url}`);
  check('le telechargement renvoie un MP4', download.headers['content-type'] === 'video/mp4', String(download.headers['content-type']));
  check('le MP4 telecharge n est pas vide', download.body.length > 1000, `${download.body.length} octets`);
  check(
    'le telechargement porte le nom du flux',
    /filename="Flux-principal_/.test(String(download.headers['content-disposition'])),
    String(download.headers['content-disposition']),
  );

  // Une seconde tentative sur le meme jeton echoue : le fichier a ete supprime.
  const again = await request(`${base}${preparedBody.url}`);
  check('le replay est supprime apres telechargement', again.status === 404, `HTTP ${again.status}`);

  // Sans l'autorisation « download », le serveur refuse (403).
  await cdp.evaluate(`window.streamcontrol.saveSettings({ remote: { desktop: { download: false } } })`);
  await sleep(900);
  const denied = await request(`${base}/remote/replay`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: target.id, fromSeconds: 10, toSeconds: 0 }),
  });
  check('le replay est refuse sans autorisation', denied.status === 403, `HTTP ${denied.status}`);

  // --- Vider la memoire du replay (en dernier : elle vide le tampon) ------
  // Le bouton repart de zero : apres effacement, la duree disponible tombe.
  console.log('\n--- vider la memoire ---');
  check(
    'le bouton vider la memoire est present',
    await cdp.evaluate(`Boolean([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Vider la memoire')))`),
  );
  const beforeClear = await cdp.evaluate(`window.streamcontrol.replayAvailable(${JSON.stringify(target.id)}).then((r) => r.seconds)`);
  await cdp.evaluate(`window.confirm = () => true`);
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Vider la memoire'));
    if (b) b.click();
  })()`);
  await sleep(1500);
  const afterClear = await cdp.evaluate(`window.streamcontrol.replayAvailable(${JSON.stringify(target.id)}).then((r) => r.seconds)`);
  check('la memoire repart de zero', afterClear < beforeClear, `${beforeClear} s -> ${afterClear} s`);

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
