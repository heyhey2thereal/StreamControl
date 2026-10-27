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
