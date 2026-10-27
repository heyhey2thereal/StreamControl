/**
 * Verifie que le changement de langue s'applique reellement dans l'interface.
 *
 * Le defaut corrige ici etait silencieux : les traductions existaient, mais le
 * fournisseur de langue n'etait jamais monte et aucun composant n'appelait la
 * fonction de traduction. Le selecteur changeait donc une valeur que personne
 * ne lisait.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const USER_DATA = '/tmp/sc-e2e-lang';
const DEBUG_PORT = 9348;

const { check, summary } = createChecker();

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  const navText = () =>
    cdp.evaluate('Array.from(document.querySelectorAll(".nav-item")).map(b => b.textContent).join("|")');

  // --- 1. L'interface demarre en francais --------------------------------
  const french = await navText();
  check('interface en francais par defaut', french.includes('Tableau de bord') && french.includes('Journaux'), french.slice(0, 60));

  // --- 2. Le changement de langue passe par l'interface -------------------
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Parametres'));
    b.click();
  })()`);
  await sleep(800);
  check('vue Parametres ouverte', (await cdp.evaluate('document.querySelector("h1")?.textContent')) === 'Parametres');

  // Le selecteur de langue porte un identifiant stable : la page en contient
  // plusieurs, et l'ordre ne doit pas decider de ce qu'on modifie.
  await cdp.evaluate(`(() => {
    const lang = document.getElementById('settings-language');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(lang, 'en');
    lang.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);

  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Enregistrer');
    b.click();
  })()`);
  await sleep(1500);

  const english = await navText();
  check('navigation traduite en anglais', english.includes('Dashboard') && english.includes('Logs'), english.slice(0, 60));
  check('le francais a disparu de la navigation', !english.includes('Tableau de bord'), english.slice(0, 60));

  // --- 3. Les autres vues suivent ----------------------------------------
  const expected = [
    { nav: 'Streams', heading: 'Streams' },
    { nav: 'Services', heading: 'Services' },
    { nav: 'Stream URLs', heading: 'Stream URLs' },
    { nav: 'OBS Studio', heading: 'OBS Studio' },
    { nav: 'Logs', heading: 'Logs' },
    { nav: 'Settings', heading: 'Settings' },
  ];
  for (const view of expected) {
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes(${JSON.stringify(view.nav)}));
      if (b) b.click();
    })()`);
    await sleep(350);
    const heading = await cdp.evaluate('document.querySelector("h1")?.textContent');
    check(`vue "${view.nav}" traduite`, heading === view.heading, heading);
  }

  // --- 4. Le retour au francais fonctionne aussi -------------------------
  await cdp.evaluate(`window.streamcontrol.saveSettings({ ui: { language: 'fr' } })`);
  await sleep(1200);
  const backToFrench = await navText();
  check('retour au francais', backToFrench === french, backToFrench.slice(0, 60));

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[settings\]|\[app\]/.test(l)).slice(-8).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
}

summary();
