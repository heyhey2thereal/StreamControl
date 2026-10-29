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
