/**
 * Tests des modules sans dependance Electron : construction des URL,
 * detection reseau et journalisation. Executes sur le code compile
 * (dist-electron) pour tester le meme chemin que l'application.
 *
 * Lancement : npm run build:electron && npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { buildStreamUrls, rootStreamPath, buildObsIngestHint } = require('../dist-electron/main/urls.js');
const { layoutCells } = require('../dist-electron/main/obs-controller.js');
const { getNetworkInfo, isPortInUse } = require('../dist-electron/main/network.js');
const { Logger } = require('../dist-electron/main/logger.js');

const settings = {
  version: 1,
  network: { overrideIPv4: '' },
  mediamtx: {
    binaryPath: '',
    configPath: '',
    rtmpPort: 1935,
    hlsPort: 8888,
    webrtcPort: 8889,
    rtspPort: 8554,
    streamPath: 'live',
    autoStart: false,
    autoRestart: true,
  },
  obs: { host: '127.0.0.1', port: 4455, password: '', autoConnect: false },
  obsExecutablePath: '',
  ui: { refreshIntervalMs: 5000, maxLogLines: 2000 },
};

test('rootStreamPath extrait le premier segment', () => {
  assert.equal(rootStreamPath('live'), 'live');
  assert.equal(rootStreamPath('/live/cam1'), 'live');
  assert.equal(rootStreamPath('studio/feed'), 'studio');
  assert.equal(rootStreamPath(''), 'live');
});

test('les URL sont construites sur l IPv4 detectee', () => {
  const network = { primaryIPv4: '192.168.1.42', allIPv4: ['192.168.1.42'], hostname: 'pc' };
  const urls = buildStreamUrls(settings, network);

  assert.equal(urls.rtmpIngest, 'rtmp://192.168.1.42:1935/live');
  assert.equal(urls.hls, 'http://192.168.1.42:8888/live/index.m3u8');
  assert.equal(urls.webrtc, 'http://192.168.1.42:8889/live');
  assert.equal(urls.rtsp, 'rtsp://192.168.1.42:8554/live');
  assert.equal(urls.srtIngest, 'srt://192.168.1.42:8890?streamid=publish:live');
  assert.equal(urls.streamKey, 'live');
});

test('les ports personnalises sont respectes', () => {
  const custom = {
    ...settings,
    mediamtx: { ...settings.mediamtx, rtmpPort: 19350, hlsPort: 8880, streamPath: 'studio/cam1' },
  };
  const urls = buildStreamUrls(custom, { primaryIPv4: '10.0.0.5', allIPv4: [], hostname: 'pc' });
  assert.equal(urls.rtmpIngest, 'rtmp://10.0.0.5:19350/studio/cam1');
  assert.equal(urls.hls, 'http://10.0.0.5:8880/studio/cam1/index.m3u8');
});

test('sans IPv4 detectee, on retombe sur la boucle locale', () => {
  const urls = buildStreamUrls(settings, { primaryIPv4: null, allIPv4: [], hostname: 'pc' });
  assert.equal(urls.rtmpIngest, 'rtmp://127.0.0.1:1935/live');
});

test('buildObsIngestHint cible la racine du chemin', () => {
  const hint = buildObsIngestHint(settings, { primaryIPv4: '192.168.1.42', allIPv4: [], hostname: 'pc' });
  assert.match(hint, /rtmp:\/\/192\.168\.1\.42:1935\/live/);
});

test('getNetworkInfo respecte l override valide et ignore l invalide', () => {
  const forced = getNetworkInfo('192.168.50.10');
  assert.equal(forced.primaryIPv4, '192.168.50.10');

  const invalid = getNetworkInfo('pas-une-ip');
  assert.notEqual(invalid.primaryIPv4, 'pas-une-ip');
});

test('isPortInUse detecte un port reellement occupe', async () => {
  const net = await import('node:net');
  const server = net.createServer();
  // On occupe l'adresse generique, comme le fait MediaMTX. Sous Windows, un
  // bind sur 127.0.0.1 ne bloque pas un bind ulterieur sur 0.0.0.0 : tester
  // l'adresse specifique ne refleterait pas le scenario reel.
  await new Promise((resolve) => server.listen({ port: 0, host: '0.0.0.0', exclusive: true }, resolve));
  const port = server.address().port;

  assert.equal(await isPortInUse(port), true);

  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isPortInUse(port), false);
});

test('le logger conserve les entrees et applique la limite', () => {
  const logger = new Logger({ maxEntries: 3 });
  const received = [];
  logger.on('entry', (entry) => received.push(entry));

  for (let index = 1; index <= 5; index += 1) {
    logger.info('test', `ligne ${index}`);
  }

  const entries = logger.getEntries();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].message, 'ligne 3');
  assert.equal(entries[2].message, 'ligne 5');
  assert.equal(received.length, 5);

  logger.clear();
  assert.equal(logger.getEntries().length, 0);
});

test('le logger filtre les niveaux sous le seuil', () => {
  const logger = new Logger({ minLevel: 'warn' });
  logger.debug('test', 'invisible');
  logger.info('test', 'invisible');
  logger.warn('test', 'visible');
  logger.error('test', 'visible');

  const entries = logger.getEntries();
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.level),
    ['warn', 'error'],
  );
});

/**
 * L'application ne doit RIEN modifier au pare-feu.
 *
 * Un programme non signe qui cree des regles de pare-feu, surtout en lancant
 * PowerShell avec une commande encodee, est le comportement typique d'un
 * logiciel malveillant : les antivirus le bloquent et ferment l'application.
 * Ce test lit le code compile et refuse toute reapparition de ces commandes.
 */
test('le code compile ne modifie pas le pare-feu', () => {
  const files = [
    '../dist-electron/main/firewall.js',
    '../dist-electron/main/main.js',
    '../dist-electron/main/ipc.js',
    '../dist-electron/main/network.js',
  ];

  // Les motifs qui declenchent une alerte antivirus.
  const forbidden = [
    'New-NetFirewallRule',
    'Remove-NetFirewallRule',
    'Set-NetFirewall',
    'netsh advfirewall',
    'EncodedCommand',
    'ExecutionPolicy',
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const pattern of forbidden) {
      assert.ok(
        !source.includes(pattern),
        `${file} contient "${pattern}" : une alerte antivirus est probable`,
      );
    }
  }
});

test('la grille de scene repartit 1 a 4 flux sans trou', () => {
  const one = layoutCells(1, 1920, 1080);
  assert.deepEqual(one, [{ x: 0, y: 0, width: 1920, height: 1080 }]);

  const two = layoutCells(2, 1920, 1080);
  assert.equal(two.length, 2);
  assert.equal(two[0].x, 0);
  assert.equal(two[1].x, 960);
  assert.equal(two[0].width + two[1].width, 1920);

  const three = layoutCells(3, 1920, 1080);
  assert.equal(three.length, 3);
  assert.equal(three[2].y, 540);
  assert.equal(three[2].width, 1920, 'le troisieme occupe toute la largeur en bas');

  const four = layoutCells(4, 1920, 1080);
  assert.equal(four.length, 4);
  assert.deepEqual(
    four.map((cell) => [cell.x, cell.y]),
    [[0, 0], [960, 0], [0, 540], [960, 540]],
  );

  // Les cellules couvrent tout le canevas, sans trou ni debordement.
  for (const cell of four) {
    assert.ok(cell.x >= 0 && cell.y >= 0);
    assert.ok(cell.x + cell.width <= 1920);
    assert.ok(cell.y + cell.height <= 1080);
  }
});

