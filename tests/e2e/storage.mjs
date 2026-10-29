/**
 * Verifie le rangement des fichiers et l'ouverture du dossier.
 *
 * Le bug corrige ici : l'interface reconstituait un chemin contenant
 * `%APPDATA%`, que Windows ne developpe pas. L'ouverture echouait alors avec
 * « Failed to open path ». Les chemins viennent desormais du processus
 * principal, et le dossier est cree au besoin.
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import { startStaticServer, startApp, waitForAppPage, createChecker, createCdp, sleep } from './harness.mjs';

const USER_DATA = '/tmp/sc-e2e-storage';
const DEBUG_PORT = 9345;
const STORAGE_DIR = '/tmp/sc-e2e-storage-target';

const { check, summary } = createChecker();

fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

const staticServer = await startStaticServer();
const app = startApp({ userDataDir: USER_DATA, debugPort: DEBUG_PORT });

try {
  const page = await waitForAppPage(DEBUG_PORT);
  const cdp = createCdp(WebSocket, page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // --- 1. Les chemins doivent etre reels, sans variable non developpee -----
  console.log('\n--- chemins reels ---');
  const paths = await cdp.evaluate('window.streamcontrol.getPaths()');
  check('chemin du profil fourni', typeof paths.userData === 'string' && paths.userData.length > 0, paths.userData);
  check(
    'aucune variable non developpee',
    !paths.userData.includes('%') && !paths.settingsFile.includes('%') && !paths.storageDir.includes('%'),
    paths.storageDir,
  );
  check('chemin absolu', path.isAbsolute(paths.userData), paths.userData);
  check(
    'fichier de parametres coherent',
    paths.settingsFile.endsWith('settings.json'),
    paths.settingsFile,
  );

  // --- 2. Ouvrir un dossier inexistant doit le creer, pas echouer --------
  console.log('\n--- ouverture du dossier ---');
  check('le dossier vise n existe pas encore', !fs.existsSync(STORAGE_DIR));

  // L'environnement de test n'a pas de gestionnaire de fichiers : on verifie
  // que l'appel repond et que le dossier existe, ce qui est le comportement
  // attendu cote application. Le blocage sans reponse est le bug corrige.
  const started = Date.now();
  const opened = await cdp.evaluate(
    `window.streamcontrol.storageOpen(${JSON.stringify(STORAGE_DIR)})`,
  );
  const elapsed = Date.now() - started;

  check('l appel repond sans bloquer', elapsed < 8000, `${elapsed} ms`);
  check('dossier cree au besoin', fs.existsSync(STORAGE_DIR), STORAGE_DIR);
  check(
    'un message est toujours renvoye',
    typeof opened.message === 'string' && opened.message.length > 0,
    opened.message.slice(0, 60),
  );

  // --- 3. L'inventaire liste les elements rangeables ---------------------
  console.log('\n--- inventaire ---');
  const entries = await cdp.evaluate('window.streamcontrol.storageList()');
  check('inventaire non vide', entries.length >= 3, `${entries.length} elements`);
  check(
    'chaque element a un chemin cible absolu',
    entries.every((e) => path.isAbsolute(e.target)),
    entries[0]?.target,
  );
  check(
    'les parametres sont dans l inventaire',
    entries.some((e) => e.key === 'settings'),
  );

  // --- 4. Le rangement a ete retire : l'inventaire ne deplace rien -------
  console.log('\n--- aucun deplacement automatique ---');
  // L'API de rangement ne doit plus exister : le deplacement de fichiers sans
  // demande explicite etait justement ce qu'il fallait retirer.
  const hasGather = await cdp.evaluate('typeof window.streamcontrol.storageGather');
  check('la fonction de rangement a disparu', hasGather === 'undefined', hasGather);

  await cdp.evaluate(
    `window.streamcontrol.saveSettings({ files: { storagePath: ${JSON.stringify(STORAGE_DIR)} } })`,
  );
  const afterList = await cdp.evaluate('window.streamcontrol.storageList()');
  check(
    'les fichiers ne sont pas deplaces par l inventaire',
    !fs.existsSync(path.join(STORAGE_DIR, 'config', 'settings.json')),
    'aucun fichier deplace',
  );
  check(
    'l inventaire reste lisible',
    Array.isArray(afterList) && afterList.length >= 3,
    `${afterList.length} elements`,
  );

  // --- 5. L'erreur remonte au lieu d'etre avalee -------------------------
  console.log('\n--- remontee des erreurs ---');
  // Un chemin impossible a creer doit produire un message, pas un silence.
  // Le chemin passe par un fichier existant : le creer est impossible sur
  // toutes les plateformes.
  const blocked = path.join(USER_DATA, 'settings.json', 'impossible');
  const impossible = await cdp.evaluate(
    `window.streamcontrol.storageOpen(${JSON.stringify(blocked)})`,
  );
  check(
    'un chemin impossible renvoie une erreur explicite',
    impossible.ok === false && impossible.message.length > 0,
    impossible.message.slice(0, 70),
  );

  cdp.close();
} catch (error) {
  console.error('ERREUR :', error.message);
  console.log(app.getLog().split('\n').filter((l) => /\[storage\]|\[ipc\]/.test(l)).slice(-10).join('\n'));
} finally {
  app.child.kill('SIGTERM');
  await sleep(1500);
  if (!app.child.killed) app.child.kill('SIGKILL');
  await staticServer.close();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
}

summary();
