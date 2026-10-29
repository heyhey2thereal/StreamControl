/**
 * Verifie la fenetre de mise a jour proposee au lancement.
 *
 * Le processus principal interroge l'API de publication. Le test la remplace
 * par un petit serveur local (STREAMCONTROL_UPDATE_API) qui sert une version
 * identique a celle installee : c'est le cas demande, ou une meme version
 * reconstruite avec des correctifs doit quand meme etre proposee.
 *
 * Trois reponses sont exercees : telecharger (ouvre l'installeur), plus tard
 * (ferme sans rien retenir), et ne plus me rappeler (enregistre la version).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9360;
const API_PORT = 9361;
const USER_DATA = '/tmp/sc-e2e-update';

const { check, summary } = createChecker();

// --- Serveur de publication simule ---------------------------------------
const RELEASE = {
  tag_name: 'v2.0.0',
  name: 'StreamControl v2.0.0',
  html_url: 'http://127.0.0.1:9361/release-page',
  published_at: '2026-10-26T00:00:00Z',
  body: '## Corrections\n\n- Le lecteur WebRTC fonctionne.\n- `Latence` corrigee.',
  assets: [
    {
      name: 'StreamControl-Setup-2.0.0.exe',
      browser_download_url: 'http://127.0.0.1:9361/StreamControl-Setup-2.0.0.exe',
    },
  ],
};

let releaseCalls = 0;
let authenticatedCalls = 0;
const releaseServer = http.createServer((request, response) => {
  const url = request.url ?? '/';
  if (url.startsWith('/repos/')) {
    releaseCalls += 1;
    // Un depot public repond sans jeton. On note la presence d'un en-tete
    // d'authentification pour verifier qu'aucun jeton n'est exige.
    if (request.headers.authorization) authenticatedCalls += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(RELEASE));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('ok');
});

await new Promise((resolve) => releaseServer.listen(API_PORT, '127.0.0.1', resolve));

// --- Configuration de publication pointee sur le serveur local -----------
const configPath = path.join(os.tmpdir(), 'sc-update-config.yml');
fs.writeFileSync(configPath, 'provider: github\nowner: heyhey2thereal\nrepo: StreamControl\n');

const staticServer = await startStaticServer();
const app = startApp({
  userDataDir: USER_DATA,
  debugPort: DEBUG_PORT,
  env: {
    STREAMCONTROL_UPDATE_API: `http://127.0.0.1:${API_PORT}`,
    STREAMCONTROL_UPDATE_CONFIG: configPath,
    // Aucun jeton : la verification doit fonctionner sans authentification.
    STREAMCONTROL_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  },
});

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  // --- 1. La fenetre apparait toute seule au lancement -------------------
  console.log('\n--- fenetre au lancement ---');
  const appeared = await waitFor(
    'la fenetre de mise a jour apparait',
    async () => await cdp.evaluate('Boolean(document.querySelector(".update-modal"))'),
    20_000,
  );
  check('la fenetre de mise a jour apparait au lancement', appeared);
  check('la version publiee est annoncee', (await cdp.evaluate('document.querySelector(".update-modal")?.textContent ?? ""')).includes('v2.0.0'));
  const text = await cdp.evaluate('document.querySelector(".update-modal")?.textContent ?? ""');
  check('les notes de version sont affichees', text.includes('Le lecteur WebRTC fonctionne'), text.slice(0, 60));
  check('les trois reponses sont proposees', await cdp.evaluate(`(() => {
    const labels = [...document.querySelectorAll('.update-modal .modal-actions button')].map((b) => b.textContent);
    return labels.length === 3 && labels.some((l) => /Plus tard/i.test(l)) && labels.some((l) => /rappeler/i.test(l));
  })()`));

  // --- 2. « Plus tard » ferme sans rien retenir --------------------------
  console.log('\n--- plus tard ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.update-modal .modal-actions button')].find((x) => /Plus tard/i.test(x.textContent));
    b.click();
  })()`);
  await sleep(500);
  check('« Plus tard » ferme la fenetre', !(await cdp.evaluate('Boolean(document.querySelector(".update-modal"))')));
  check('aucune version ecartee', (await cdp.evaluate('window.streamcontrol.getSettings()')).ui.dismissedUpdateVersion === '');

  // --- 3. Verification manuelle : la fenetre revient ---------------------
  console.log('\n--- verification manuelle ---');
  const manual = await cdp.evaluate('window.streamcontrol.checkAppUpdate(true)');
  check('checkAppUpdate renvoie la version publiee', manual?.version === 'v2.0.0', manual?.version);
  check('la version installee est connue', manual?.currentVersion === '2.0.0', manual?.currentVersion);
  check(
    'les notes sont en texte simple (sans balisage Markdown)',
    typeof manual?.notes === 'string' && !manual.notes.includes('##') && manual.notes.includes('Le lecteur WebRTC fonctionne'),
    (manual?.notes ?? '').slice(0, 40),
  );
  check(
    "l'adresse de l'installeur est fournie",
    typeof manual?.downloadUrl === 'string' && manual.downloadUrl.endsWith('StreamControl-Setup-2.0.0.exe'),
    manual?.downloadUrl,
  );

  // --- 4. « Ne plus me rappeler » enregistre la version ------------------
  // On passe par le bouton des Parametres, qui ignore la version ecartee et
  // fait reapparaitre la fenetre : c'est le chemin reel de l'utilisateur.
  console.log('\n--- ne plus me rappeler ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('Parametres'));
    if (b) b.click();
  })()`);
  await sleep(700);
  // Les reglages sont classes par categorie : le bouton de verification vit
  // dans la categorie « Mises a jour ».
  await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.chip')].find(x => x.textContent.includes('Mises a jour'));
    if (chip) chip.click();
  })()`);
  await sleep(400);
  const clicked = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Verifier les mises a jour/i.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check('le bouton de verification est present', clicked);
  await waitFor('la fenetre reapparait', async () => await cdp.evaluate('Boolean(document.querySelector(".update-modal"))'), 8000);
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.update-modal .modal-actions button')].find((x) => /rappeler/i.test(x.textContent));
    b.click();
  })()`);
  const ignored = await waitFor('la version est enregistree', async () => {
    const settings = await cdp.evaluate('window.streamcontrol.getSettings()');
    return settings.ui.dismissedUpdateVersion === 'v2.0.0';
  }, 8000);
  check('la version ecartee est enregistree', ignored);
  const closed = await waitFor(
    'la fenetre se ferme',
    async () => !(await cdp.evaluate('Boolean(document.querySelector(".update-modal"))')),
    8000,
  );
  check('la fenetre est fermee', closed);

  // --- 5. Une version ecartee n'est plus proposee ------------------------
  console.log('\n--- version ecartee ---');
  const afterIgnore = await cdp.evaluate('window.streamcontrol.checkAppUpdate(false)');
  check('une version ecartee n est plus proposee', afterIgnore === null, JSON.stringify(afterIgnore));
  const forced = await cdp.evaluate('window.streamcontrol.checkAppUpdate(true)');
  check('la verification manuelle la retrouve', forced?.version === 'v2.0.0', forced?.version);

  // --- 6. La verification fonctionne sans jeton --------------------------
  console.log('\n--- verification sans jeton ---');
  check('des requetes ont bien ete envoyees', releaseCalls > 0, String(releaseCalls));
  check('aucune requete n a exige un jeton', authenticatedCalls === 0, String(authenticatedCalls));

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[updater\]/.test(l)).slice(-8).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
  await new Promise((resolve) => releaseServer.close(resolve));
  fs.rmSync(configPath, { force: true });
}

summary();