test('deux adresses ne peuvent pas porter le meme nom', () => {
  const { StreamRegistry } = require('../dist-electron/main/stream-registry.js');
  const registry = new StreamRegistry();
  registry.create({ name: 'Cam', path: 'cam1' });
  // Meme nom, chemin different : refuse.
  assert.throws(() => registry.create({ name: 'Cam', path: 'cam2' }), /nom .* deja utilise/i);
  // La casse ne compte pas : « cam » est le meme nom.
  assert.throws(() => registry.create({ name: 'cam', path: 'cam3' }), /nom .* deja utilise/i);
  // Un autre nom passe.
  const other = registry.create({ name: 'Cam 2', path: 'cam2' });
  assert.equal(other.name, 'Cam 2');
  // Le renommage suit la meme regle.
  assert.throws(() => registry.update(other.id, { name: 'Cam' }), /nom .* deja utilise/i);
  // Se renommer soi-meme reste possible.
  assert.equal(registry.update(other.id, { name: 'Cam 2' }).name, 'Cam 2');
});

/**
 * Les chaines francaises doivent garder leurs apostrophes.
 *
 * Un traitement anterieur a supprime l'apostrophe des elisions (« Demande d
 * acces » au lieu de « Demande d'acces »). Ce test relit le catalogue de
 * traduction compile et refuse la reapparition du motif : un mot qui s'elide
 * (d, l, n, s, j, c, m, t, qu...) suivi d'une espace au lieu d'une apostrophe.
 */
test('les traductions francaises gardent leurs apostrophes', () => {
  const source = readFileSync(new URL('../src/shared/i18n.ts', import.meta.url), 'utf8');
  const lines = source.split('\n');

  // La table francaise va de `const fr = {` a sa fermeture.
  const start = lines.findIndex((line) => line.startsWith('const fr = {'));
  const end = lines.findIndex((line, index) => index > start && line.startsWith('} as const;'));
  assert.ok(start >= 0 && end > start, 'la table francaise doit etre localisee');

  const elisions = ['d', 'l', 'n', 's', 'j', 'c', 'm', 't', 'qu', 'jusqu', 'lorsqu', 'presqu', 'quelqu'];
  const vowels = 'aeiouyàâäéèêëîïôöùûühAEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜH';
  const offenders = [];

  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    // On ne regarde que le contenu d'une chaine francaise.
    const value = /:\s*(['"])(.*)\1,?\s*$/.exec(line.trim());
    if (!value) continue;
    const text = value[2];
    for (const word of elisions) {
      const pattern = new RegExp(`(^|[^\\w'\u2019])${word} [${vowels}]`);
      if (pattern.test(text)) offenders.push(`${line.trim()}  (${word} + espace)`);
    }
  }

  assert.deepEqual(offenders, [], `apostrophe manquante :\n${offenders.join('\n')}`);
});

/**
 * Chaque libelle du catalogue de blocs doit exister dans les deux langues.
 *
 * Six blocs pointaient vers une cle ecrite en camelCase (`macro.kind.startStream`)
 * alors que la traduction existait en forme tiret (`macro.kind.start-stream`) :
 * la palette affichait donc la cle technique a la place du libelle. Ce test
 * relit le catalogue et la table de traduction, et refuse toute cle manquante.
 */
test('chaque libelle du catalogue de blocs a sa traduction', () => {
  const { BLOCKS, BLOCK_GROUPS, MACRO_CONDITIONS } = require('../dist-electron/shared/macro-blocks.js');
  const i18n = readFileSync(new URL('../src/shared/i18n.ts', import.meta.url), 'utf8');
  const lines = i18n.split('\n');

  const collect = (marker) => {
    const start = lines.findIndex((line) => line.startsWith(marker));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('} as const;'));
    return new Set(
      [...lines.slice(start, end).join('\n').matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]),
    );
  };
  const fr = collect('const fr = {');
  const en = collect('const en: Record<TranslationKey, string> = {');

  const references = new Set();
  for (const block of BLOCKS) {
    references.add(block.label);
    for (const field of block.fields) {
      references.add(field.label);
      if (field.hint) references.add(field.hint);
    }
  }
  for (const group of BLOCK_GROUPS) references.add(group.label);
  for (const condition of MACRO_CONDITIONS) references.add(condition.label);

  const missingFr = [...references].filter((key) => !fr.has(key)).sort();
  const missingEn = [...references].filter((key) => !en.has(key)).sort();
  assert.deepEqual(missingFr, [], `cle francaise manquante : ${missingFr.join(', ')}`);
  assert.deepEqual(missingEn, [], `cle anglaise manquante : ${missingEn.join(', ')}`);
});

/**
 * Les champs « fichier » et « dossier » sont conserves par la validation.
 *
 * Le bug d'origine : une liste de champs ecrite a la main oubliait les nouveaux
 * et les faisait disparaitre a l'enregistrement. La validation suit desormais le
 * catalogue : ce test verifie qu'un chemin de son et un chemin de dossier
 * survivent a `sanitizeMacroActions`.
 */
test('les champs fichier et dossier des blocs survivent a la validation', () => {
  const { sanitizeMacroActions } = require('../dist-electron/shared/macro-sanitize.js');
  const { BLOCKS } = require('../dist-electron/shared/macro-blocks.js');

  const soundBlock = BLOCKS.find((block) => block.kind === 'sound');
  const folderBlock = BLOCKS.find((block) => block.kind === 'open-folder');
  assert.equal(soundBlock.fields[0].kind, 'file', 'le bloc son attend un fichier');
  assert.equal(folderBlock.fields[0].kind, 'folder', 'le bloc dossier attend un dossier');

  const cleaned = sanitizeMacroActions([
    { kind: 'sound', soundPath: '/tmp/alerte.wav' },
    { kind: 'open-folder', text: '/tmp/enregistrements' },
  ]);
  assert.equal(cleaned[0].soundPath, '/tmp/alerte.wav');
  assert.equal(cleaned[1].text, '/tmp/enregistrements');
});


/**
 * Les variables de macro doivent se resoudre avec les donnees du moment.
 *
 * Le defaut corrige : `expandVariables` n'etait jamais appele, et ne connaissait
 * que `{date}` et `{heure}`. Aujourd'hui, chaque champ texte d'une action est
 * relu juste avant son execution.
 */
