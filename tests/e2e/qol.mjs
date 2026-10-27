/**
 * Verifie les ajouts de confort :
 * - le bandeau d'etat global (MediaMTX, OBS) ;
 * - les raccourcis clavier Ctrl+1..8 et Ctrl+R, ignores pendant la saisie ;
 * - le bouton « Copier toutes les URL » d'une adresse ;
 * - la duplication d'une adresse ;
 * - la liste des raccourcis dans le guide.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const DEBUG_PORT = 9370;
const USER_DATA = '/tmp/sc-e2e-qol';

const { check, summary } = createChecker();

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

/** Envoie un raccourci clavier a la page. */
function pressKey(cdp, key, modifiers = 2) {
  // 2 = Ctrl dans le protocole CDP.
  return cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key.length === 1 ? `Digit${key}` : key,
    modifiers,
    windowsVirtualKeyCode: key.length === 1 ? key.charCodeAt(0) : undefined,
  }).then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? `Digit${key}` : key, modifiers }));
}

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // --- 1. Bandeau d'etat global -----------------------------------------
  console.log('\n--- bandeau d etat ---');
  check('le bandeau d etat est present', await cdp.evaluate('Boolean(document.querySelector(".status-strip"))'));
  const strip = await cdp.evaluate('document.querySelector(".status-strip")?.textContent ?? ""');
  check('il montre MediaMTX', strip.includes('MediaMTX'), strip.slice(0, 40));
  check('il montre OBS', strip.includes('OBS'), strip.slice(0, 60));

  // --- 2. Raccourcis clavier --------------------------------------------
  console.log('\n--- raccourcis ---');
  await pressKey(cdp, '4');
  await sleep(500);
  check('Ctrl+4 ouvre URL de diffusion', (await cdp.evaluate('document.querySelector("h1")?.textContent')) === 'URL de diffusion');

  await pressKey(cdp, '2');
  await sleep(500);
  check('Ctrl+2 ouvre Flux', (await cdp.evaluate('document.querySelector("h1")?.textContent')) === 'Flux');

  // Un raccourci ne doit pas agir pendant la saisie.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Nouvelle adresse'));
    if (b) b.click();
  })()`);
  await sleep(500);
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.endpoint-form .input');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Studio');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pressKey(cdp, '3');
  await sleep(400);
  check('les raccourcis sont ignores pendant la saisie', (await cdp.evaluate('document.querySelector("h1")?.textContent')) === 'Flux');
  check('la saisie est conservee', (await cdp.evaluate('document.querySelector(".endpoint-form .input").value')) === 'Studio');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.endpoint-form button')].find(x=>x.textContent.includes('Fermer')); if(b) b.click(); })()`);
  await sleep(400);

  // --- 3. Copier toutes les URL et dupliquer ----------------------------
  console.log('\n--- confort sur les adresses ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.endpoint')][0];
    const t = b.querySelector('.endpoint-toggle');
    if (t && t.textContent.includes('Afficher')) t.click();
  })()`);
  await sleep(400);
  check('le bouton « Copier toutes les URL » existe', await cdp.evaluate(`Boolean([...document.querySelectorAll('.urls-toolbar button')].find((x) => x.textContent.includes('Copier toutes')))`));

  const before = (await cdp.evaluate('window.streamcontrol.streamsList()')).length;
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.endpoint button')].find((x) => x.textContent.trim() === 'Dupliquer');
    if (b) b.click();
  })()`);
  await sleep(1200);
  const after = (await cdp.evaluate('window.streamcontrol.streamsList()')).length;
  check('dupliquer cree une adresse', after === before + 1, `${before} -> ${after}`);
  const copy = (await cdp.evaluate('window.streamcontrol.streamsList()')).find((s) => s.path.endsWith('-copie'));
  check('la copie reprend le chemin', Boolean(copy), copy?.path);

  // --- 4. Guide : liste des raccourcis ----------------------------------
  console.log('\n--- guide ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('Installation')); if(b) b.click(); })()`);
  await sleep(700);
  const guide = await cdp.evaluate('document.body.textContent');
  check('le guide liste les raccourcis', guide.includes('Raccourcis clavier'), guide.slice(0, 40));
  check('il decrit Ctrl+R', guide.includes('Redemarrer MediaMTX'));
  check('les touches sont affichees', (await cdp.evaluate('document.querySelectorAll("kbd").length')) >= 8);

  // --- 5. FAQ et remerciements ------------------------------------------
  // La FAQ a sa propre categorie depuis qu'elle a ete separee du guide.
  console.log('\n--- FAQ ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('FAQ')); if(b) b.click(); })()`);
  await sleep(700);
  const faq = await cdp.evaluate('document.querySelector(".faq")?.textContent ?? ""');
  check('la FAQ est presente', faq.length > 200, `${faq.length} caracteres`);
  check('elle explique la latence', /latence/i.test(faq) && /Wi-Fi/i.test(faq));
  check('elle explique l absence de video', /ne passe pas en video/i.test(faq));
  check('elle explique le demarrage de MediaMTX', /demarrer MediaMTX/i.test(faq));
  check('elle explique le fonctionnement', /Comment ca fonctionne/i.test(faq));
  check('elle cite le developpeur', faq.includes('heyhey2thereal'));
  check('au moins 5 questions', (await cdp.evaluate('document.querySelectorAll(".faq-item").length')) >= 5);
  const thanks = await cdp.evaluate('document.querySelector(".thanks")?.textContent ?? ""');
  check('les remerciements a MediaMTX sont presents', /MediaMTX/.test(thanks) && /bluenviron/.test(thanks), thanks.slice(0, 50));

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
