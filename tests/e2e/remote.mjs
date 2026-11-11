/**
 * Verifie le panneau distant (StreamControl Remote).
 *
 * Deux interfaces distinctes sont servies a la meme adresse `/remote` :
 * - un **telephone** recoit la version mobile, faite de grands boutons ;
 * - un **ordinateur** du reseau recoit la vue complete : tous les flux en
 *   grille, leurs parametres, et l'enregistrement de la lecture dans le
 *   navigateur (dossier Telechargements).
 *
 * Le test verifie aussi les **autorisations** : ce que le poste autorise, et
 * surtout ce qu'il refuse. Masquer une section ne suffit pas, le serveur doit
 * refuser l'action.
 */
import http from 'node:http';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const USER_DATA = '/tmp/sc-e2e-remote';
const DEBUG_PORT = 9355;
const WEB_PAGES_PORT = 48092;

const { check, summary } = createChecker();

/** Requete HTTP avec en-tetes, corps optionnel et User-Agent explicite. */
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
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
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

const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

const base = `http://127.0.0.1:${WEB_PAGES_PORT}`;

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // Le serveur de pages doit ecouter sur un port connu.
  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ mediamtx: { webPagesPort: ${WEB_PAGES_PORT} } })`,
  );
  await sleep(1200);

  // --- 1. Le panneau distant est desactive : la page le dit --------------
  console.log('\n--- panneau desactive ---');
  const disabled = await request(`${base}/remote`, { headers: { 'User-Agent': PC_UA } });
  check('la page est servie', disabled.status === 200, `HTTP ${disabled.status}`);
  check('elle explique que le panneau est desactive', disabled.body.includes('desactive'));

  // --- 2. On active le panneau distant -----------------------------------
  console.log('\n--- panneau active ---');
  await cdp.evaluate(`window.streamcontrol.saveSettings({ remote: { enabled: true } })`);
  await sleep(900);

  // --- 3. Un PC recoit la vue ordinateur, un telephone la vue mobile -----
  console.log('\n--- deux interfaces distinctes ---');
  const pc = await request(`${base}/remote`, { headers: { 'User-Agent': PC_UA } });
  check('la page ordinateur est servie', pc.status === 200, `HTTP ${pc.status}`);
  check('elle porte le badge Ordinateur', pc.body.includes('Ordinateur'));
  check('elle propose l enregistrement dans le navigateur', pc.body.includes('Enregistrer la lecture'));
  check('elle parle du dossier Telechargements', pc.body.includes('Telechargements'));
  // Les flux ne doivent PAS se lancer tout seuls : on ne joue que sur demande.
  check(
    'aucun flux ne se lance automatiquement',
    pc.body.includes('On ne joue QUE les flux demandes') || !pc.body.includes('autoplay'),
    'pas de lecture automatique',
  );
  check('elle propose le retour au direct', pc.body.includes('Retour au direct'));
  check('elle propose de tout lire et tout arreter', pc.body.includes('Tout lire') && pc.body.includes('Tout arreter'));
  // La grille est reconciliee : le rafraichissement est rapide (2 s), pas 5 s.
  check('le rafraichissement de la grille est rapide', /}, 2000\)/.test(pc.body), 'intervalle 2000 ms');
  // Le plein ecran ne doit pas etre quitte a chaque rafraichissement : la page
  // ne deplace plus une carte dont la position n'a pas change.
  check(
    'la carte n est pas deplacee sans raison',
    pc.body.includes('node.nextElementSibling !== reference'),
    'reconciliation sans deplacement inutile',
  );
  // Le replay a la demande est propose quand il est autorise et actif.
  check('elle propose l extraction d un replay', pc.body.includes('Extraire un replay'));

  const phone = await request(`${base}/remote`, { headers: { 'User-Agent': PHONE_UA } });
  check('la page telephone est servie', phone.status === 200, `HTTP ${phone.status}`);
  // La page mobile garde son en-tete compact et n'affiche pas les elements de
  // la vue ordinateur (grille complete, badge « Ordinateur »).
  check('elle garde son en-tete compact', phone.body.includes('maximum-scale=1'));
  check('elle n a pas le badge Ordinateur', !phone.body.includes('>Ordinateur<'));
  // L'enregistrement dans le navigateur est disponible AUSSI sur mobile.
  check('elle propose l enregistrement dans le navigateur', phone.body.includes('Enregistrer la lecture'));

  // --- 4. Autorisations : tout est refuse par defaut ---------------------
  console.log('\n--- autorisations ---');
  // On paire un PC pour obtenir un jeton.
  const pair = await request(`${base}/remote/pair`, {
    method: 'POST',
    headers: { 'User-Agent': PC_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '' }),
  });
  const pairId = JSON.parse(pair.body).id;
  check('une demande d appairage est creee', Boolean(pairId), pairId);

  // L'utilisateur accepte la demande depuis le poste.
  await cdp.evaluate(`window.streamcontrol.remoteApprove(${JSON.stringify(pairId)}, true)`);
  await sleep(400);

  const status = await request(`${base}/remote/pair/${pairId}`);
  const token = JSON.parse(status.body).token;
  check('un jeton est remis apres acceptation', Boolean(token));

  const authHeaders = { 'User-Agent': PC_UA, 'X-Remote-Token': token };

  // Sans autorisation, l'action est refusee par le serveur (403), pas seulement
  // masquee dans la page.
  const deniedScene = await request(`${base}/remote/scene`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene: 'Scene 1' }),
  });
  check('une scene est refusee sans autorisation', deniedScene.status === 403, `HTTP ${deniedScene.status}`);

  const deniedMacro = await request(`${base}/remote/action`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'macro', id: 'nimporte' }),
  });
  check('une macro est refusee sans autorisation', deniedMacro.status === 403, `HTTP ${deniedMacro.status}`);

  const deniedLock = await request(`${base}/remote/action`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'lock' }),
  });
  check('le verrouillage est refuse sans autorisation', deniedLock.status === 403, `HTTP ${deniedLock.status}`);

  // L'etat renvoie les autorisations, pour que la page masque ce qui est refuse.
  const state = await request(`${base}/remote/state`, { headers: authHeaders });
  const parsed = JSON.parse(state.body);
  check('l etat porte les autorisations', parsed.permissions && parsed.permissions.macros === false);

  // --- 5. On accorde une autorisation : l'action n'est plus refusee -------
  console.log('\n--- autorisation accordee ---');
  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ remote: { desktop: { scenes: false, recording: false, download: true, macros: true, controls: false } } })`,
  );
  await sleep(900);

  const stateAfter = JSON.parse((await request(`${base}/remote/state`, { headers: authHeaders })).body);
  check('la macro est desormais autorisee', stateAfter.permissions.macros === true);

  // Une macro inexistante echoue proprement, mais n'est plus refusee (403).
  const macroNow = await request(`${base}/remote/action`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'macro', id: 'nimporte' }),
  });
  check('la macro n est plus refusee', macroNow.status !== 403, `HTTP ${macroNow.status}`);

  // Le verrouillage reste refuse : seule la macro a ete accordee.
  const lockStill = await request(`${base}/remote/action`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'lock' }),
  });
  check('le verrouillage reste refuse', lockStill.status === 403, `HTTP ${lockStill.status}`);

  // --- 6. Le telephone a ses propres autorisations -----------------------
  console.log('\n--- autorisations du telephone ---');
  const phonePair = await request(`${base}/remote/pair`, {
    method: 'POST',
    headers: { 'User-Agent': PHONE_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '' }),
  });
  const phonePairId = JSON.parse(phonePair.body).id;
  await cdp.evaluate(`window.streamcontrol.remoteApprove(${JSON.stringify(phonePairId)}, true)`);
  await sleep(400);
  const phoneToken = JSON.parse((await request(`${base}/remote/pair/${phonePairId}`)).body).token;
  const phoneHeaders = { 'User-Agent': PHONE_UA, 'X-Remote-Token': phoneToken };

  const phoneState = JSON.parse((await request(`${base}/remote/state`, { headers: phoneHeaders })).body);
  check(
    'le telephone garde ses propres autorisations',
    phoneState.permissions.macros === false && phoneState.permissions.download === false,
    JSON.stringify(phoneState.permissions),
  );

  // --- 7. Sans jeton, rien n'est accessible ------------------------------
  console.log('\n--- sans jeton ---');
  const noToken = await request(`${base}/remote/state`, { headers: { 'User-Agent': PC_UA } });
  check('l etat exige un jeton', noToken.status === 401, `HTTP ${noToken.status}`);

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[remote\]|\[web\]/.test(l)).slice(-10).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
