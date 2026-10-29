/**
 * Tests du moteur de macros, avec des cibles factices.
 *
 * Le moteur est exerce sans Electron : on lui donne un magasin de reglages en
 * memoire et des cibles qui enregistrent ce qui a ete demande. C'est ce qui
 * permet de verifier le comportement reel (attente, confirmation, delai) sans
 * dependre d'OBS ni de MediaMTX.
 *
 * Lancement : npm run build:electron && npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Automation } = require('../dist-electron/main/automation.js');
const { Logger } = require('../dist-electron/main/logger.js');

/** Magasin de reglages en memoire, avec les champs attendus par le moteur. */
function makeSettings(macros = []) {
  const state = {
    macros,
    showRunner: [],
    ui: { locked: false, lockHash: '', lockSalt: '', lockHint: '' },
  };
  return {
    get: () => state,
    save: async (patch) => {
      Object.assign(state, patch);
      return state;
    },
  };
}

/** Cibles factices : elles notent tout ce qui leur est demande. */
function makeTargets(overrides = {}) {
  const calls = [];
  const targets = {
    calls,
    setScene: async (name) => calls.push(['setScene', name]),
    setPreviewScene: async () => {},
    transition: async () => {},
    setTransition: async () => {},
    setTransitionDuration: async () => {},
    setStudioMode: async () => {},
    createScene: async () => {},
    deleteScene: async () => {},
    renameScene: async () => {},
    setSourceVisible: async () => {},
    setSourceMuted: async () => {},
    setSourceVolume: async () => {},
    toggleStreaming: async () => {},
    toggleObsRecording: async () => {},
    setStreamRecording: async () => {},
    saveReplay: async () => {},
    saveReplayAll: async () => 0,
    setStreamEnabled: async () => {},
    createStream: async () => ({ ok: true }),
    deleteStream: async () => ({ ok: true }),
    lock: async () => calls.push(['lock']),
    restartMediamtx: async () => {},
    startMediamtx: async () => {},
    stopMediamtx: async () => {},
    isObsConnected: () => true,
    isMediamtxRunning: () => true,
    isStreamLive: () => true,
    isRecording: () => false,
    isStreaming: () => false,
    checkPassword: () => true,
    log: (level, text) => calls.push(['log', level, text]),
    notify: (text) => calls.push(['notify', text]),
    popup: async (text, label, confirm) => {
      calls.push(['popup', text, label, confirm]);
      return true;
    },
    playSound: async (path) => calls.push(['sound', path]),
    openFolder: async () => {},
    openUrl: async () => {},
    httpGet: async () => ({ ok: true }),
    ...overrides,
  };
  return targets;
}

/** Macro minimale autour d'une suite d'actions. */
const macroWith = (actions) => ({
  id: 'm1',
  name: 'Test',
  actions,
  triggers: [],
  createdAt: Date.now(),
});

test('un bloc « attendre » respecte sa duree', async () => {
  const settings = makeSettings([macroWith([{ kind: 'wait', seconds: 1 }])]);
  const automation = new Automation(new Logger(), settings, makeTargets());

  const started = Date.now();
  const result = await automation.runMacro('m1');
  const elapsed = Date.now() - started;

  assert.equal(result.ok, true);
  assert.ok(elapsed >= 950, `attente trop courte : ${elapsed} ms`);
  assert.ok(elapsed < 2500, `attente trop longue : ${elapsed} ms`);
});

test('le delai « temps avant la suite » est observe', async () => {
  const settings = makeSettings([
    macroWith([
      { kind: 'log', text: 'un', delaySeconds: 1 },
      { kind: 'log', text: 'deux' },
    ]),
  ]);
  const targets = makeTargets();
  const automation = new Automation(new Logger(), settings, targets);

  const started = Date.now();
  await automation.runMacro('m1');
  const elapsed = Date.now() - started;

  assert.ok(elapsed >= 950, `delai non observe : ${elapsed} ms`);
  const logs = targets.calls.filter((call) => call[0] === 'log').map((call) => call[2]);
  assert.deepEqual(logs, ['un', 'deux']);
});

test('une pop-up sans confirmation n arrete pas la suite', async () => {
  const settings = makeSettings([
    macroWith([
      { kind: 'popup', text: 'coucou', confirmLabel: 'Continuer', requireConfirmation: false },
      { kind: 'log', text: 'apres' },
    ]),
  ]);
  const targets = makeTargets();
  const automation = new Automation(new Logger(), settings, targets);

  const result = await automation.runMacro('m1');
  assert.equal(result.ok, true);
  const logs = targets.calls.filter((call) => call[0] === 'log').map((call) => call[2]);
  assert.deepEqual(logs, ['apres'], 'la suite doit continuer');
  // La pop-up doit avoir ete demandee SANS confirmation.
  const popup = targets.calls.find((call) => call[0] === 'popup');
  assert.equal(popup[3], false, 'la confirmation ne doit pas etre exigee');
});

test('une pop-up avec confirmation refusee arrete la macro', async () => {
  const settings = makeSettings([
    macroWith([
      { kind: 'popup', text: 'valider ?', confirmLabel: 'Oui', requireConfirmation: true },
      { kind: 'log', text: 'apres' },
    ]),
  ]);
  // L'operateur refuse : la cible renvoie false.
  const targets = makeTargets({ popup: async (text, label, confirm) => { targets.calls.push(['popup', text, label, confirm]); return false; } });
  const automation = new Automation(new Logger(), settings, targets);

  const result = await automation.runMacro('m1');
  const logs = targets.calls.filter((call) => call[0] === 'log').map((call) => call[2]);
  assert.deepEqual(logs, [], 'la suite ne doit pas continuer apres un refus');
  assert.equal(result.ok, false, 'la macro doit etre signalee arretee');
});

test('la macro « verrouiller le poste » verrouille vraiment', async () => {
  const settings = makeSettings([macroWith([{ kind: 'lock', password: '' }])]);
  const targets = makeTargets();
  const automation = new Automation(new Logger(), settings, targets);

  const result = await automation.runMacro('m1');
  assert.equal(result.ok, true, `echec : ${result.message ?? ''}`);
  assert.ok(targets.calls.some((call) => call[0] === 'lock'), 'la cible lock doit etre appelee');
});

test('une variable est resolue dans le texte du journal', async () => {
  const settings = makeSettings([macroWith([{ kind: 'log', text: 'Flux {flux_nom} a {heure_courte}.' }])]);
  const targets = makeTargets({
    variables: () => ({
      flux: { id: 'a', name: 'Camera scene', path: 'live', live: true },
      now: new Date('2026-10-29T14:05:00'),
    }),
  });
  const automation = new Automation(new Logger(), settings, targets);

  await automation.runMacro('m1');
  const line = targets.calls.find((call) => call[0] === 'log')?.[2] ?? '';
  assert.equal(line, 'Flux Camera scene a 14:05.');
});
