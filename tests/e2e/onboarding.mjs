/**
 * Verifie la visite guidee du premier lancement.
 *
 * Demande : la visite doit presenter TOUTES les nouveautes, pas seulement les
 * onglets d'origine. Elle couvre desormais les services, l'automatisation, le
 * panneau distant, l'analyse et l'installation.
 *
 * Chaque etape doit avoir une cible presente (sinon aucun halo ne s'affiche et
 * la bulle flotte au milieu), un titre et un texte non vides, dans les deux
 * langues.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9440;
const USER_DATA = '/tmp/sc-e2e-onboarding';
const { check, summary } = createChecker();
const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await waitFor('la visite apparait', async () => await cdp.evaluate('Boolean(document.querySelector(".tour-root"))'), 8000);

  console.log('\n--- visite guidee ---');
  const total = await cdp.evaluate(`(() => {
    const m=/Etape (\\d+) sur (\\d+)/.exec(document.querySelector('.tour-step')?.textContent ?? '');
    return m ? Number(m[2]) : 0;
  })()`);
  check('la visite propose plusieurs etapes', total >= 14, `${total} etapes`);
  check('les points de progression suivent', (await cdp.evaluate('document.querySelectorAll(".tour-dot").length')) === total);

  // On parcourt toutes les etapes, en verifiant que la cible est bien mise en
  // valeur (halo) et que le texte est renseigne.
  const steps = [];
  for (let index = 0; index < total; index += 1) {
    const info = await cdp.evaluate(`(() => ({
      title: document.querySelector('.tour-title')?.textContent ?? '',
      body: document.querySelector('.tour-body')?.textContent ?? '',
      halo: Boolean(document.querySelector('.tour-halo'))
    }))()`);
    steps.push(info);
    await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.tour-actions button')].find((x) => /Suivant|Terminer/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(650);
  }

  const titles = steps.map((step) => step.title);
  const emptyText = steps.filter((step) => step.title.trim().length < 3 || step.body.trim().length < 20);
  check('chaque etape a un titre et un texte', emptyText.length === 0, `${emptyText.length} etape(s) vide(s)`);
  check('chaque etape met sa cible en valeur', steps.every((step) => step.halo), `${steps.filter((s) => s.halo).length}/${total} halos`);
  check('aucun texte technique dans la visite', !steps.some((step) => /tour\.|macro\.kind|nav\./.test(step.title + step.body)));

  // Les nouveautes doivent etre presentees nommement.
  const all = titles.join(' | ');
  for (const [label, motif] of [
    ['les services', /services/i],
    ['l automatisation', /automatisation/i],
    ['le panneau distant', /panneau distant/i],
    ["l analyse technique", /analyse technique/i],
    ["l installation", /installation/i],
  ]) {
    check(`la visite presente ${label}`, motif.test(all), all.slice(0, 120));
  }

  // La visite se ferme et ne revient plus.
  const closed = await cdp.evaluate('!document.querySelector(".tour-root")');
  check('la visite se termine', closed);
  await sleep(600);
  const settings = await cdp.evaluate('window.streamcontrol.getSettings()');
  check('la visite est marquee comme vue', settings.ui.onboardingDone === true);

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
