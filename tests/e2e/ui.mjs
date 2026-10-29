/**
 * Verifie les changements d'interface demandes :
 * - le theme sombre/clair s'applique et persiste ;
 * - le rangement de fichiers a disparu, seul « Ouvrir le dossier » reste ;
 * - le bouton « Redemarrer MediaMTX » existe sur le tableau de bord ;
 * - la section « URL a saisir dans DJI Mimo » a quitte le tableau de bord.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const USER_DATA = '/tmp/sc-e2e-ui';
const DEBUG_PORT = 9349;

const { check, summary } = createChecker();

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

/** Lit l'attribut de theme pose sur <html>. */
const themeAttr = (cdp) => cdp.evaluate('document.documentElement.getAttribute("data-theme")');

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // --- 1. Le theme par defaut est sombre ---------------------------------
  console.log('\n--- theme ---');
  check('theme sombre par defaut', (await themeAttr(cdp)) === 'dark', await themeAttr(cdp));

  const settings = await cdp.evaluate('window.streamcontrol.getSettings()');
  check('le theme est dans les parametres', settings.ui.theme === 'dark', settings.ui.theme);

  // --- 2. Le theme clair s'applique et persiste ---------------------------
  await cdp.evaluate(`window.streamcontrol.saveSettings({ ui: { theme: 'light' } })`);
  await sleep(1200);
  check('theme clair applique', (await themeAttr(cdp)) === 'light', await themeAttr(cdp));

  const bg = await cdp.evaluate('getComputedStyle(document.body).backgroundColor');
  check('la surface change reellement', bg !== 'rgb(13, 15, 17)', bg);

  // Le selecteur de theme passe aussi par l'interface : c'est le chemin reel.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Parametres'));
    b.click();
  })()`);
  await sleep(800);
  const themeSelectValue = await cdp.evaluate('document.getElementById("settings-theme")?.value');
  check('le selecteur de theme reflete la valeur', themeSelectValue === 'light', themeSelectValue);

  await cdp.evaluate(`(() => {
    const sel = document.getElementById('settings-theme');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'dark');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Enregistrer');
    b.click();
  })()`);
  await sleep(1200);
  check('retour au theme sombre', (await themeAttr(cdp)) === 'dark', await themeAttr(cdp));

  // --- 3. Le rangement de fichiers a disparu -----------------------------
  console.log('\n--- fichiers ---');
  // Les reglages sont classes par categorie : on ouvre celle des fichiers.
  await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.chip')].find(x => x.textContent.includes('Fichiers'));
    if (chip) chip.click();
  })()`);
  await sleep(400);
  const settingsText = await cdp.evaluate('document.body.textContent');
  check('plus de bouton de rangement', !settingsText.includes('Ranger les fichiers'));
  check('bouton Ouvrir le dossier present', settingsText.includes('Ouvrir le dossier'));
  check(
    "l'API de rangement a disparu",
    (await cdp.evaluate('typeof window.streamcontrol.storageGather')) === 'undefined',
  );

  // --- 4. Les animations de chargement sont en place ----------------------
  console.log('\n--- animations de chargement ---');
  const spinner = await cdp.evaluate(`(() => {
    const d = document.createElement('div');
    d.className = 'spinner';
    d.style.width = '32px'; d.style.height = '32px'; d.style.borderWidth = '3px';
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    const out = { anim: cs.animationName, duration: cs.animationDuration };
    d.remove();
    return JSON.stringify(out);
  })()`);
  const spin = JSON.parse(spinner);
  check('l animation d anneau est definie', spin.anim === 'spinner-rotate', spin.anim);
  check('elle tourne en moins de deux secondes', parseFloat(spin.duration) < 2, spin.duration);

  // --- 5. Tableau de bord : redemarrage, plus de section DJI -------------
  console.log('\n--- tableau de bord ---');
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Tableau de bord'));
    b.click();
  })()`);
  await sleep(900);

  const dashboardText = await cdp.evaluate('document.body.textContent');
  check('bouton Redemarrer MediaMTX present', dashboardText.includes('Redemarrer MediaMTX'));
  check('section DJI Mimo retiree', !dashboardText.includes('DJI Mimo'));

  const restartButtons = await cdp.evaluate(
    `[...document.querySelectorAll('button')].filter(b => b.textContent.includes('Redemarrer MediaMTX')).length`,
  );
  check('un seul bouton de redemarrage', restartButtons === 1, `${restartButtons} bouton(s)`);

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[ipc\]|\[streams\]|\[app\]/.test(l)).slice(-10).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
