/**
 * Test de bout en bout : lance l'application reelle, se connecte au
 * renderer via le Chrome DevTools Protocol, puis verifie que l'interface
 * React est rendue et que l'API IPC exposee repond correctement.
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createCdp, sleep as harnessSleep } from './harness.mjs';

const userDataDir = '/tmp/sc-e2e-userdata';

const DEBUG_PORT = 9333;

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
}

const staticServer = await startStaticServer();
const app = startApp({ userDataDir, debugPort: DEBUG_PORT });
const child = app.child;
const logs = '';

try {
  const target = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await harnessSleep(2500); // laisse React terminer le chargement initial

  // --- 1. Rendu de l'interface ------------------------------------------
  const title = await cdp.evaluate('document.title');
  check('titre de la fenetre', title === 'StreamControl', title);

  const navLabels = await cdp.evaluate(
    'Array.from(document.querySelectorAll(".nav-item")).map(b => b.textContent)',
  );
  check('navigation rendue (9 entrees)', Array.isArray(navLabels) && navLabels.length === 9, JSON.stringify(navLabels));

  const brand = await cdp.evaluate('document.querySelector(".brand-text strong")?.textContent');
  check('marque affichee', brand === 'StreamControl', brand);

  const dashboardHeading = await cdp.evaluate('document.querySelector("h1")?.textContent');
  check('tableau de bord par defaut', dashboardHeading === 'Tableau de bord', dashboardHeading);

  // --- 2. API IPC exposee par le preload --------------------------------
  const apiKeys = await cdp.evaluate('Object.keys(window.streamcontrol || {}).length');
  check('API contextBridge exposee', apiKeys > 20, `${apiKeys} methodes`);

  const isolation = await cdp.evaluate('typeof window.require + "/" + typeof window.process');
  check('isolation du contexte (pas de Node dans le rendu)', isolation === 'undefined/undefined', isolation);

  const settings = await cdp.evaluate('window.streamcontrol.getSettings()');
  check('getSettings renvoie la structure attendue',
    settings && settings.mediamtx && settings.mediamtx.rtmpPort === 1935,
    `rtmpPort=${settings?.mediamtx?.rtmpPort}`);

  const preflight = await cdp.evaluate('window.streamcontrol.getPreflight()');
  check('getPreflight renvoie reseau + outils + ports',
    preflight && preflight.network && Array.isArray(preflight.tools) && Array.isArray(preflight.ports),
    `tools=${preflight?.tools?.length} ports=${preflight?.ports?.length}`);

  check('URL RTMP construite a partir de l IPv4',
    typeof preflight.urls.rtmpIngest === 'string' && preflight.urls.rtmpIngest.startsWith('rtmp://'),
    preflight.urls.rtmpIngest);

  const hlsOk = preflight.urls.hls.includes(':8888/') && preflight.urls.hls.endsWith('index.m3u8');
  check('URL HLS correcte', hlsOk, preflight.urls.hls);

  // --- 3. Persistance des parametres ------------------------------------
  const saved = await cdp.evaluate(
    'window.streamcontrol.saveSettings({ mediamtx: { rtmpPort: 1940, streamPath: "regie" } })',
  );
  check('saveSettings applique le patch', saved?.mediamtx?.rtmpPort === 1940, `rtmpPort=${saved?.mediamtx?.rtmpPort}`);

  const urlsAfter = await cdp.evaluate('window.streamcontrol.getUrls()');
  check('les URL refletent le nouveau port et chemin',
    urlsAfter.rtmpIngest.endsWith(':1940/regie'),
    urlsAfter.rtmpIngest);

  await harnessSleep(400);
  const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
  check('parametres ecrits sur disque', onDisk.mediamtx.rtmpPort === 1940, `disque rtmpPort=${onDisk.mediamtx.rtmpPort}`);

  const sanitized = await cdp.evaluate('window.streamcontrol.saveSettings({ mediamtx: { rtmpPort: 99999 } })');
  check('les valeurs hors limites sont bornees', sanitized.mediamtx.rtmpPort === 65535, `rtmpPort=${sanitized.mediamtx.rtmpPort}`);

  // --- 4. Gestion des erreurs -------------------------------------------
  const mediamtxResult = await cdp.evaluate('window.streamcontrol.startMediamtx()');
  check('demarrage sans binaire renvoie une erreur exploitable',
    mediamtxResult.ok === false && /introuvable/i.test(mediamtxResult.message ?? ''),
    mediamtxResult.message?.slice(0, 80));

  const obsResult = await cdp.evaluate('window.streamcontrol.launchObs()');
  check('lancement OBS sans installation renvoie une erreur claire',
    obsResult.ok === false && /obs64\.exe introuvable/i.test(obsResult.message ?? ''),
    obsResult.message?.slice(0, 60));

  const obsStatus = await cdp.evaluate('window.streamcontrol.obsGetStatus()');
  check('obsGetStatus renvoie un etat structure', obsStatus && typeof obsStatus.connected === 'boolean', `connected=${obsStatus?.connected}`);

  const badExternal = await cdp.evaluate(
    'window.streamcontrol.openExternal("file:///etc/passwd").then(() => "allowed").catch(e => "blocked")',
  );
  check('openExternal refuse les protocoles non http(s)', badExternal === 'blocked', badExternal);

  const badChannel = await cdp.evaluate(
    '(() => { try { window.streamcontrol.on("evil:channel", () => {}); return "allowed"; } catch { return "blocked"; } })()',
  );
  check('abonnement a un canal inconnu refuse', badChannel === 'blocked', badChannel);

  // --- 5. Navigation et journaux ----------------------------------------
  const logs = await cdp.evaluate('window.streamcontrol.getLogs()');
  check('les journaux sont remontes au rendu', Array.isArray(logs) && logs.length > 0, `${logs.length} entrees`);

  const navigated = await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('.nav-item'));
    const target = buttons.find(b => b.textContent.includes('Journaux'));
    target.click();
    return true;
  })()`);
  await harnessSleep(700);
  const logsHeading = await cdp.evaluate('document.querySelector("h1")?.textContent');
  check('navigation vers Journaux fonctionne', navigated && logsHeading === 'Journaux', logsHeading);

  const logLines = await cdp.evaluate('document.querySelectorAll(".log-line").length');
  check('lignes de journal affichees', logLines > 0, `${logLines} lignes`);

  const resetDone = await cdp.evaluate('window.streamcontrol.resetSettings()');
  check('resetSettings restaure les valeurs par defaut',
    resetDone.mediamtx.rtmpPort === 1935 && resetDone.mediamtx.streamPath === 'live',
    `rtmpPort=${resetDone.mediamtx.rtmpPort} path=${resetDone.mediamtx.streamPath}`);

  cdp.close();
} catch (error) {
  console.error('ERREUR E2E :', error.message);
  results.push({ name: 'execution', ok: false, detail: error.message });
} finally {
  child.kill('SIGTERM');
  await harnessSleep(1500);
  if (!child.killed) child.kill('SIGKILL');
  await staticServer.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} verifications reussies ===`);
if (failed.length > 0) {
  console.log('Echecs :', failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