test('les variables de macro sont remplacees par la valeur du moment', () => {
  const { buildVariableMap, expandText, expandAction, formatDuration } = require('../dist-electron/shared/macro-resolve.js');

  const values = buildVariableMap({
    flux: {
      id: 'abc',
      name: 'Camera scene',
      path: 'studio/cam1',
      live: true,
      width: 1920,
      height: 1080,
      bitrateKbps: 3000,
      hasAudio: true,
    },
    streams: [
      { id: 'a', name: 'Camera scene', path: 'studio/cam1', live: true },
      { id: 'b', name: 'Retour', path: 'studio/retour', live: false },
    ],
    obs: { connected: true, currentScene: 'Programme', scenes: ['Generique', 'Programme'], sources: ['Micro'] },
    now: new Date('2026-10-29T14:05:33'),
  });

  assert.equal(values.flux_nom, 'Camera scene');
  assert.equal(values.flux_chemin, 'studio/cam1');
  assert.equal(values.flux_resolution, '1920x1080');
  assert.equal(values.flux_debit, '3000');
  assert.equal(values.flux_debit_mbps, '3.0');
  assert.equal(values.flux_live, 'True');
  assert.equal(values.obs_scene, 'Programme');
  assert.equal(values.liste_scenes, 'Generique, Programme');
  assert.equal(values.nombre_flux, '2');
  assert.equal(values.nombre_flux_live, '1');
  assert.equal(values.liste_flux_hors_ligne, 'Retour');
  assert.equal(values.date, '2026-10-29');
  assert.equal(values.heure_courte, '14:05');

  // Un alias anglais donne le meme resultat que le jeton francais.
  assert.equal(values.current_flux_name, 'Camera scene');

  // Un flux designe par son identifiant : {flux_nom_<id>}.
  assert.equal(values.flux_nom_b, 'Retour');
  assert.equal(values.stream_name_b, 'Retour');
  assert.equal(values.flux_live_b, 'False');
  assert.equal(values.flux_chemin_b, 'studio/retour');

  // Le texte est remplace, y compris plusieurs variables d'affilee.
  assert.equal(
    expandText('Direct de {flux_nom} sur {obs_scene} a {heure_courte}.', values),
    'Direct de Camera scene sur Programme a 14:05.',
  );

  // Un jeton inconnu reste visible : rien n'est perdu en silence.
  assert.equal(expandText('Valeur : {inconnu}', values), 'Valeur : {inconnu}');

  // Le remplacement descend dans les blocs imbriques.
  const expanded = expandAction(
    { kind: 'repeat', repeat: 2, text: '{flux_nom}', actions: [{ kind: 'log', text: '{obs_scene}' }] },
    values,
  );
  assert.equal(expanded.text, 'Camera scene');
  assert.equal(expanded.actions[0].text, 'Programme');

  // Duree lisible, pour `{flux_duree}`.
  assert.equal(formatDuration(2_537_000), '00:42:17');
  assert.equal(formatDuration(0), '00:00:00');
});

/** Les modeles doivent etre construits et utilisables tels quels. */
test('les modeles de macro se construisent sans erreur', () => {
  const { MACRO_TEMPLATES } = require('../dist-electron/shared/macro-templates.js');
  const { BLOCKS } = require('../dist-electron/shared/macro-blocks.js');
  const { unknownVariables } = require('../dist-electron/shared/macro-variables.js');
  const { sanitizeMacroActions } = require('../dist-electron/shared/macro-sanitize.js');

  const known = new Set(BLOCKS.map((block) => block.kind));
  assert.ok(MACRO_TEMPLATES.length >= 8, `${MACRO_TEMPLATES.length} modeles attendus`);

  for (const template of MACRO_TEMPLATES) {
    const actions = template.build({
      streams: [{ id: 'a', name: 'Camera scene', path: 'studio/cam1' }],
      scenes: ['Generique', 'Programme'],
    });
    assert.ok(actions.length > 0, `${template.id} doit produire des actions`);

    // Chaque action du modele doit exister dans le catalogue.
    const walk = (list, depth = 0) => {
      for (const action of list) {
        assert.ok(known.has(action.kind), `${template.id} : bloc inconnu « ${action.kind} »`);
        assert.ok(unknownVariables(JSON.stringify(action)).length === 0, `${template.id} : variable inconnue`);
        if (action.actions) walk(action.actions, depth + 1);
      }
    };
    walk(actions);

    // Et le modele doit survivre a la validation, sans perdre d'action.
    const cleaned = sanitizeMacroActions(actions);
    assert.equal(cleaned.length, actions.length, `${template.id} : actions perdues a la validation`);
  }
});

/**
 * Les comparaisons du bloc « condition ».
 *
 * Le defaut corrige : le bloc ne savait tester que des etats predefinis. Il
 * compare desormais deux valeurs, avec les operateurs attendus, et les
 * comparaisons de nombre convertissent les operandes.
 */
test('les comparaisons de condition sont correctes', () => {
  const { compareValues, evaluateComparison } = require('../dist-electron/shared/macro-resolve.js');

  assert.equal(compareValues('abc', 'equal', 'abc'), true);
  assert.equal(compareValues('ABC', 'equal', 'abc'), true, 'la casse ne compte pas');
  assert.equal(compareValues('abc', 'not-equal', 'abd'), true);
  assert.equal(compareValues('camera scene', 'contains', 'scene'), true);
  assert.equal(compareValues('camera scene', 'not-contains', 'micro'), true);
  assert.equal(compareValues('studio/cam1', 'starts-with', 'studio'), true);
  assert.equal(compareValues('studio/cam1', 'ends-with', 'cam1'), true);
  assert.equal(compareValues('', 'is-empty', ''), true);
  assert.equal(compareValues('x', 'is-not-empty', ''), true);

  // Comparaisons de nombre : « 900 » est plus petit que « 1200 ».
  assert.equal(compareValues('900', 'less-than', '1200'), true);
  assert.equal(compareValues('1200', 'less-than', '900'), false);
  assert.equal(compareValues('3000', 'more-than', '900'), true);
  // Deux valeurs non numeriques ne se comparent pas en taille.
  assert.equal(compareValues('abc', 'less-than', 'def'), false);

  // Un booleen se compare a True / False.
  assert.equal(compareValues('True', 'equal', 'true'), true);
  assert.equal(compareValues('False', 'not-equal', 'true'), true);

  // Le test complet resout les variables avant de comparer.
  const values = { flux_debit: '750', flux_live: 'True' };
  assert.equal(
    evaluateComparison(
      { kind: 'condition', conditionLeft: '{flux_debit}', conditionOperator: 'less-than', conditionRight: '900' },
      values,
      () => false,
    ),
    true,
  );
  assert.equal(
    evaluateComparison(
      { kind: 'condition', conditionLeft: '{flux_live}', conditionOperator: 'equal', conditionRight: 'True' },
      values,
      () => false,
    ),
    true,
  );
  // Sans comparaison libre, on retombe sur l'etat predefini.
  assert.equal(
    evaluateComparison({ kind: 'condition', condition: 'obs-connected' }, {}, (state) => state === 'obs-connected'),
    true,
  );
});

/**
 * Le catalogue de variables doit rester coherent.
 *
 * Chaque variable declare ses portees, ses exemples sont traduisibles, et les
 * variables de flux acceptent la forme designee `{flux_nom_<identifiant>}`.
 */
