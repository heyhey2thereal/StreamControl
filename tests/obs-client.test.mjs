/**
 * Verifie l'implementation du protocole obs-websocket v5 cote StreamControl
 * face a un serveur conforme a la specification. OBS Studio ne pouvant pas
 * etre pilote dans cet environnement de test, on valide ici la poignee de
 * main, l'algorithme d'authentification, les requetes et les evenements.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { startObsServer, buildAuthString } from './obs-ws-server.mjs';

const require = createRequire(import.meta.url);
const { ObsClient } = require('../dist-electron/main/obs-client.js');
const { Logger } = require('../dist-electron/main/logger.js');

test('algorithme d authentification conforme a la specification', () => {
  // Valeurs de reference calculables independamment.
  const password = 'motdepasse';
  const salt = 'salt-1234';
  const challenge = 'challenge-5678';
  const expected = buildAuthString(password, salt, challenge);

  assert.equal(ObsClient.buildAuthString(password, salt, challenge), expected);
  assert.notEqual(ObsClient.buildAuthString('mauvais', salt, challenge), expected);
});

test('connexion sans mot de passe puis requetes et evenements', async () => {
  const server = startObsServer();
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    const hello = await client.connect({ host: '127.0.0.1', port, password: '' });
    assert.equal(hello.authenticationRequired, false);
    assert.equal(hello.rpcVersion, 1);
    assert.equal(client.getState(), 'connected');

    const version = await client.request('GetVersion');
    assert.equal(version.obsVersion, '31.0.0');

    const scenes = await client.request('GetSceneList');
    assert.equal(scenes.currentProgramSceneName, 'Scene principale');
    assert.equal(scenes.scenes.length, 3);

    // Un changement de scene declenche un evenement cote serveur.
    const eventReceived = new Promise((resolve) => client.once('event', (type, data) => resolve({ type, data })));
    await client.request('SetCurrentProgramScene', { sceneName: 'Scene camera' });
    const event = await eventReceived;
    assert.equal(event.type, 'CurrentProgramSceneChanged');
    assert.equal(event.data.sceneName, 'Scene camera');
    assert.equal(server.state.currentScene, 'Scene camera');

    // Comme OBS : StartStream n'active la sortie que si un service est
    // configure. On le renseigne d'abord, comme le fait l'application.
    await client.request('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: 'rtmp://127.0.0.1:1935/live', key: 'x' },
    });
    const streaming = await client.request('StartStream');
    assert.deepEqual(streaming, {});
    assert.equal(server.state.streaming, true);

    const status = await client.request('GetStreamStatus');
    assert.equal(status.outputActive, true);
  } finally {
    client.disconnect();
    await server.close();
  }
});

test('connexion avec mot de passe valide', async () => {
  const server = startObsServer({ password: 'secret-obs' });
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    const hello = await client.connect({ host: '127.0.0.1', port, password: 'secret-obs' });
    assert.equal(hello.authenticationRequired, true);
    assert.equal(client.getState(), 'connected');
    assert.ok(server.state.receivedAuth, 'la reponse d authentification a ete transmise');

    const version = await client.request('GetVersion');
    assert.equal(version.obsVersion, '31.0.0');
  } finally {
    client.disconnect();
    await server.close();
  }
});

test('mot de passe errone : la connexion echoue avec un message explicite', async () => {
  const server = startObsServer({ password: 'secret-obs' });
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    await assert.rejects(
      () => client.connect({ host: '127.0.0.1', port, password: 'mauvais-mot-de-passe' }),
      /mot de passe WebSocket refuse/i,
    );
    assert.equal(client.getState(), 'auth-failed');
  } finally {
    client.disconnect();
    await server.close();
  }
});

test('mot de passe exige mais absent : erreur explicite', async () => {
  const server = startObsServer({ password: 'secret-obs' });
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    await assert.rejects(
      () => client.connect({ host: '127.0.0.1', port, password: '' }),
      /exige un mot de passe/i,
    );
    assert.equal(client.getState(), 'auth-failed');
  } finally {
    client.disconnect();
    await server.close();
  }
});

test('port ferme : la connexion echoue sans bloquer', async () => {
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    await assert.rejects(
      () => client.connect({ host: '127.0.0.1', port: 1, password: '' }, 2500),
      // Le message brut « ECONNREFUSED » est traduit en cause actionnable.
      /ne repond pas|WebSocket Server Settings/i,
    );
    assert.equal(client.getState(), 'disconnected');
  } finally {
    client.disconnect();
  }
});

test('requete inconnue : OBS renvoie une erreur exploitable', async () => {
  const server = startObsServer();
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    await client.connect({ host: '127.0.0.1', port, password: '' });
    await assert.rejects(
      () => client.request('RequeteInexistante'),
      /OBS a refuse RequeteInexistante \(code 204\)/,
    );
  } finally {
    client.disconnect();
    await server.close();
  }
});

test('requete apres deconnexion : refus immediat', async () => {
  const server = startObsServer();
  const port = await server.port;
  const logger = new Logger({ minLevel: 'error' });
  const client = new ObsClient(logger);

  try {
    await client.connect({ host: '127.0.0.1', port, password: '' });
    client.disconnect();
    await assert.rejects(() => client.request('GetVersion'), /Non connecte a OBS/);
  } finally {
    await server.close();
  }
});
