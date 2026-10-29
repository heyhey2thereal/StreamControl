/**
 * Verifie que les champs de l'editeur de macros repondent vraiment :
 * on change une valeur dans l'interface, on enregistre, on relit.
 */
import fs from 'node:fs';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9430;
const USER_DATA = '/tmp/sc-e2e-macroui';
/** Chemins imposes au selecteur de fichier : la boite native n'est pas pilotable. */
const PICK_FOLDER = '/tmp/sc-e2e-macro-dir';
const PICK_SOUND = '/tmp/sc-e2e-macro-son.wav';
const { check, summary } = createChecker();
const staticServer = await startStaticServer();
const app = startApp({
  userDataDir: USER_DATA,
  debugPort: DEBUG_PORT,
  env: {
    STREAMCONTROL_PICK_PATH_FOLDER: PICK_FOLDER,
    STREAMCONTROL_PICK_PATH_FILE: PICK_SOUND,
  },
});

// Un petit fichier WAV valide, pour que la lecture cote processus principal
// renvoie bien une URL de donnees.
fs.writeFileSync(
  PICK_SOUND,
  Buffer.from(
    'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    'base64',
  ),
);

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

  // Aller sur Automatisation.
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => /Automatisation/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(800);

  // Creer une macro.
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /Nouvelle macro/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(900);

  // Ajouter un bloc « Regler le volume » depuis la palette.
  const added = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.palette-block')].find((x) => /volume/i.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check('bloc volume ajoute depuis la palette', added);
  await sleep(600);

  // Ouvrir le bloc.
  await cdp.evaluate(`document.querySelector('.block-toggle')?.click()`);
  await sleep(500);
  const fields = await cdp.evaluate('document.querySelectorAll(".block-body .field").length');
  check('le bloc expose ses champs', fields >= 3, `${fields} champs`);

  // Saisir un volume et verifier qu'il est bien pris en compte.
  const typed = await cdp.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.block-body input[type=number]')];
    const target = inputs[0];
    if (!target) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, '77');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return target.value;
  })()`);
  check('la saisie du volume est prise', typed === '77', String(typed));
  await sleep(700);

  // Relire depuis le disque : la valeur doit avoir survecu.
  const stored = await cdp.evaluate('window.streamcontrol.macrosList()');
  const volume = stored[0]?.actions?.[0]?.volume;
  check('le volume est enregistre', volume === 77, String(volume));

  // Case a cocher : on ajoute un bloc pop-up et on decoche la confirmation.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.palette-block')].find((x) => /Pop-up/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(600);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[1]) b[1].click(); })()`);
  await sleep(500);

  const toggled = await cdp.evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.block-body input[type=checkbox]')];
    const box = boxes[0];
    if (!box) return null;
    box.click();
    return box.checked;
  })()`);
  await sleep(800);
  const after = await cdp.evaluate('window.streamcontrol.macrosList()');
  const popup = after[0]?.actions?.find((a) => a.kind === 'popup');
  check('la case a cocher change bien la valeur', popup?.requireConfirmation === false, JSON.stringify(popup));

  // Menu deroulant : on choisit un niveau de journal.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.palette-block')].find((x) => /journal/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(600);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[2]) b[2].click(); })()`);
  await sleep(500);
  const selected = await cdp.evaluate(`(() => {
    const select = document.querySelector('.block-body select');
    if (!select) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'error');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  check('le menu deroulant change', selected === 'error', String(selected));
  await sleep(800);
  const final = await cdp.evaluate('window.streamcontrol.macrosList()');
  const log = final[0]?.actions?.find((a) => a.kind === 'log');
  check('le niveau est enregistre', log?.level === 'error', JSON.stringify(log));

  // On saisit un message dans le champ texte du bloc journal. Un message long
  // s'affiche desormais en zone de texte : on accepte les deux formes.
  const textTyped = await cdp.evaluate(`(() => {
    const target = document.querySelector('.block-body textarea')
      ?? document.querySelector('.block-body input[type=text]');
    if (!target) return null;
    const proto = target.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(target, 'Debut du direct');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return target.value;
  })()`);
  check('la saisie de texte est prise', textTyped === 'Debut du direct', String(textTyped));
  await sleep(900);
  const withText = await cdp.evaluate('window.streamcontrol.macrosList()');
  const logText = withText[0]?.actions?.find((a) => a.kind === 'log');
  check('le texte est enregistre', logText?.text === 'Debut du direct', JSON.stringify(logText));

  // Et il reste visible dans le bloc (resume de l'en-tete).
  const summary = await cdp.evaluate('document.body.textContent');
  check('le texte apparait dans le bloc', summary.includes('Debut du direct'));

  // --- Blocs qui demandent un fichier ou un dossier -----------------------
  // Le defaut corrige : ces blocs n'offraient qu'un champ texte, ou l'utilisateur
  // devait recopier un chemin a la main. Ils proposent maintenant « Parcourir ».
  console.log('\n--- import de fichier et de dossier ---');

  const folderChosen = PICK_FOLDER;
  const soundChosen = PICK_SOUND;

  // Un bloc « Ouvrir un dossier » : le bouton « Parcourir » doit remplir le champ.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.palette-block')].find((x) => /Ouvrir un dossier/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(600);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[3]) b[3].click(); })()`);
  await sleep(500);

  const hasBrowse = await cdp.evaluate(
    `Boolean([...document.querySelectorAll('.block-body button')].find((x) => /Parcourir/i.test(x.textContent)))`,
  );
  check('le bloc dossier propose « Parcourir »', hasBrowse);

  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.block-body button')].find((x) => /Parcourir/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(900);

  const folderStored = await cdp.evaluate('window.streamcontrol.macrosList()');
  const folderAction = folderStored[0]?.actions?.find((a) => a.kind === 'open-folder');
  check('le dossier choisi est enregistre', folderAction?.text === folderChosen, JSON.stringify(folderAction));

  // Un bloc « Jouer un son » : fichier choisi, puis verifie qu'il est lisible.
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.palette-block')].find((x) => /Jouer un son/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(600);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[4]) b[4].click(); })()`);
  await sleep(500);

  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.block-body button')].find((x) => /Parcourir/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(900);

  const soundStored = await cdp.evaluate('window.streamcontrol.macrosList()');
  const soundAction = soundStored[0]?.actions?.find((a) => a.kind === 'sound');
  check('le fichier de son choisi est enregistre', soundAction?.soundPath === soundChosen, JSON.stringify(soundAction));

  // Le fichier de son est lisible : c'est ce que joue le bouton « Ecouter ».
  const readBack = await cdp.evaluate(
    `window.streamcontrol.macroReadSound(${JSON.stringify(soundChosen)})`,
  );
  check('le fichier de son est lisible', typeof readBack === 'string' && readBack.startsWith('data:audio/'), String(readBack).slice(0, 24));

  // Le bouton « Ecouter » est propose pour un fichier de son.
  const hasListen = await cdp.evaluate(
    `Boolean([...document.querySelectorAll('.block-body button')].find((x) => /Ecouter/i.test(x.textContent)))`,
  );
  check('le bouton « Ecouter » est propose', hasListen);

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