test('le catalogue de variables est coherent', () => {
  const {
    MACRO_VARIABLES,
    variableFor,
    streamIdFromToken,
    variableMatchesScope,
  } = require('../dist-electron/shared/macro-variables.js');
  const { buildVariableMap } = require('../dist-electron/shared/macro-resolve.js');

  // Chaque variable a un exemple, et un libelle traduit dans les deux langues.
  const i18n = readFileSync(new URL('../src/shared/i18n.ts', import.meta.url), 'utf8');
  const lines = i18n.split('\n');
  const collect = (marker) => {
    const start = lines.findIndex((line) => line.startsWith(marker));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('} as const;'));
    return new Set([...lines.slice(start, end).join('\n').matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
  };
  const fr = collect('const fr = {');
  const en = collect('const en: Record<TranslationKey, string> = {');
  const missing = [];
  for (const variable of MACRO_VARIABLES) {
    if (!variable.sample) missing.push(`exemple:${variable.token}`);
    if (!fr.has(`var.${variable.token}`)) missing.push(`fr:${variable.token}`);
    if (!en.has(`var.${variable.token}`)) missing.push(`en:${variable.token}`);
    if (!fr.has(`var.${variable.token}.desc`)) missing.push(`fr-desc:${variable.token}`);
    if (!en.has(`var.${variable.token}.desc`)) missing.push(`en-desc:${variable.token}`);
  }
  assert.deepEqual(missing, [], `traductions ou exemples manquants : ${missing.join(', ')}`);

  // Les jetons sont neutres : les deux formes francaises et anglaises marchent.
  assert.ok(variableFor('flux_nom'));
  assert.ok(variableFor('stream_name'), 'un alias anglais doit resoudre');
  assert.ok(variableFor('nom_du_flux'), 'un alias francais doit resoudre');
  assert.ok(variableFor('flux_nom_ab12'), 'la forme designee doit resoudre');

  // L'identifiant d'un jeton designe est rendu.
  assert.equal(streamIdFromToken('flux_nom_ab12'), 'ab12');
  assert.equal(streamIdFromToken('flux_nom'), null);
  assert.equal(streamIdFromToken('date'), null);

  // Une variable de flux est proposee dans le contexte de flux, pas ailleurs.
  const fluxNom = variableFor('flux_nom');
  assert.equal(variableMatchesScope(fluxNom, 'stream'), true);
  assert.equal(variableMatchesScope(fluxNom, 'alert'), true);
  const alerteType = variableFor('alerte_type');
  assert.equal(variableMatchesScope(alerteType, 'alert'), true);
  assert.equal(variableMatchesScope(alerteType, 'startup'), false, 'une variable d alerte ne vaut pas au demarrage');

  // Les booleens sortent en True / False, jamais en oui / non.
  const values = buildVariableMap({
    obs: { connected: true, recording: false },
    mediamtx: { running: false },
    poste: { locked: false },
    now: new Date('2026-01-01T00:00:00'),
  });
  assert.equal(values.obs_connecte, 'True');
  assert.equal(values.obs_enregistrement, 'False');
  assert.equal(values.mediamtx_actif, 'False');
  assert.equal(values.poste_verrouille, 'False');
});

/**
 * Les limites de saisie suivent la fonction du champ.
 *
 * Un nom de scene reste court, un message peut etre long : la limite evite une
 * saisie qui serait refusee plus tard.
 */
test('les champs de bloc declarent leurs limites', () => {
  const { BLOCKS, FIELD_LIMITS } = require('../dist-electron/shared/macro-blocks.js');

  const byKind = (kind) => BLOCKS.find((block) => block.kind === kind);
  // Le message du journal accepte un texte long, et s'affiche sur plusieurs lignes.
  const logField = byKind('log').fields.find((field) => field.key === 'text');
  assert.equal(logField.maxLength, FIELD_LIMITS.message);
  assert.equal(logField.multiline, true);

  // Un nom de scene reste court.
  const sceneField = byKind('create-scene').fields.find((field) => field.key === 'text');
  assert.equal(sceneField.maxLength, FIELD_LIMITS.name);

  // Un chemin est plus permissif qu'un nom.
  assert.ok(FIELD_LIMITS.path > FIELD_LIMITS.name);

  // Le bloc condition expose la comparaison complete.
  const condition = byKind('condition');
  const keys = condition.fields.map((field) => field.key);
  assert.deepEqual(
    keys,
    ['conditionLeft', 'conditionOperator', 'conditionRight', 'condition', 'conditionOnFalse', 'conditionContinue'],
  );
  const elseField = condition.fields.find((field) => field.key === 'conditionOnFalse');
  assert.equal(elseField.choices.length, 2, 'ignorer ou arreter');
  assert.equal(condition.fields.find((field) => field.key === 'conditionContinue').default, true);
});

/**
 * Le panneau distant distingue le telephone de l'ordinateur.
 *
 * Les deux n'ont pas la meme interface : le telephone affiche de grands
 * boutons, l'ordinateur la vue complete des flux avec l'enregistrement dans le
 * navigateur. Ce choix se fait sur l'en-tete User-Agent, cote serveur.
 */
test('la nature de l appareil est deduite du navigateur', () => {
  const { describeDeviceKind } = require('../dist-electron/main/remote.js');

  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const androidPhone =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';
  const androidTablet =
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
  const windows =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

  assert.equal(describeDeviceKind(iphone), 'phone');
  assert.equal(describeDeviceKind(androidPhone), 'phone');
  assert.equal(describeDeviceKind(androidTablet), 'desktop', 'une tablette n est pas un telephone');
  assert.equal(describeDeviceKind(windows), 'desktop');
  assert.equal(describeDeviceKind(mac), 'desktop');
  assert.equal(describeDeviceKind(undefined), 'desktop', 'sans en-tete, on ne suppose pas un telephone');
});

/**
 * Les autorisations du Remote retombent toutes sur `false`.
 *
 * Un reglage corrompu ou partiel ne doit jamais ouvrir un droit par accident :
 * seul un booleen `true` explicite accorde l'autorisation.
 */
test('les autorisations du Remote refusent tout par defaut', () => {
  const { sanitizeRemotePermissions } = require('../dist-electron/main/settings.js');

  const empty = sanitizeRemotePermissions(undefined);
  assert.deepEqual(empty, {
    scenes: false,
    recording: false,
    download: false,
    macros: false,
    controls: false,
  });

  const partial = sanitizeRemotePermissions({ scenes: true, macros: 'oui' });
  assert.equal(partial.scenes, true);
  assert.equal(partial.macros, false, 'une valeur non booleenne est refusee');
  assert.equal(partial.controls, false);
});

/**
 * Les appareils et les autorisations survivent a la validation des reglages.
 *
 * Le defaut vise : un nouveau champ oublie dans la validation disparait a
 * l'enregistrement, et la fonctionnalite devient silencieusement inoperante.
 */
test('les reglages du Remote survivent a la validation', () => {
  const { sanitizeSettings, defaultSettings } = require('../dist-electron/main/settings.js');

  const base = defaultSettings();
  const clean = sanitizeSettings({
    ...base,
    remote: {
      ...base.remote,
      enabled: true,
      phone: { scenes: true, recording: false, download: true, macros: true, controls: false },
      desktop: { scenes: false, recording: true, download: true, macros: false, controls: true },
      devices: [{ token: 'abc', name: 'iPhone', kind: 'phone', addedAt: 1 }],
    },
  });

  assert.equal(clean.remote.enabled, true);
  assert.deepEqual(clean.remote.phone, {
    scenes: true,
    recording: false,
    download: true,
    macros: true,
    controls: false,
  });
  assert.deepEqual(clean.remote.desktop, {
    scenes: false,
    recording: true,
    download: true,
    macros: false,
    controls: true,
  });
  assert.equal(clean.remote.devices[0].kind, 'phone', 'la nature de l appareil est conservee');

  // Une nature inconnue est ecartee, pas recopiee telle quelle.
  const odd = sanitizeSettings({
    ...base,
    remote: { ...base.remote, devices: [{ token: 'x', name: 'y', kind: 'inconnu', addedAt: 1 }] },
  });
  assert.equal(odd.remote.devices[0].kind, undefined);
});

/**
 * La page de lecture ne deforme jamais l'image.
 *
 * Sans `object-fit: contain`, une camera dont l'image n'est pas au rapport du
 * cadre (4/3, 16/10...) est etiree pour le remplir : le format est « ecrase ».
 * Le defaut etait visible partout, et surtout dans la grille de scene OBS ou
 * chaque flux occupe une cellule.
 */
test('la page de lecture conserve le format de l image', () => {
  const { renderPlayerPage } = require('../dist-electron/main/player-page.js');

  const page = renderPlayerPage({ name: 'Cam', path: 'live', version: '2.0.0', language: 'fr' });
  assert.match(page, /video\s*\{[^}]*object-fit\s*:\s*contain/, 'le lecteur doit preserver le rapport');

  // La version reduite (apercu integre, source OBS) doit aussi la conserver.
  const compact = renderPlayerPage({ name: 'Cam', path: 'live', version: '2.0.0', language: 'fr', compact: true });
  assert.match(compact, /object-fit\s*:\s*contain/);
});

/**
 * Une scene OBS recoit la resolution de chaque cellule, pas celle du canevas.
 *
 * Le defaut corrige : chaque source navigateur etait creee a la taille du
 * canevas (1920x1080) meme dans une grille, si bien qu'OBS recevait le mauvais
 * format pour chaque flux. Deux flux cote a cote doivent donc demander 960x1080.
 */
test('la grille de scene donne a chaque flux la resolution de sa cellule', () => {
  const { layoutCells } = require('../dist-electron/main/obs-controller.js');

  const side = layoutCells(2, 1920, 1080);
  assert.equal(side[0].width, 960);
  assert.equal(side[1].width, 960);
  assert.equal(side[0].height, 1080);

  const quad = layoutCells(4, 1920, 1080);
  assert.ok(quad.every((cell) => cell.width === 960 && cell.height === 540), JSON.stringify(quad));
});

/**
 * Le concatenateur fMP4 corrige les temps de decodage et les numeros de
 * sequence.
 *
 * Sans cela, la mise bout a bout brute de segments MediaMTX donne un fichier
 * que le lecteur ne joue qu'en partie : chaque fragment redemarre son temps a
 * zero. On construit ici deux fragments minimaux et on verifie que le second
 * repart bien apres le premier, et qu'un seul en-tete d'initialisation est
 * conserve.
 */
test('la concatenation fMP4 cumule les temps et garde un seul en-tete', () => {
  const { concatFragmentedMp4 } = require('../dist-electron/main/fmp4.js');

  // Fabrique une boite MP4 : taille (4) + type (4) + corps.
  const box = (type, body) => {
    const buffer = Buffer.alloc(8 + body.length);
    buffer.writeUInt32BE(8 + body.length, 0);
    buffer.write(type, 4, 'latin1');
    body.copy(buffer, 8);
    return buffer;
  };

  // Un fragment : mfhd + traf (tfhd + tfdt v1 + trun d'une image de duree 1000).
  const fragment = (sequence, tfdt) => {
    const mfhd = box('mfhd', Buffer.from([0, 0, 0, 0, 0, 0, 0, sequence]));
    // tfhd : version+flags (0x020000 = default-base-is-moof), track_ID = 1.
    const tfhd = box('tfhd', Buffer.from([2, 0, 0, 0, 0, 0, 0, 1]));
    // tfdt v1 : version=1, flags=0, baseMediaDecodeTime sur 8 octets.
    const tfdtBody = Buffer.alloc(12);
    tfdtBody.writeUInt8(1, 0);
    tfdtBody.writeBigUInt64BE(BigInt(tfdt), 4);
    const tfdtBox = box('tfdt', tfdtBody);
    // trun : version 0, flags 0x000301 (data_offset + sample_duration), 1 image.
    const trunBody = Buffer.alloc(4 + 4 + 4 + 4);
    trunBody.writeUInt32BE(0x000301, 0);
    trunBody.writeUInt32BE(1, 4); // sample_count
    trunBody.writeInt32BE(0, 8); // data_offset
    trunBody.writeUInt32BE(1000, 12); // sample_duration
    const trun = box('trun', trunBody);
    const traf = box('traf', Buffer.concat([tfhd, tfdtBox, trun]));
    return Buffer.concat([box('moof', Buffer.concat([mfhd, traf])), box('mdat', Buffer.alloc(16, 0xab))]);
  };

  const init = Buffer.concat([box('ftyp', Buffer.alloc(8, 0)), box('moov', Buffer.alloc(12, 0))]);
  const merged = concatFragmentedMp4([Buffer.concat([init, fragment(0, 0)]), Buffer.concat([init, fragment(0, 0)])]);
  assert.ok(merged, 'la concatenation doit produire un fichier');

  // Un seul ftyp et un seul moov (ceux du premier segment).
  const count = (needle) => {
    let total = 0;
    let offset = 0;
    while (offset + 8 <= merged.length) {
      const size = merged.readUInt32BE(offset);
      const type = merged.toString('latin1', offset + 4, offset + 8);
      if (type === needle) total += 1;
      if (size < 8) break;
      offset += size;
    }
    return total;
  };
  assert.equal(count('ftyp'), 1, 'un seul ftyp');
  assert.equal(count('moov'), 1, 'un seul moov');

  // Les deux fragments portent des temps croissants : 0 puis 1000.
  const tfdtValues = [];
  const sequences = [];
  const scan = (start, end) => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = merged.readUInt32BE(offset);
      const type = merged.toString('latin1', offset + 4, offset + 8);
      if (size < 8 || offset + size > end) break;
      if (type === 'moof') {
        scan(offset + 8, offset + size);
      } else if (type === 'traf') {
        scan(offset + 8, offset + size);
      } else if (type === 'tfdt') {
        tfdtValues.push(Number(merged.readBigUInt64BE(offset + 12)));
      } else if (type === 'mfhd') {
        sequences.push(merged.readUInt32BE(offset + 12));
      }
      offset += size;
    }
  };
  scan(0, merged.length);
  assert.deepEqual(tfdtValues, [0, 1000], 'temps de decodage cumules');
  assert.deepEqual(sequences, [1, 2], 'numeros de sequence croissants');
});

