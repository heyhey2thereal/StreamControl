/**
 * Verifie le bloc « notifier » et sa coche de notification.
 *
 * Demande : la coche « Faire une notification StreamControl » decide de ce qui
 * se passe. Cocher : la bulle apparait en bas a gauche de la fenetre. Decocher :
 * le message ne va que dans le journal.
 *
 * Le defaut corrige : le rendu n'ecoutait pas l'evenement `macro:notice`. La
 * notification ne partait donc jamais dans l'interface, meme cochee.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9438;
const USER_DATA = '/tmp/sc-e2e-macronotify';
const { check, summary } = createChecker();
const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await waitFor('visite', async () => await cdp.evaluate('Boolean(document.querySelector(".tour-root"))'), 6000);
  if (await cdp.evaluate('Boolean(document.querySelector(".tour-root"))')) {
    await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => x.textContent.includes('Passer')); if (b) b.click(); })()`);
    await sleep(600);
  }

  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => /Automatisation/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(900);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /Nouvelle macro/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);
  const macroId = await cdp.evaluate('window.streamcontrol.macrosList().then((l) => l[l.length - 1].id)');

  // --- 1. Le bloc notifier propose la coche ------------------------------
  console.log('\n--- bloc notifier ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.palette-block')].find((x) => x.textContent.trim() === 'Notifier'); if (b) b.click(); })()`);
  await sleep(700);
  await cdp.evaluate(`document.querySelector('.block-toggle')?.click()`);
  await sleep(600);

  const block = await cdp.evaluate(`(() => {
    const labels=[...document.querySelectorAll('.block-body .field > label')].map((x) => x.textContent.trim());
    const box=document.querySelector('.block-body input[type=checkbox]');
    return {
      labels,
      hasBox: Boolean(box),
      checkedByDefault: box?.checked ?? false,
      // Le libelle de la coche ne doit apparaitre qu'UNE fois.
      duplicates: labels.filter((l) => /notification StreamControl/.test(l)).length
    };
  })()`);
  check('le bloc notifier propose la coche', block.hasBox);
  check('la coche est activee par defaut', block.checkedByDefault === true);
  check('le libelle de la coche n apparait qu une fois', block.duplicates === 1, `${block.duplicates} fois`);

  // --- 2. Coche activee : la bulle apparait en bas a gauche --------------
  console.log('\n--- coche activee ---');
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [{ kind: 'notify', text: 'Bulle visible', notifyToast: true }], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);

  const shown = await waitFor('la bulle de macro apparait', async () => await cdp.evaluate('Boolean(document.querySelector(".macro-toasts .toast.macro"))'), 6000);
  check('la bulle de macro apparait', shown);

  const bubble = await cdp.evaluate(`(() => {
    const t=document.querySelector('.macro-toasts .toast.macro');
    if(!t) return null;
    const box=t.getBoundingClientRect();
    return {
      text: t.textContent,
      tag: t.querySelector('.toast-tag')?.textContent,
      left: Math.round(box.left),
      right: Math.round(box.right),
      width: window.innerWidth
    };
  })()`);
  check('elle porte le message', /Bulle visible/.test(bubble?.text ?? ''), bubble?.text);
  check('elle est marquee comme une macro', /Macro/i.test(bubble?.tag ?? ''), bubble?.tag);
  check('elle est en bas a gauche', bubble.left < 60 && bubble.left < bubble.width - bubble.right, `left=${bubble.left}, largeur=${bubble.width}`);

  // --- 3. Coche desactivee : journal seulement ---------------------------
  console.log('\n--- coche desactivee ---');
  // On laisse la bulle precedente disparaitre avant de tester l'absence.
  await sleep(7500);
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [{ kind: 'notify', text: 'Journal seulement', notifyToast: false }], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  await sleep(2500);

  const bubbles = await cdp.evaluate('document.querySelectorAll(".macro-toasts .toast.macro").length');
  check('aucune bulle quand la coche est desactivee', bubbles === 0, `${bubbles} bulle(s)`);

  const logs = (await cdp.evaluate('window.streamcontrol.getLogs()')).map((entry) => entry.message);
  check('le message est quand meme ecrit au journal', logs.includes('Journal seulement'));

  // --- 4. Le reglage est bien enregistre ---------------------------------
  const saved = await cdp.evaluate('window.streamcontrol.macrosList().then((l) => JSON.stringify(l[l.length - 1].actions))');
  check('la coche est enregistree', /"notifyToast":false/.test(saved), saved.slice(0, 80));

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
