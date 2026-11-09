/**
 * Verifie les variables de macro et les modeles.
 *
 * Deux fonctions : le bouton « {x} » colle aux champs ouvre une liste
 * recherchable et insere le jeton au curseur ; et les modeles creent une macro
 * complete en un clic. On exerce le vrai rendu et le vrai processus principal.
 */
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, waitFor, sleep } from './harness.mjs';

const DEBUG_PORT = 9432;
const USER_DATA = '/tmp/sc-e2e-macrovar';
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

  // --- 1. Les modeles sont proposes ---------------------------------------
  console.log('\n--- modeles ---');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /Voir les modeles/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(900);

  const templates = await cdp.evaluate(`(() => {
    const cards=[...document.querySelectorAll('.template-card')];
    return {
      count: cards.length,
      named: cards.filter((c) => (c.querySelector('.template-name')?.textContent ?? '').length > 3).length,
      metaOk: cards.filter((c) => /action\\(s\\)/.test(c.textContent) && /variable\\(s\\)/.test(c.textContent)).length
    };
  })()`);
  check('les modeles sont listes', templates.count >= 8, `${templates.count} modeles`);
  check('chaque modele porte un nom', templates.named === templates.count, `${templates.named}/${templates.count}`);
  check('chaque modele annonce ses actions et variables', templates.metaOk === templates.count, `${templates.metaOk}/${templates.count}`);

  // --- 2. Un modele cree une macro complete --------------------------------
  console.log('\n--- creation depuis un modele ---');
  const before = (await cdp.evaluate('window.streamcontrol.macrosList()')).length;
  await cdp.evaluate(`document.querySelector('.template-card .btn.primary')?.click()`);
  await sleep(1600);

  const created = await cdp.evaluate('window.streamcontrol.macrosList()');
  check('la macro est creee', created.length === before + 1, `${before} -> ${created.length}`);
  const macro = created[created.length - 1];
  check('le modele produit plusieurs actions', (macro?.actions?.length ?? 0) >= 5, `${macro?.actions?.length} actions`);
  check('le modele porte un nom lisible', /[a-z]/i.test(macro?.name ?? ''), macro?.name);
  // Le modele « ouverture » pose un declencheur a la connexion d'un flux.
  check('le modele pose son declencheur', Array.isArray(macro?.triggers) && macro.triggers.length > 0, JSON.stringify(macro?.triggers));

  // --- 3. Le bouton variable est present sur les champs -------------------
  console.log('\n--- bouton variable ---');
  const opened = await cdp.evaluate(`(() => {
    const toggles=[...document.querySelectorAll('.block-toggle')];
    const target = toggles.find((x) => /journal/i.test(x.textContent)) ?? toggles[0];
    if (!target) return false;
    target.click();
    return true;
  })()`);
  check('un bloc est ouvert', opened);
  await sleep(700);

  const buttons = await cdp.evaluate('document.querySelectorAll(".block-body .variable-button").length');
  check('le champ propose le bouton variable', buttons >= 1, `${buttons} bouton(s)`);

  // --- 4. La pop-up liste, recherche et insere ----------------------------
  console.log('\n--- pop-up des variables ---');
  await cdp.evaluate(`document.querySelector('.block-body .variable-button')?.click()`);
  await sleep(800);

  const dialog = await cdp.evaluate(`(() => {
    const rows=[...document.querySelectorAll('#variable-list .variable-row')];
    return {
      open: Boolean(document.querySelector('.variable-modal')),
      rows: rows.length,
      tokensOk: rows.every((r) => /^\\{[a-z0-9_]+\\}$/.test(r.querySelector('.variable-token')?.textContent ?? '')),
      groups: document.querySelectorAll('.variable-groups .chip').length,
      search: Boolean(document.getElementById('variable-search'))
    };
  })()`);
  check('la pop-up s ouvre', dialog.open);
  check('elle liste beaucoup de variables', dialog.rows >= 80, `${dialog.rows} variables`);
  check('chaque ligne montre son jeton', dialog.tokensOk);
  check('les familles sont proposees', dialog.groups >= 8, `${dialog.groups} familles`);
  check('un champ de recherche est present', dialog.search);

  // Recherche : « debit » doit reduire la liste.
  await cdp.evaluate(`(() => {
    const i=document.getElementById('variable-search');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(i,'debit'); i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(500);
  const searched = await cdp.evaluate(`(() => {
    const rows=[...document.querySelectorAll('#variable-list .variable-row')];
    return { rows: rows.length, tokens: rows.map((r) => r.querySelector('.variable-token').textContent) };
  })()`);
  check('la recherche filtre la liste', searched.rows > 0 && searched.rows < dialog.rows, `${searched.rows} resultats`);
  check('elle trouve les variables de debit', searched.tokens.some((tk) => tk.includes('flux_debit')), searched.tokens.join(' '));

  // Un filtre de famille restreint aussi la liste.
  await cdp.evaluate(`(() => {
    const i=document.getElementById('variable-search');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true}));
    const chip=[...document.querySelectorAll('.variable-groups .chip')].find((c) => /Date et heure/i.test(c.textContent));
    if (chip) chip.click();
  })()`);
  await sleep(500);
  const byGroup = await cdp.evaluate('document.querySelectorAll("#variable-list .variable-row").length');
  check('une famille filtre la liste', byGroup > 0 && byGroup < dialog.rows, `${byGroup} dans la famille`);

  // Insertion : on revient a toutes les variables, puis on insere.
  await cdp.evaluate(`(() => {
    const chip=[...document.querySelectorAll('.variable-groups .chip')].find((c) => /Toutes/i.test(c.textContent));
    if (chip) chip.click();
  })()`);
  await sleep(400);

  const beforeText = await cdp.evaluate(`document.querySelector('.block-body .variable-field .input')?.value ?? ''`);
  await cdp.evaluate(`(() => {
    const i=document.getElementById('variable-search');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(i,'date_fr'); i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(400);
  await cdp.evaluate(`document.querySelector('#variable-list .variable-row')?.click()`);
  await sleep(900);

  const afterInsert = await cdp.evaluate(`(() => ({
    closed: !document.querySelector('.variable-modal'),
    value: document.querySelector('.block-body .variable-field .input')?.value ?? ''
  }))()`);
  check('la pop-up se ferme apres le choix', afterInsert.closed);
  check('la variable est inseree dans le champ', afterInsert.value.includes('{date_fr}') && afterInsert.value !== beforeText, afterInsert.value.slice(-40));

  // Et elle est bien enregistree.
  const saved = await cdp.evaluate('window.streamcontrol.macrosList()');
  const stored = JSON.stringify(saved[saved.length - 1]?.actions ?? []);
  check('la variable est enregistree', stored.includes('{date_fr}'), stored.slice(0, 80));

  // --- 5. Les variables sont resolues a l'execution -----------------------
  console.log('\n--- resolution a l execution ---');
  // On remplace le contenu de la macro par un bloc qui ecrit une variable, puis
  // on l'execute : le journal doit contenir la valeur, pas le jeton.
  const target = saved[saved.length - 1];
  await cdp.evaluate(
    `window.streamcontrol.macroUpdate(${JSON.stringify(target.id)}, { actions: [{ kind: 'log', level: 'info', text: 'Marqueur {date_fr} et {app_version} et {poste_ip}.' }], triggers: [] })`,
  );
  await sleep(800);
  await cdp.evaluate(`window.streamcontrol.macroRun(${JSON.stringify(target.id)})`);
  await sleep(1500);

  const logs = await cdp.evaluate('window.streamcontrol.getLogs()');
  const line = logs.map((entry) => entry.message).find((m) => m.includes('Marqueur')) ?? '';
  check('la variable est remplacee a l execution', line.length > 0 && !line.includes('{date_fr}') && !line.includes('{app_version}'), line);
  check('la date est resolue', /Marqueur \d{2}\/\d{2}\/\d{4}/.test(line), line);
  check('la version est resolue', /2\.0\.0/.test(line), line);
  check('l adresse IP est resolue', /et \d+\.\d+\.\d+\.\d+/.test(line), line);

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