/**
 * L'en-tete du fichier assemble annonce la duree TOTALE, pas celle d'un segment.
 *
 * Le defaut corrige : chaque segment de MediaMTX porte un en-tete dont les
 * durees decrivent ce seul segment (`mvhd` = quelques secondes, `tkhd` et `mdhd`
 * a zero). Un fichier obtenu par mise bout a bout gardait cet en-tete, et le
 * lecteur affichait « 0:00 » comme duree, alors que la lecture continuait.
 */
test('l en-tete assemble annonce la duree totale', () => {
  const { concatFragmentedMp4 } = require('../dist-electron/main/fmp4.js');

  const box = (type, body) => {
    const buffer = Buffer.alloc(8 + body.length);
    buffer.writeUInt32BE(8 + body.length, 0);
    buffer.write(type, 4, 'latin1');
    body.copy(buffer, 8);
    return buffer;
  };

  // tkhd version 0 : version+flags (4) + dates (8) + track_ID (4) + reserved (4) + duration (4).
  const tkhd = (trackId, duration) => {
    const body = Buffer.alloc(4 + 8 + 4 + 4 + 4);
    body.writeUInt32BE(trackId, 12);
    body.writeUInt32BE(duration, 20);
    return box('tkhd', body);
  };
  // mdhd version 0 : version+flags (4) + dates (8) + timescale (4) + duration (4).
  const mdhd = (timescale, duration) => {
    const body = Buffer.alloc(4 + 8 + 4 + 4);
    body.writeUInt32BE(timescale, 12);
    body.writeUInt32BE(duration, 16);
    return box('mdhd', body);
  };
  // mvhd version 0 : version+flags (4) + dates (8) + timescale (4) + duration (4).
  const mvhd = (timescale, duration) => {
    const body = Buffer.alloc(4 + 8 + 4 + 4);
    body.writeUInt32BE(timescale, 12);
    body.writeUInt32BE(duration, 16);
    return box('mvhd', body);
  };

  const trak = box('trak', Buffer.concat([
    tkhd(1, 0),
    box('mdia', mdhd(90000, 0)),
  ]));
  // En-tete d'un segment : durees decrivant UN segment (2 s), tkhd et mdhd a zero.
  const moov = box('moov', Buffer.concat([mvhd(1000, 2000), trak]));

  // Un fragment : traf (tfhd track 1 + trun de 2 images de 45000 unites = 1 s).
  const tfhd = box('tfhd', Buffer.from([2, 0, 0, 0, 0, 0, 0, 1]));
  const trunBody = Buffer.alloc(4 + 4 + 2 * 8);
  trunBody.writeUInt32BE(0x000300, 0);
  trunBody.writeUInt32BE(2, 4);
  trunBody.writeUInt32BE(45000, 8);
  trunBody.writeUInt32BE(100, 12);
  trunBody.writeUInt32BE(45000, 16);
  trunBody.writeUInt32BE(100, 20);
  const traf = box('traf', Buffer.concat([tfhd, box('trun', trunBody)]));
  const moof = box('moof', Buffer.concat([box('mfhd', Buffer.alloc(8)), traf]));
  const segment = () => Buffer.concat([box('ftyp', Buffer.alloc(8, 0)), moov, moof, box('mdat', Buffer.alloc(16))]);

  // Trois segments d'une seconde chacun : le fichier dure 3 s.
  const merged = concatFragmentedMp4([segment(), segment(), segment()]);
  assert.ok(merged, 'la concatenation doit produire un fichier');

  // Lecture des durees dans l'en-tete du fichier assemble.
  const readBox = (buffer, start, end) => {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      if (size < 8 || offset + size > end) break;
      boxes.push({ type, start: offset, size });
      offset += size;
    }
    return boxes;
  };
  const top = readBox(merged, 0, merged.length);
  const moovBox = top.find((entry) => entry.type === 'moov');
  assert.ok(moovBox, 'un moov est present');
  const children = readBox(merged, moovBox.start + 8, moovBox.start + moovBox.size);

  const mvhdBox = children.find((entry) => entry.type === 'mvhd');
  // mvhd : version+flags (4) + dates (8) + timescale (4) + duration (4).
  const movieTimescale = merged.readUInt32BE(mvhdBox.start + 8 + 12);
  const movieDuration = merged.readUInt32BE(mvhdBox.start + 8 + 16);
  assert.equal(movieDuration / movieTimescale, 3, 'duree du film = 3 s');

  const trakBox = children.find((entry) => entry.type === 'trak');
  const trakChildren = readBox(merged, trakBox.start + 8, trakBox.start + trakBox.size);
  const tkhdBox = trakChildren.find((entry) => entry.type === 'tkhd');
  // tkhd : version+flags (4) + dates (8) + track_ID (4) + reserved (4) -> duration.
  const trackDuration = merged.readUInt32BE(tkhdBox.start + 8 + 20);
  assert.equal(trackDuration / movieTimescale, 3, 'duree de la piste = 3 s (et non 0)');

  const mdiaBox = trakChildren.find((entry) => entry.type === 'mdia');
  const mdhdBox = readBox(merged, mdiaBox.start + 8, mdiaBox.start + mdiaBox.size).find((e) => e.type === 'mdhd');
  // mdhd : version+flags (4) + dates (8) + timescale (4) + duration (4).
  const mediaTimescale = merged.readUInt32BE(mdhdBox.start + 8 + 12);
  const mediaDuration = merged.readUInt32BE(mdhdBox.start + 8 + 16);
  assert.equal(mediaDuration / mediaTimescale, 3, 'duree du media = 3 s (et non 0)');
});

