/**
 * Harnais commun aux tests de bout en bout.
 *
 * L'application charge le serveur de developpement Vite quand elle n'est pas
 * empaquetee. Les tests servent donc le rendu compile depuis `dist/` sur le
 * port attendu : ils exercent ainsi le vrai code construit, sans dependre d'un
 * serveur de developpement.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sert le rendu compile sur le port du serveur de developpement. */
export function startStaticServer(port = 5173) {
  const distDir = path.join(projectRoot, 'dist');

  const server = http.createServer((request, response) => {
    const requested = (request.url ?? '/').split('?')[0];
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const filePath = path.join(distDir, relative);

    // Empeche toute remontee hors du dossier de build.
    if (!filePath.startsWith(distDir)) {
      response.writeHead(403).end('Interdit');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404).end('Introuvable');
        return;
      }
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
      response.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

/** Lance Electron avec un profil isole et le port de debogage demande. */
export function startApp({ userDataDir, debugPort, extraArgs = [], env = {} }) {
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const child = spawn(
    path.resolve(projectRoot, 'node_modules/electron/dist/electron'),
    [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
      '.',
    ],
    { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  );

  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));

  return { child, getLog: () => log };
}

/** Attend la page de l'application (ignore la fenetre DevTools). */
export async function waitForAppPage(debugPort, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = list.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://') && t.url.startsWith('http://127.0.0.1:5173'),
      );
      if (page) return page;
    } catch {
      // Le port de debogage n'est pas encore ouvert.
    }
    await sleep(500);
  }
  throw new Error("La page de l'application n'a jamais repondu.");
}

/**
 * Attend qu'une condition devienne vraie.
 *
 * Les tests doivent attendre un etat reel plutot qu'un delai fixe : un delai
 * trop court rend le test instable, un delai trop long le ralentit inutilement.
 *
 * @returns true si la condition s'est verifiee avant l'echeance.
 */
export async function waitFor(description, probe, timeoutMs = 20_000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await probe();
    if (lastValue) return true;
    await sleep(intervalMs);
  }

  console.log(`[attente] "${description}" non satisfaite apres ${timeoutMs} ms (derniere valeur : ${JSON.stringify(lastValue)})`);
  return false;
}

/** Journal de verifications, avec sortie lisible. */
export function createChecker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  };
  const summary = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} verifications reussies ===`);
    if (failed.length) {
      console.log('Echecs :', failed.map((f) => f.name).join(', '));
      process.exitCode = 1;
    }
    return failed.length === 0;
  };
  return { check, summary, results };
}

/** Client minimal du Chrome DevTools Protocol. */
export function createCdp(WebSocket, wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(
        `${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`.trim(),
      );
    }
    return result.result.value;
  };

  return { ready, send, evaluate, close: () => socket.close() };
}

export { projectRoot };
