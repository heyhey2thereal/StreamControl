/**
 * Verifie le verrouillage du poste et la categorie FAQ.
 *
 * Le poste sert de serveur de flux : le verrouillage doit masquer toute
 * l'interface, exiger le mot de passe, et laisser une porte de secours
 * (mot de passe maitre fourni par l'environnement) si le mot de passe est
 * oublie.
 *
 * Les actions passent par l'interface (clics, saisie) : c'est le chemin reel
 * de l'utilisateur, et cela met a jour l'etat du rendu.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9380;
const USER_DATA = '/tmp/sc-e2e-lock';

const { check, summary } = createChecker();

const staticServer = await startStaticServer();
const MASTER_PASSWORD = 'maitre-de-test';
const app = startApp({
  userDataDir: USER_DATA,
  debugPort: DEBUG_PORT,
  env: { STREAMCONTROL_MASTER_PASSWORD: MASTER_PASSWORD },
});

/** Saisit une valeur dans un champ, comme le ferait l'utilisateur. */
const typeInto = (cdp, selector, value) =>
  cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

/** Clique le premier bouton dont le texte contient `label`. */
const clickButton = (cdp, label, scope = 'document') =>
  cdp.evaluate(`(() => {
    const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // La visite guidee s'affiche au premier lancement : on la passe, sinon elle
  // couvre l'interface et les clics ne l'atteignent pas. Elle peut apparaitre
  // juste apres le chargement, d'ou l'attente.
  await waitFor('la visite apparait', async () =>
    await cdp.evaluate('Boolean(document.querySelector(".tour-root"))'), 6000);
  if (await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')) {
    await clickButton(cdp, 'Passer');
    await waitFor('la visite se ferme', async () =>
      !(await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')), 8000);
  }

  // --- 1. Sans mot de passe, rien n'est verrouille -----------------------
  console.log('\n--- etat initial ---');
  const initial = await cdp.evaluate('window.streamcontrol.lockState()');
  check('aucun mot de passe au depart', initial.hasPassword === false, JSON.stringify(initial));
  check('aucun ecran de verrouillage', !(await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))')));
  check('le bouton de verrouillage est present', await cdp.evaluate('Boolean(document.querySelector(".lock-button"))'));

  // --- 2. Definir un mot de passe depuis la pop-up ----------------------
  console.log('\n--- definition du mot de passe ---');
  // Le bouton de la barre laterale ouvre directement la pop-up : la saisie ne
  // passe plus par les Parametres.
  await cdp.evaluate(`document.querySelector('.lock-button')?.click()`);
  await waitFor('la pop-up de verrouillage apparait', async () =>
    await cdp.evaluate('Boolean(document.querySelector(".lock-modal"))'), 6000);
  check('la pop-up de verrouillage s ouvre', await cdp.evaluate('Boolean(document.querySelector(".lock-modal"))'));
  check('elle demande le mot de passe', await cdp.evaluate('Boolean(document.getElementById("lock-dialog-password"))'));
  check('elle demande l indice', await cdp.evaluate('Boolean(document.getElementById("lock-dialog-hint"))'));

  await typeInto(cdp, '#lock-dialog-password', 'secret42');
  await typeInto(cdp, '#lock-dialog-hint', 'le nombre prefere');
  await sleep(300);
  await clickButton(cdp, 'Definir et verrouiller');

  const locked = await waitFor('l ecran de verrouillage apparait', async () =>
    await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))'), 8000);
  check('le poste se verrouille', locked);
  const screen = await cdp.evaluate('document.querySelector(".lock-screen")?.textContent ?? ""');
  check('le titre annonce le verrouillage', /verrouille/i.test(screen), screen.slice(0, 40));
  check('il explique que ce PC est un serveur', /serveur/i.test(screen) && /RTMP/i.test(screen));
  check('il demande le mot de passe tout de suite', /mot de passe/i.test(screen), screen.slice(0, 80));
  check('le logo est en filigrane a droite', await cdp.evaluate('Boolean(document.querySelector(".lock-watermark"))'));
  // Le mot de passe est demande tout de suite : plus de clic intermediaire.
  check('le champ de mot de passe est demande d emblee', await cdp.evaluate('Boolean(document.querySelector(".lock-form"))'));
  check('l interface est masquee', !(await cdp.evaluate('Boolean(document.querySelector(".sidebar"))')));
  check('le mot de passe n est pas stocke en clair', (await cdp.evaluate('window.streamcontrol.getSettings()')).ui.lockHash !== 'secret42');

  check('le formulaire est pret sans clic', await cdp.evaluate('Boolean(document.querySelector(".lock-form"))'));
  check('l indice est affiche', (await cdp.evaluate('document.querySelector(".lock-screen")?.textContent ?? ""')).includes('le nombre prefere'));

  // --- 3. Mauvais mot de passe refuse ------------------------------------
  console.log('\n--- refus ---');
  await typeInto(cdp, '.lock-form input', 'mauvais');
  await cdp.evaluate(`document.querySelector('.lock-form').requestSubmit()`);
  await sleep(900);
  check('un mauvais mot de passe est refuse', (await cdp.evaluate('document.querySelector(".lock-error")?.textContent ?? ""')).length > 0);
  check('le poste reste verrouille', await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))'));

  // --- 4. Bon mot de passe deverrouille ----------------------------------
  console.log('\n--- deverrouillage ---');
  await typeInto(cdp, '.lock-form input', 'secret42');
  await cdp.evaluate(`document.querySelector('.lock-form').requestSubmit()`);
  const opened = await waitFor('le poste se rouvre', async () =>
    !(await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))')), 8000);
  check('le bon mot de passe est accepte', opened);
  check('l interface revient', await cdp.evaluate('Boolean(document.querySelector(".sidebar"))'));

  // --- 5. Le mot de passe maitre ouvre toujours --------------------------
  console.log('\n--- mot de passe maitre ---');
  await sleep(600);
  check('le bouton de verrouillage verrouille le poste', await clickButton(cdp, 'Verrouiller', 'document.querySelector(".sidebar")'));
  await waitFor('l ecran revient', async () => await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))'), 8000);
  await typeInto(cdp, '.lock-form input', MASTER_PASSWORD);
  await cdp.evaluate(`document.querySelector('.lock-form').requestSubmit()`);
  const master = await waitFor('le mot de passe maitre ouvre', async () =>
    !(await cdp.evaluate('Boolean(document.querySelector(".lock-screen"))')), 8000);
  check('le mot de passe maitre ouvre', master);

  // --- 6. La FAQ est une categorie a part --------------------------------
  console.log('\n--- FAQ ---');
  const faqNav = await cdp.evaluate(`Boolean([...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('FAQ')))`);
  check('une categorie FAQ existe a gauche', faqNav);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('FAQ')); if (b) b.click(); })()`);
  await sleep(700);
  check('la FAQ s ouvre', (await cdp.evaluate('document.querySelector("h1")?.textContent')) === 'FAQ');
  check('elle liste des questions', (await cdp.evaluate('document.querySelectorAll(".faq-item").length')) >= 5);

  // --- 6b. Visite guidee -------------------------------------------------
  console.log('\n--- visite guidee ---');
  check('la visite ne s affiche plus', !(await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')));
  await cdp.evaluate('window.streamcontrol.getSettings().then((s) => s.ui.onboardingDone)');
  // On la relance depuis les Parametres, comme l'utilisateur.
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => x.textContent.includes('Parametres')); if (b) b.click(); })()`);
  await sleep(700);
  const replayed = await clickButton(cdp, 'Rejouer la visite');
  check('le bouton de visite guidee existe', replayed);
  const tourVisible = await waitFor('la visite apparait', async () =>
    await cdp.evaluate('Boolean(document.querySelector(".tour-root"))'), 8000);
  check('la visite se lance', tourVisible);
  check('un halo met la cible en valeur', await cdp.evaluate('Boolean(document.querySelector(".tour-halo"))'));
  check('la bulle explique l etape', (await cdp.evaluate('document.querySelector(".tour-title")?.textContent ?? ""')).length > 3);
  const stepText = await cdp.evaluate('document.querySelector(".tour-step")?.textContent ?? ""');
  check('le numero d etape est affiche', /1/.test(stepText), stepText);
  // On avance, puis on passe.
  await clickButton(cdp, 'Suivant');
  await sleep(400);
  check('on peut avancer', /2/.test(await cdp.evaluate('document.querySelector(".tour-step")?.textContent ?? ""')));
  await clickButton(cdp, 'Passer');
  const closed = await waitFor('la visite se ferme', async () =>
    !(await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')), 8000);
  check('« Passer » ferme la visite', closed);
  check('la visite est marquee comme vue', (await cdp.evaluate('window.streamcontrol.getSettings()')).ui.onboardingDone === true);

  // --- 7. Configuration OBS ----------------------------------------------
  console.log('\n--- configuration OBS ---');
  const configure = await cdp.evaluate('window.streamcontrol.obsUseStreamControl()');
  check('la configuration OBS est refusee hors connexion', configure.ok === false, configure.message);
  check('avec une raison exploitable', /connectez|OBS/i.test(configure.message ?? ''), configure.message);

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