/**
 * La duree d'un segment fMP4 se lit dans le `mdhd` et les `trun`.
 *
 * Le defaut corrige : le replay comptait les segments et multipliait par la
 * duree demandee (2 s). Or MediaMTX aligne ses segments sur le GOP de la
 * source, si bien qu'un segment dure rarement 2 s : un replay de 100 s n'en
 * durait que 3. On verifie ici que la duree reelle est bien lue, base de temps
 * comprise (le champ du `mdhd` suit deux dates dont la taille depend de la
 * version).
 */
test('la duree d un segment fMP4 est lue depuis mdhd et trun', () => {
  const { fmp4SegmentSeconds } = require('../dist-electron/main/fmp4.js');

  const box = (type, body) => {
    const buffer = Buffer.alloc(8 + body.length);
    buffer.writeUInt32BE(8 + body.length, 0);
    buffer.write(type, 4, 'latin1');
    body.copy(buffer, 8);
    return buffer;
  };

  // tkhd version 0 : version+flags (4) + creation (4) + modification (4) + track_ID (4).
  const tkhd = (trackId) => {
    const body = Buffer.alloc(4 + 4 + 4 + 4);
    body.writeUInt32BE(trackId, 12);
    return box('tkhd', body);
  };

  // mdhd version 0 : version+flags (4) + creation (4) + modification (4) + timescale (4).
  const mdhd = (timescale) => {
    const body = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 4);
    body.writeUInt8(0, 0); // version 0
    body.writeUInt32BE(timescale, 12);
    return box('mdhd', body);
  };

  const trak = (trackId, timescale) => box('trak', Buffer.concat([tkhd(trackId), box('mdia', mdhd(timescale))]));

  // tfhd : version+flags (default-base-is-moof) + track_ID.
  const tfhd = (trackId) => {
    const body = Buffer.alloc(8);
    body.writeUInt32BE(0x020000, 0);
    body.writeUInt32BE(trackId, 4);
    return box('tfhd', body);
  };

  // trun version 0, flags 0x000300 : duree ET taille par image (comme MediaMTX).
  const trun = (durations) => {
    const body = Buffer.alloc(4 + 4 + 8 * durations.length);
    body.writeUInt32BE(0x000300, 0);
    body.writeUInt32BE(durations.length, 4);
    durations.forEach((duration, index) => {
      body.writeUInt32BE(duration, 8 + index * 8);
      body.writeUInt32BE(100, 12 + index * 8); // sample_size
    });
    return box('trun', body);
  };

  const traf = (trackId, durations) => box('traf', Buffer.concat([tfhd(trackId), trun(durations)]));
  const moof = (...trafs) => box('moof', Buffer.concat([box('mfhd', Buffer.alloc(8)), ...trafs]));
  const mdat = () => box('mdat', Buffer.alloc(16, 0));

  // Un segment video seul, DEUX fragments de 1 s : la duree doit etre 2 s.
  // (MediaMTX ecrit plusieurs fragments par segment ; n'en lire qu'un donnait
  // la moitie de la duree reelle.)
  const videoOnly = Buffer.concat([
    box('ftyp', Buffer.alloc(8, 0)),
    box('moov', trak(1, 1000)),
    moof(traf(1, [500, 500])), mdat(),
    moof(traf(1, [500, 500])), mdat(),
  ]);
  assert.ok(Math.abs(fmp4SegmentSeconds(videoOnly) - 2) < 1e-6, `2 s attendues, obtenue ${fmp4SegmentSeconds(videoOnly)}`);

  // Deux pistes, bases de temps differentes (video 90000, audio 48000), de
  // meme duree : le segment dure 1 s, pas la somme des deux.
  const twoTracks = Buffer.concat([
    box('ftyp', Buffer.alloc(8, 0)),
    box('moov', Buffer.concat([trak(1, 90000), trak(2, 48000)])),
    moof(traf(1, [45000, 45000]), traf(2, [48000])), mdat(),
  ]);
  const measured = fmp4SegmentSeconds(twoTracks);
  assert.ok(Math.abs(measured - 1) < 1e-6, `1 s attendue, obtenue ${measured}`);

  // Un segment sans moov (fichier tronque) ne doit pas inventer de duree.
  assert.equal(fmp4SegmentSeconds(Buffer.alloc(32, 0)), 0);
});

