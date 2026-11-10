/**
 * Verifie les conditions avancees, les champs larges et les variables de flux.
 *
 * Quatre demandes :
 * 1. les champs longs s'affichent sur plusieurs lignes, avec une limite de
 *    caracteres propre a la fonction du champ ;
 * 2. les variables de flux existent aussi pour une adresse precise
 *    (`{flux_nom_<identifiant>}`), choisie dans la pop-up ;
 * 3. le bloc « condition » compare deux valeurs, avec les operateurs attendus ;
 * 4. le bloc « condition » sait ignorer le bloc ou arreter la macro quand le
 *    test est faux, et continuer ou non apres lui.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9436;
const USER_DATA = '/tmp/sc-e2e-macrocond';
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

  // Une adresse, pour alimenter le selecteur de flux de la pop-up.
  await cdp.evaluate(`window.streamcontrol.streamCreate({ name: 'Camera scene', path: 'studio/cam1' }).then(() => null)`);
  await sleep(900);

  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find((x) => /Automatisation/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(900);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /Nouvelle macro/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(1200);
  const macroId = await cdp.evaluate('window.streamcontrol.macrosList().then((l) => l[l.length - 1].id)');

  // --- 1. Le bloc « condition » offre la comparaison complete -------------
  console.log('\n--- bloc condition ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.palette-block')].find((x) => x.textContent.trim() === 'Condition'); if (b) b.click(); })()`);
  await sleep(700);
  await cdp.evaluate(`document.querySelector('.block-toggle')?.click()`);
  await sleep(600);

  const condition = await cdp.evaluate(`(() => {
    const labels=[...document.querySelectorAll('.block-body .field > label')].map((x) => x.textContent.trim());
    const selects=[...document.querySelectorAll('.block-body select')];
    const operators = selects.find((s) => [...s.options].some((o) => /egal a/.test(o.text)));
    const elseChoice = selects.find((s) => [...s.options].some((o) => /Ignorer ce bloc/.test(o.text)));
    return {
      labels,
      operators: operators ? [...operators.options].map((o) => o.text) : [],
      elseChoices: elseChoice ? [...elseChoice.options].map((o) => o.text) : [],
      hasContinueBox: Boolean(document.querySelector('.block-body input[type=checkbox]')),
      variableButtons: document.querySelectorAll('.block-body .variable-button').length
    };
  })()`);
  check('le bloc condition compare deux valeurs', condition.labels.some((l) => /^Si$/.test(l)), condition.labels.join(' | '));
  check('il propose de nombreuses comparaisons', condition.operators.length >= 10, `${condition.operators.length} comparaisons`);
  check('il propose « contient » et « plus petit que »', condition.operators.some((o) => /contient/.test(o)) && condition.operators.some((o) => /plus petit/.test(o)));
  check('il propose ignorer ou arreter', condition.elseChoices.length === 2, condition.elseChoices.join(' | '));
  check('il propose de continuer apres le bloc', condition.hasContinueBox);
  check('ses champs portent le bouton variable', condition.variableButtons >= 2, `${condition.variableButtons} boutons`);

  // --- 2. Les champs longs sont multilignes et limites --------------------
  console.log('\n--- champs larges ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.palette-block')].find((x) => /Ecrire au journal/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(700);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[1]) b[1].click(); })()`);
  await sleep(600);
  const logFields = await cdp.evaluate(`(() => {
    const ta=[...document.querySelectorAll('.block-body textarea')];
    return {
      textareas: ta.length,
      maxLength: ta[0]?.maxLength ?? 0,
      rows: ta[0]?.rows ?? 0,
      variableButtons: document.querySelectorAll('.block-body .variable-button').length
    };
  })()`);
  check('le message du journal est multiligne', logFields.textareas >= 1 && logFields.rows >= 2, `${logFields.textareas} zone(s), ${logFields.rows} lignes`);
  check('il annonce une limite de caracteres', logFields.maxLength >= 500, String(logFields.maxLength));

  // Un nom court a une limite plus stricte.
  const limits = await cdp.evaluate(`(() => {
    const blocks = window.__macroBlocks ?? null;
    return null;
  })()`);
  void limits;
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.palette-block')].find((x) => /Creer une scene/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(700);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.block-toggle')]; if (b[2]) b[2].click(); })()`);
  await sleep(600);
  const nameLimit = await cdp.evaluate(`(() => {
    const inputs=[...document.querySelectorAll('.block-body input[type=text]')];
    return inputs.length ? inputs[inputs.length - 1].maxLength : 0;
  })()`);
  check('un nom court est plus limite qu un message', nameLimit > 0 && nameLimit < logFields.maxLength, `${nameLimit} vs ${logFields.maxLength}`);

  // --- 3. Le selecteur de flux fabrique un jeton par flux -----------------
  console.log('\n--- variables de flux ---');
  await cdp.evaluate(`document.querySelector('.block-body .variable-button')?.click()`);
  await sleep(800);
  const dialog = await cdp.evaluate(`(() => {
    const sel=document.getElementById('variable-stream');
    return {
      open: Boolean(document.querySelector('.variable-modal')),
      hasStreamSelect: Boolean(sel),
      options: sel ? [...sel.options].map((o) => o.text) : [],
      firstToken: document.querySelector('#variable-list .variable-token')?.textContent ?? ''
    };
  })()`);
  check('la pop-up propose de choisir un flux', dialog.open && dialog.hasStreamSelect);
  check('elle liste les adresses connues', dialog.options.some((o) => /Camera scene/.test(o)), dialog.options.join(' | '));
  check('sans choix, le jeton parle du flux courant', dialog.firstToken === '{flux_nom}', dialog.firstToken);

  await cdp.evaluate(`(() => {
    const sel=document.getElementById('variable-stream');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    setter.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(600);
  const perStream = await cdp.evaluate(`document.querySelector('#variable-list .variable-token')?.textContent ?? ''`);
  check('avec un flux choisi, le jeton porte son identifiant', /^\{flux_nom_[a-z0-9]+\}$/.test(perStream), perStream);

  // On insere et on verifie que la variable est bien resolue a l'execution.
  await cdp.evaluate(`document.querySelector('#variable-list .variable-row')?.click()`);
  await sleep(900);
  // Tous les champs texte ouverts : on verifie que l'un d'eux porte le jeton.
  const inserted = await cdp.evaluate(`(() => {
    const fields=[...document.querySelectorAll('.block-body textarea, .block-body .variable-field .input')];
    return fields.map((f) => f.value).join(' | ');
  })()`);
  check('le jeton par flux est insere', /\{flux_nom_[a-z0-9]+\}/.test(inserted), inserted.slice(0, 80));

  // --- 4. Le moteur applique les conditions -------------------------------
  console.log('\n--- execution des conditions ---');
  const streamId = await cdp.evaluate(`window.streamcontrol.streamsList().then((l) => (l.find((s) => /Camera/.test(s.name)) ?? l[0]).id)`);

  // Condition vraie, sans continuer : la macro s'arrete apres le bloc.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'log', level: 'info', text: 'avant' },
    { kind: 'condition', conditionLeft: '{nombre_flux}', conditionOperator: 'more-than', conditionRight: '0',
      conditionContinue: false,
      actions: [{ kind: 'log', level: 'info', text: 'dans la condition' }] },
    { kind: 'log', level: 'info', text: 'apres' }
  ], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  await sleep(1600);
  let logs = (await cdp.evaluate('window.streamcontrol.getLogs()')).map((e) => e.message);
  check('la condition vraie execute son contenu', logs.includes('dans la condition'));
  check('sans continuer, la macro s arrete apres le bloc', !logs.includes('apres'), logs.filter((m) => ['avant','apres'].includes(m)).join(' | '));

  // Condition fausse avec « arreter » : la macro s'arrete.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'condition', conditionLeft: 'a', conditionOperator: 'equal', conditionRight: 'b',
      conditionOnFalse: 'stop',
      actions: [{ kind: 'log', level: 'info', text: 'jamais' }] },
    { kind: 'log', level: 'info', text: 'apres refus' }
  ], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  await sleep(1600);
  logs = (await cdp.evaluate('window.streamcontrol.getLogs()')).map((e) => e.message);
  check('condition fausse avec arret : rien ne suit', !logs.includes('apres refus') && !logs.includes('jamais'));

  // Condition fausse avec « ignorer » : la suite part.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'condition', conditionLeft: 'a', conditionOperator: 'equal', conditionRight: 'b',
      conditionOnFalse: 'skip',
      actions: [{ kind: 'log', level: 'info', text: 'jamais' }] },
    { kind: 'log', level: 'info', text: 'suite ignoree puis continue' }
  ], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  await sleep(1600);
  logs = (await cdp.evaluate('window.streamcontrol.getLogs()')).map((e) => e.message);
  check('condition fausse ignoree : la suite part', logs.includes('suite ignoree puis continue'));

  // Condition vraie sur une variable de flux designe : le nom est resolu.
  await cdp.evaluate(`window.streamcontrol.macroUpdate(${JSON.stringify(macroId)}, { actions: [
    { kind: 'condition', conditionLeft: '{flux_nom_${streamId}}', conditionOperator: 'contains', conditionRight: 'Camera',
      conditionContinue: true,
      actions: [{ kind: 'log', level: 'info', text: 'le flux designe repond' }] }
  ], triggers: [] })`);
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(macroId)})`);
  await sleep(1600);
  logs = (await cdp.evaluate('window.streamcontrol.getLogs()')).map((e) => e.message);
  check('une variable de flux designe se resout', logs.includes('le flux designe repond'), logs.slice(0, 4).join(' | '));

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
