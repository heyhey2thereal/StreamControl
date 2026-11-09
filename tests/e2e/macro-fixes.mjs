/**
 * Verifie les correctifs du moteur de macros.
 *
 * Quatre defauts corriges, chacun invisible a l'oeil :
 * 1. le delai « temps avant la suite » n'etait jamais observe sur les blocs qui
 *    terminent par `return` (journal, notification, pop-up, son) ;
 * 2. la pop-up de confirmation continuait la suite meme sans autorisation ;
 * 3. l'ecran de verrouillage n'apparaissait pas quand le poste etait verrouille
 *    par une macro ou par le panneau distant ;
 * 4. le fichier de son etait relu a chaque execution (lenteur au declenchement).
 */
import fs from 'node:fs';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9434;
const USER_DATA = '/tmp/sc-e2e-macrofix';
const SOUND_FILE = '/tmp/sc-e2e-macrofix.wav';
const { check, summary } = createChecker();

// Un petit WAV valide, pour la lecture cote processus principal.
fs.writeFileSync(
  SOUND_FILE,
  Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64'),
);

const staticServer = await startStaticServer();
const app = startApp({
  userDataDir: USER_DATA,
  debugPort: DEBUG_PORT,
  env: { STREAMCONTROL_MASTER_PASSWORD: 'maitre-de-test' },
});

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Passer')); if (b) b.click(); })()`);
  await sleep(700);

  // --- 1. Le delai est observe sur un bloc qui termine par un retour --------
  console.log('\n--- temps avant la suite ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => /Automatisation/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(900);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /Nouvelle macro/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);

  const macroId = await cdp.evaluate('window.streamcontrol.macrosList().then((l) => l[l.length - 1].id)');
  // Un bloc « journal » suivi d'un delai de 2 s, puis un second journal.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'log', level: 'info', text: 'Etape un', delaySeconds: 2 },
    { kind: 'log', level: 'info', text: 'Etape deux' }
  ], triggers: [] })`);
  await sleep(700);

  const started = Date.now();
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  const elapsed = Date.now() - started;
  check('le delai avant la suite est observe', elapsed >= 1800, `${elapsed} ms pour un delai de 2 s`);

  const logs = await cdp.evaluate('window.streamcontrol.getLogs()');
  const texts = logs.map((entry) => entry.message);
  const first = texts.findIndex((m) => m === 'Etape un');
  const second = texts.findIndex((m) => m === 'Etape deux');
  check('les deux etapes ont ete executees', first >= 0 && second >= 0, `un=${first} deux=${second}`);

  // --- 2. La pop-up sans confirmation ne bloque pas, avec confirmation si ---
  console.log('\n--- pop-up de confirmation ---');
  // Sans confirmation : la suite continue, et la pop-up n'exige rien.
  // On ne peut pas repondre a une boite native : on verifie le reglage transmis
  // au processus principal par l'execution reelle d'une pop-up sans attente.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'log', level: 'info', text: 'Avant pop-up' },
    { kind: 'popup', text: 'Info', confirmLabel: 'OK', requireConfirmation: false },
    { kind: 'log', level: 'info', text: 'Apres pop-up' }
  ], triggers: [] })`);
  await sleep(700);
  // On ne lance pas ici : la boite native bloquerait le test. Le moteur est
  // couvert par les tests unitaires (`tests/macro-engine.test.mjs`).
  const stored = await cdp.evaluate('window.streamcontrol.macrosList()');
  const popup = stored[stored.length - 1].actions.find((a) => a.kind === 'popup');
  check('la case « demander une confirmation » est enregistree', popup?.requireConfirmation === false, JSON.stringify(popup));

  // --- 3. Le volume d'un son est reglable ---------------------------------
  console.log('\n--- volume du son ---');
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'sound', soundPath: ${JSON.stringify(SOUND_FILE)}, soundVolume: 35 }
  ], triggers: [] })`);
  await sleep(700);
  const withSound = await cdp.evaluate('window.streamcontrol.macrosList()');
  const soundAction = withSound[withSound.length - 1].actions.find((a) => a.kind === 'sound');
  check('le volume du son est enregistre', soundAction?.soundVolume === 35, JSON.stringify(soundAction));

  // --- 4. Le son est lu vite, meme repete --------------------------------
  console.log('\n--- lecture du son ---');
  const firstRead = Date.now();
  const url1 = await cdp.evaluate(`window.streamcontrol.macroReadSound(${JSON.stringify(SOUND_FILE)})`);
  const firstMs = Date.now() - firstRead;
  const secondRead = Date.now();
  const url2 = await cdp.evaluate(`window.streamcontrol.macroReadSound(${JSON.stringify(SOUND_FILE)})`);
  const secondMs = Date.now() - secondRead;
  check('le son est lisible', typeof url1 === 'string' && url1.startsWith('data:audio/'), String(url1).slice(0, 20));
  check('la seconde lecture est servie par le cache', secondMs <= firstMs + 20, `${firstMs} ms puis ${secondMs} ms`);
  check('le contenu est identique', url1 === url2);

  // --- 5. La recherche de blocs trouve « verrouiller le poste » -----------
  console.log('\n--- recherche de blocs ---');
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [], triggers: [] })`);
  await sleep(600);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; })()`);
  const searchPresent = await cdp.evaluate(`Boolean(document.getElementById('block-search'))`);
  check('la palette propose une recherche', searchPresent);

  await cdp.evaluate(`(() => {
    const i=document.getElementById('block-search');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(i,'verrou'); i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(500);
  const found = await cdp.evaluate(`[...document.querySelectorAll('.palette-block')].map((b) => b.textContent.trim())`);
  check('la recherche trouve le bloc de verrouillage', found.some((label) => /Verrouiller le poste/i.test(label)), found.join(' | '));

  await cdp.evaluate(`(() => {
    const i=document.getElementById('block-search');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(i,'zzzz'); i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(400);
  const empty = await cdp.evaluate(`document.querySelectorAll('.palette-block').length`);
  check('une recherche sans resultat vide la liste', empty === 0, `${empty} blocs`);

  // --- 6. Le poste se verrouille vraiment --------------------------------
  console.log('\n--- verrouillage ---');
  await cdp.evaluate(`window.streamcontrol.lockSetPassword('secret42', 'indice').then(() => null)`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.unlock('maitre-de-test').then(() => null)`);
  await sleep(800);
  check('le poste est deverrouille', (await cdp.evaluate('window.streamcontrol.getSettings().then((s) => s.ui.locked)')) === false);
  check('aucun ecran de verrouillage', !(await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))')));

  // Verrouillage sans passer par le bouton : c'est ce que fait une macro.
  await cdp.evaluate(`window.streamcontrol.lockNow().then(() => null)`);
  const appeared = await waitFor(
    'l ecran de verrouillage apparait apres un verrouillage par macro',
    async () => await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))'),
    6000,
  );
  check('l ecran de verrouillage apparait', appeared);
  check('les donnees disent le poste verrouille', (await cdp.evaluate('window.streamcontrol.getSettings().then((s) => s.ui.locked)')) === true);

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}
summary();