/**
 * La selection d'une plage de replay s'appuie sur la duree reelle des segments.
 *
 * On verifie qu'une plage « des 30 dernieres secondes » retient bien les
 * segments qui couvrent cette fenetre, et non un nombre fixe de segments.
 */
test('la selection de replay retient les segments de la plage', () => {
  const { selectSegments } = require('../dist-electron/main/replay.js');

  // Cinq segments de 3 s chacun : 15 s au total.
  const segments = [0, 1, 2, 3, 4].map((index) => ({ file: `s${index}.mp4`, seconds: 3 }));

  // Les 6 dernieres secondes = les deux derniers segments.
  const last = selectSegments(segments, 6, 0);
  assert.deepEqual(last.map((s) => s.file), ['s3.mp4', 's4.mp4']);

  // Toute la memoire.
  const all = selectSegments(segments, 15, 0);
  assert.equal(all.length, 5);

  // Une fenetre au milieu : de 12 s en arriere a 6 s en arriere, soit 6 s
  // de contenu = deux segments.
  const middle = selectSegments(segments, 12, 6);
  assert.deepEqual(middle.map((s) => s.file), ['s1.mp4', 's2.mp4']);
});

/**
 * La plage d'un replay est bornee par la memoire et le minimum configures.
 *
 * On verifie la logique de selection sans toucher au disque : les fonctions
 * pures de `replay.ts` sont testees ici, et la sauvegarde reelle l'est en e2e.
 */
test('les reglages de replay sont valides et bornes', () => {
  const { defaultSettings, sanitizeSettings } = require('../dist-electron/main/settings.js');

  const base = defaultSettings();
  // Le minimum ne peut pas depasser la memoire : sinon aucun replay ne
  // pourrait jamais etre produit.
  const clean = sanitizeSettings({
    ...base,
    replay: { enabled: true, bufferSeconds: 20, minimumSeconds: 40, path: '', outputPath: '', },
  });
  // La memoire est remontee au minimum de 30 s, et le minimum est ramene a la
  // memoire.
  assert.ok(clean.replay.bufferSeconds >= 30, String(clean.replay.bufferSeconds));
  assert.ok(clean.replay.minimumSeconds <= clean.replay.bufferSeconds, 'minimum <= memoire');
  assert.equal(clean.replay.outputPath, '', 'dossier vide par defaut');
});

/**
 * L'enregistrement lit un segment **en plusieurs fois**, sans rien perdre.
 *
 * C'est ce qui rend l'enregistrement quasi instantane : on ecrit chaque paire
 * `moof`+`mdat` des qu'elle est complete, sans attendre la fin du segment. Un
 * segment relu plus tard doit reprendre a la position deja traitee, et le
 * fichier final doit contenir exactement les memes fragments qu'une lecture
 * d'un seul coup.
 */
