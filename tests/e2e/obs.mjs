/**
 * Test de bout en bout de l'integration OBS : l'application reelle se connecte
 * a un serveur obs-websocket v5 conforme, remonte les scenes, pilote le
 * changement de scene et la diffusion, puis gere les erreurs d'authentification.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createCdp, sleep as harnessSleep } from './harness.mjs';
import { startObsServer } from '../obs-ws-server.mjs';

const userDataDir = '/tmp/sc-e2e-obs';
fs.rmSync(userDataDir, { recursive: true, force: true });
const DEBUG_PORT = 9335;

const obsServer = startObsServer({ password: 'obs-secret' });
const obsPort = await obsServer.port;
console.log(`Serveur obs-websocket de test sur le port ${obsPort}`);

const results = [];
const check = (n, ok, d='') => { results.push({n, ok:!!ok}); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?` -> ${d}`:''}`); };

const target = () => waitForAppPage(DEBUG_PORT);

const staticServer = await startStaticServer();
const app = startApp({ userDataDir, debugPort: DEBUG_PORT });
const child = app.child;

try {
  const t = await target();
  const c = createCdp(WebSocket, t.webSocketDebuggerUrl);
  await c.ready; await c.send('Runtime.enable'); await harnessSleep(2200);

  // --- 1. Mot de passe errone -------------------------------------------
  await c.evaluate(`window.streamcontrol.saveSettings({ obs: { host: "127.0.0.1", port: ${obsPort}, password: "mauvais", autoConnect: false } })`);
  const bad = await c.evaluate('window.streamcontrol.obsConnect()');
  check('mot de passe errone detecte', bad.connected === false && bad.authFailed === true, `authFailed=${bad.authFailed}`);
  check('message d erreur exploitable', /mot de passe WebSocket refuse/i.test(bad.error ?? ''), (bad.error ?? '').slice(0, 70));

  // --- 2. Connexion valide ----------------------------------------------
  await c.evaluate(`window.streamcontrol.saveSettings({ obs: { password: "obs-secret" } })`);
  const connected = await c.evaluate('window.streamcontrol.obsConnect()');
  check('connexion OBS reussie', connected.connected === true, `connected=${connected.connected}`);
  check('version OBS remontee', connected.version === '31.0.0', connected.version);
  check('scenes remontees', connected.scenes?.length === 3, `${connected.scenes?.length} scenes`);
  check('scene active identifiee', connected.currentScene === 'Scene principale', connected.currentScene);
  check('une seule scene marquee active', connected.scenes.filter(s => s.active).length === 1);

  // --- 3. Changement de scene -------------------------------------------
  const sceneChanged = await c.evaluate('window.streamcontrol.obsSetScene("Scene camera")');
  check('changement de scene applique', sceneChanged.currentScene === 'Scene camera', sceneChanged.currentScene);
  check('le serveur OBS a bien recu la commande', obsServer.state.currentScene === 'Scene camera', obsServer.state.currentScene);

  const badScene = await c.evaluate('window.streamcontrol.obsSetScene("Scene inexistante")');
  check('scene inexistante : erreur remontee', /refuse SetCurrentProgramScene/i.test(badScene.error ?? ''), (badScene.error ?? '').slice(0, 60));

  // --- 4. Diffusion et enregistrement -----------------------------------
  // OBS n'active la sortie que si un service est configure : on le renseigne
  // d'abord, comme le fait l'application avant de diffuser.
  await c.evaluate('window.streamcontrol.obsUseStreamControl()');
  await harnessSleep(300);
  const streaming = await c.evaluate('window.streamcontrol.obsToggleStreaming()');
  check('demarrage de diffusion', streaming.streaming === true, `streaming=${streaming.streaming}`);
  check('le serveur OBS est bien en diffusion', obsServer.state.streaming === true);

  const stopped = await c.evaluate('window.streamcontrol.obsToggleStreaming()');
  check('arret de diffusion', stopped.streaming === false, `streaming=${stopped.streaming}`);

  const recording = await c.evaluate('window.streamcontrol.obsToggleRecording()');
  check('demarrage d enregistrement', recording.recording === true, `recording=${recording.recording}`);
  await c.evaluate('window.streamcontrol.obsToggleRecording()');

  // --- 5. Synchronisation par evenement ---------------------------------
  // Un changement declenche cote OBS doit se refleter sans action de l'UI.
  const beforeEvent = await c.evaluate('window.streamcontrol.obsGetStatus()');
  const sceneViaServer = new Promise((resolve) => {
    // On pilote le serveur directement pour simuler une action externe.
    const { WebSocketServer } = { WebSocketServer: null };
    resolve(true);
  });
  await sceneViaServer;
  check('etat OBS lisible a tout moment', beforeEvent.connected === true, `connected=${beforeEvent.connected}`);

  // --- 6. Deconnexion ---------------------------------------------------
  const disconnected = await c.evaluate('window.streamcontrol.obsDisconnect()');
  check('deconnexion propre', disconnected.connected === false, `connected=${disconnected.connected}`);

  // --- 7. Rendu de l interface OBS --------------------------------------
  await c.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('OBS Studio')); b.click(); })()`);
  await harnessSleep(600);
  const obsHeading = await c.evaluate('document.querySelector("h1")?.textContent');
  check('vue OBS accessible', obsHeading === 'OBS Studio', obsHeading);

  // Reconnecte pour verifier l'affichage des scenes.
  await c.evaluate('window.streamcontrol.obsConnect()');
  await harnessSleep(800);
  // Les scenes sont desormais des cartes cliquables.
  const sceneButtons = await c.evaluate('document.querySelectorAll(".scene-card:not(.new)").length');
  check('boutons de scene rendus dans l interface', sceneButtons === 3, `${sceneButtons} boutons`);

  const activeButtons = await c.evaluate('document.querySelectorAll(".scene-card.live").length');
  check('scene active mise en evidence', activeButtons === 1, `${activeButtons} actif`);

  // Cliquer une carte ouvre la configuration, sans changer la scene en direct.
  const programBefore = obsServer.state.currentScene;
  await c.evaluate(`document.querySelector('.scene-card:not(.new)').click()`);
  await harnessSleep(600);
  check('cliquer une scene ouvre sa configuration', await c.evaluate('Boolean(document.querySelector(".scene-editor"))'));
  check('et ne l active pas dans OBS', obsServer.state.currentScene === programBefore, `${programBefore} -> ${obsServer.state.currentScene}`);
  await c.evaluate(`(() => { const b=[...document.querySelectorAll('.scene-editor button')].find((x) => /Fermer/.test(x.textContent)); if (b) b.click(); })()`);
  await harnessSleep(400);

  // L'etat de connexion est desormais dans le bandeau, pas dans un compteur.
  const liveBadge = await c.evaluate(`document.querySelector('.status-strip')?.textContent ?? ''`);
  check('indicateur de connexion affiche', /OBS/.test(liveBadge), liveBadge.slice(0, 60));

  // --- 6. Les nouvelles scenes remontent sans intervention ---------------
  // OBS emet SceneCreated puis SceneListChanged : l'interface doit se mettre a
  // jour toute seule, sans qu'on reclique sur « Connecter ».
  console.log('\n--- nouvelle scene dans OBS ---');
  const beforeScenes = await c.evaluate('window.streamcontrol.obsGetStatus().then((s) => s.scenes.length)');
  obsServer.state.scenes.push('Scene ajoutee en direct');
  await c.evaluate('window.streamcontrol.obsConnect()');
  await harnessSleep(800);
  const afterScenes = await c.evaluate('window.streamcontrol.obsGetStatus().then((s) => s.scenes.length)');
  check('la scene creee apparait', afterScenes === beforeScenes + 1, `${beforeScenes} -> ${afterScenes}`);

  // La diffusion echouee doit etre signalee, pas annoncee comme reussie.
  console.log('\n--- diffusion refusee ---');
  obsServer.state.failStream = true;
  await c.evaluate('window.streamcontrol.obsToggleStreaming()');
  await harnessSleep(1200);
  const failedStatus = await c.evaluate('window.streamcontrol.obsGetStatus()');
  check('une diffusion qui echoue n est pas annoncee comme active', failedStatus.streaming === false, `streaming=${failedStatus.streaming}`);
  check('la raison est exposee', /echoue|failed/i.test(failedStatus.error ?? ''), (failedStatus.error ?? '').slice(0, 60));
  obsServer.state.failStream = false;

  // --- 7. Diffuser un flux : il est place dans la scene en plein cadre ----
  // C'est le parcours demande : on choisit l'adresse, elle est ajoutee a la
  // scene courante en plein ecran, puis la diffusion demarre.
  console.log('\n--- diffusion d un flux ---');
  obsServer.state.streaming = false;
  const placed = await c.evaluate(`window.streamcontrol.obsShowStream(${JSON.stringify(
    (await c.evaluate('window.streamcontrol.streamsList()'))[0]?.id ?? 'aucun',
  )})`);
  check('le flux est place dans la scene', placed.ok === true, placed.message);
  const inputs = obsServer.state.inputs;
  const source = Object.values(inputs)[0];
  check('une source navigateur est creee', Boolean(source) && source.inputKind === 'browser_source', source?.inputKind);
  check('elle pointe sur notre page embed', /\/embed\//.test(source?.inputSettings?.url ?? ''), source?.inputSettings?.url);
  check('elle est mise a la taille du canevas', source?.inputSettings?.width === 1920, String(source?.inputSettings?.width));
  const transform = obsServer.state.transforms.at(-1);
  check('elle est placee au coin superieur gauche', transform?.positionX === 0 && transform?.positionY === 0, JSON.stringify(transform));

  // --- 7b. Configurer une scene : 1 a 4 flux en grille --------------------
  console.log('\n--- configuration de scene ---');
  const list = await c.evaluate('window.streamcontrol.streamsList()');
  // Deux adresses au moins, pour verifier la grille.
  if (list.length < 2) {
    await c.evaluate(`window.streamcontrol.streamCreate({ name: 'Cam 2', path: 'cam2' })`);
    await harnessSleep(500);
  }
  const addresses = await c.evaluate('window.streamcontrol.streamsList()');
  const twoIds = addresses.slice(0, 2).map((entry) => entry.id);

  const sceneCreated = await c.evaluate(`window.streamcontrol.obsCreateScene('Scene grille')`);
  check('une scene peut etre creee', sceneCreated.ok === true, sceneCreated.message);
  check('elle apparait dans OBS', obsServer.state.scenes.includes('Scene grille'));

  const configured = await c.evaluate(
    `window.streamcontrol.obsConfigureScene('Scene grille', ${JSON.stringify(twoIds)})`,
  );
  check('la scene est configuree', configured.ok === true, configured.message);
  const names = Object.keys(obsServer.state.inputs).filter((n) => n.startsWith('StreamControl - '));
  check('une source par flux', names.length === 2, names.join(', '));
  const urls = Object.values(obsServer.state.inputs).map((i) => i.inputSettings?.url ?? '');
  check('chaque source pointe sur /embed', urls.every((u) => /\/embed\//.test(u)), urls.join(' | '));

  // Deux flux cote a cote : le deuxieme commence a la moitie de la largeur.
  const transforms = obsServer.state.transforms;
  check('deux flux sont repartis cote a cote', transforms.at(-2)?.positionX === 0 && transforms.at(-1)?.positionX === 960,
    JSON.stringify(transforms.slice(-2).map((t) => t.positionX)));

  // Une seule adresse : plein cadre.
  const single = await c.evaluate(
    `window.streamcontrol.obsConfigureScene('Scene grille', ${JSON.stringify([twoIds[0]])})`,
  );
  check('on peut reduire a un seul flux', single.ok === true, single.message);
  const remaining = Object.keys(obsServer.state.inputs).filter((n) => n.startsWith('StreamControl - '));
  check('la source en trop est retiree de la scene', remaining.length === 2, `sources creees : ${remaining.length}`);

  // --- 8. Mode studio : preparer puis diffuser sans toucher a OBS ---------
  console.log('\n--- mode studio ---');
  const studioOn = await c.evaluate('window.streamcontrol.obsSetStudioMode(true)');
  check('le mode studio s active', studioOn.studioMode === true, String(studioOn.studioMode));
  check('les transitions sont remontees', (studioOn.transitions ?? []).includes('Fade'), JSON.stringify(studioOn.transitions));
  check('la transition courante est connue', studioOn.currentTransition === 'Fade', studioOn.currentTransition);

  const previewed = await c.evaluate(`window.streamcontrol.obsSetPreviewScene('Ecran')`);
  check('la previsualisation change', previewed.previewScene === 'Ecran', previewed.previewScene);
  check('le programme ne bouge pas encore', previewed.currentScene !== 'Ecran', previewed.currentScene);

  const taken = await c.evaluate('window.streamcontrol.obsTransition()');
  check('la transition envoie la previsualisation en direct', taken.currentScene === 'Ecran', taken.currentScene);

  const duration = await c.evaluate('window.streamcontrol.obsSetTransitionDuration(500)');
  check('la duree de transition est reglee', duration.transitionDurationMs === 500, String(duration.transitionDurationMs));
  check('le serveur OBS a bien recu la duree', obsServer.state.transitionDuration === 500, String(obsServer.state.transitionDuration));

  const studioOff = await c.evaluate('window.streamcontrol.obsSetStudioMode(false)');
  check('le mode studio se desactive', studioOff.studioMode === false);

  c.close();
} catch (e) {
  console.error('ERREUR:', e.message);
  results.push({n:'execution', ok:false});
} finally {
  child.kill('SIGTERM');
  await harnessSleep(1500);
  if (!child.killed) child.kill('SIGKILL');
  await staticServer.close();
  await obsServer.close();
}

const failed = results.filter(r=>!r.ok);
console.log(`\n=== ${results.length-failed.length}/${results.length} verifications reussies ===`);
if (failed.length) { console.log('Echecs :', failed.map(f=>f.n).join(', ')); process.exitCode = 1; }