test('l enregistrement lit un segment en plusieurs fois sans rien perdre', () => {
  const { createFmp4Writer, fmp4Append, fmp4Finalize, concatFragmentedMp4 } = require('../dist-electron/main/fmp4.js');

  const box = (type, body) => {
    const buffer = Buffer.alloc(8 + body.length);
    buffer.writeUInt32BE(8 + body.length, 0);
    buffer.write(type, 4, 'latin1');
    body.copy(buffer, 8);
    return buffer;
  };

  const tfhd = box('tfhd', Buffer.from([2, 0, 0, 0, 0, 0, 0, 1]));
  const fragment = () => {
    const trunBody = Buffer.alloc(4 + 4 + 8);
    trunBody.writeUInt32BE(0x000300, 0);
    trunBody.writeUInt32BE(1, 4);
    trunBody.writeUInt32BE(1000, 8);
    trunBody.writeUInt32BE(100, 12);
    const traf = box('traf', Buffer.concat([tfhd, box('trun', trunBody)]));
    return Buffer.concat([box('moof', Buffer.concat([box('mfhd', Buffer.alloc(8)), traf])), box('mdat', Buffer.alloc(32))]);
  };

  // Un segment : en-tete (ftyp + moov) suivi de trois fragments.
  const moov = box('moov', Buffer.alloc(12, 0));
  const segment = Buffer.concat([box('ftyp', Buffer.alloc(8, 0)), moov, fragment(), fragment(), fragment()]);

  // Lecture d'un seul coup : reference.
  const whole = concatFragmentedMp4([segment]);
  assert.ok(whole, 'la lecture d un coup doit produire un fichier');

  // Lecture en plusieurs fois : on decoupe le segment apres l'en-tete (la
  // premiere lecture part toujours de 0 et emporte ftyp + moov d'un coup),
  // puis a des positions volontairement « sales » (au milieu des fragments).
  const headerSize = box('ftyp', Buffer.alloc(8, 0)).length + moov.length;
  const state = createFmp4Writer();
  const parts = [];
  let from = 0;
  for (const cut of [headerSize + 4, headerSize + 40, headerSize + 90, segment.length]) {
    const slice = segment.subarray(0, cut);
    const result = fmp4Append(state, slice, from);
    if (result) {
      parts.push(result.chunk);
      from = result.consumed;
    }
  }
  fmp4Finalize(state);
  if (state.initMoov && parts[0]) state.initMoov.copy(parts[0], state.initOffset);
  const partial = Buffer.concat(parts);

  // Le fichier obtenu doit etre identique a la lecture d'un seul coup.
  assert.equal(partial.length, whole.length, 'meme taille');
  assert.ok(partial.equals(whole), 'contenu identique');
});

/**
 * Un enregistrement direct de MediaMTX est repare : sa duree n'est plus zero.
 *
 * MediaMTX ecrit ses enregistrements avec `tkhd` et `mdhd` a zero, ce qui fait
 * afficher « 00:00 » aux lecteurs de Windows. `repairFmp4HeaderDurations` relit
 * la duree dans les fragments et reecrit l'en-tete sur place.
 */
test('la duree d un enregistrement direct est reparee', () => {
  const { repairFmp4HeaderDurations } = require('../dist-electron/main/fmp4.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const nodePath = require('node:path');

  const box = (type, body) => {
    const buffer = Buffer.alloc(8 + body.length);
    buffer.writeUInt32BE(8 + body.length, 0);
    buffer.write(type, 4, 'latin1');
    body.copy(buffer, 8);
    return buffer;
  };

  // En-tete facon MediaMTX : mvhd renseigne (2 s), tkhd et mdhd a ZERO.
  const mvhdBody = Buffer.alloc(4 + 8 + 4 + 4);
  mvhdBody.writeUInt32BE(1000, 12); // timescale
  mvhdBody.writeUInt32BE(2000, 16); // duration (2 s)
  const tkhdBody = Buffer.alloc(4 + 8 + 4 + 4 + 4);
  tkhdBody.writeUInt32BE(1, 12); // track_ID
  tkhdBody.writeUInt32BE(0, 20); // duration = 0 (le defaut)
  const mdhdBody = Buffer.alloc(4 + 8 + 4 + 4);
  mdhdBody.writeUInt32BE(90000, 12); // timescale
  mdhdBody.writeUInt32BE(0, 16);     // duration = 0
  const trak = box('trak', Buffer.concat([box('tkhd', tkhdBody), box('mdia', box('mdhd', mdhdBody))]));
  const moov = box('moov', Buffer.concat([box('mvhd', mvhdBody), trak]));

  // Trois fragments de 1 s chacun (2 images de 45000 a 90000 unites/s).
  const tfhd = box('tfhd', Buffer.from([2, 0, 0, 0, 0, 0, 0, 1]));
  const fragment = () => {
    const trunBody = Buffer.alloc(4 + 4 + 2 * 8);
    trunBody.writeUInt32BE(0x000300, 0);
    trunBody.writeUInt32BE(2, 4);
    trunBody.writeUInt32BE(45000, 8);
    trunBody.writeUInt32BE(100, 12);
    trunBody.writeUInt32BE(45000, 16);
    trunBody.writeUInt32BE(100, 20);
    const traf = box('traf', Buffer.concat([tfhd, box('trun', trunBody)]));
    return Buffer.concat([box('moof', Buffer.concat([box('mfhd', Buffer.alloc(8)), traf])), box('mdat', Buffer.alloc(16))]);
  };
  const file = Buffer.concat([box('ftyp', Buffer.alloc(8, 0)), moov, fragment(), fragment(), fragment()]);

  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sc-repair-'));
  const target = nodePath.join(dir, 'recording.mp4');
  fs.writeFileSync(target, file);

  assert.equal(repairFmp4HeaderDurations(target), true, 'la reparation doit reussir');

  const repaired = fs.readFileSync(target);
  // On localise les boites plutot que de calculer des offsets a la main.
  const readBox = (buffer, start, end) => {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      if (size < 8 || offset + size > end) break;
      boxes.push({ type, start: offset, size });
      offset += size;
    }
    return boxes;
  };
  const moovBox = readBox(repaired, 0, repaired.length).find((b) => b.type === 'moov');
  const children = readBox(repaired, moovBox.start + 8, moovBox.start + moovBox.size);
  const mvhd = children.find((b) => b.type === 'mvhd');
  const movieTimescale = repaired.readUInt32BE(mvhd.start + 8 + 12);
  const movieDuration = repaired.readUInt32BE(mvhd.start + 8 + 16);
  assert.equal(movieDuration / movieTimescale, 3, 'mvhd = 3 s');

  const trakBox2 = children.find((b) => b.type === 'trak');
  const tkhd = readBox(repaired, trakBox2.start + 8, trakBox2.start + trakBox2.size).find((b) => b.type === 'tkhd');
  const trackDuration = repaired.readUInt32BE(tkhd.start + 8 + 20);
  assert.equal(trackDuration / movieTimescale, 3, 'tkhd = 3 s (et non 0)');

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * La comparaison de versions refuse une version plus ancienne.
 *
 * Le defaut corrige : l'application proposait parfois d'installer une version
 * PLUS BASSE que celle installee (brouillon publie par erreur, ou version
 * precedente encore en tete du depot).
 */
test('la comparaison de versions ordonne correctement', () => {
  const { compareVersions } = require('../dist-electron/main/app-updater.js');

  assert.ok(compareVersions('2.0.2', '2.0.2') === 0, 'versions egales');
  assert.ok(compareVersions('v2.0.2', '2.0.2') === 0, 'prefixe v ignore');
  assert.ok(compareVersions('2.0.3', '2.0.2') > 0, 'version plus recente');
  assert.ok(compareVersions('2.0.1', '2.0.2') < 0, 'version plus ancienne');
  assert.ok(compareVersions('2.1.0', '2.0.9') > 0, 'mineure plus recente');
  assert.ok(compareVersions('3.0.0', '2.9.9') > 0, 'majeure plus recente');
  assert.ok(compareVersions('2.0', '2.0.0') === 0, 'chiffres manquants = zero');
});
