/**
 * Test du gestionnaire MediaMTX dans l'application reelle :
 * demarrage via IPC, verification que le port ecoute, arret propre,
 * et gestion d'une configuration invalide.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import WebSocket from '../../node_modules/ws/wrapper.mjs';

// Le binaire MediaMTX est fourni via STREAMCONTROL_MEDIAMTX_BINARY.
// Exemple : STREAMCONTROL_MEDIAMTX_BINARY=/opt/mediamtx/mediamtx npm run test:e2e
const MEDIAMTX_BINARY = process.env.STREAMCONTROL_MEDIAMTX_BINARY;
if (!MEDIAMTX_BINARY || !fs.existsSync(MEDIAMTX_BINARY)) {
  console.log('SKIP  test MediaMTX : definissez STREAMCONTROL_MEDIAMTX_BINARY vers un binaire mediamtx valide.');
  process.exit(0);
}

const userDataDir = '/tmp/sc-e2e-mt';
fs.rmSync(userDataDir, { recursive: true, force: true });
const DEBUG_PORT = 9334;

const child = spawn(
  path.resolve('node_modules/electron/dist/electron'),
  ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${DEBUG_PORT}`,`--user-data-dir=${userDataDir}`,'.'],
  { stdio: ['ignore','pipe','pipe'] },
);
let appLog = '';
child.stdout.on('data', d => appLog += d);
child.stderr.on('data', d => appLog += d);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, d='') => { results.push({n, ok:!!ok}); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?` -> ${d}`:''}`); };
const probe = port => new Promise(res => {
  const s = new net.Socket(); s.setTimeout(1200);
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('timeout', () => { s.destroy(); res(false); });
  s.once('error', () => res(false));
  s.connect(port, '127.0.0.1');
});

async function target() {
  for (let i=0;i<40;i++){
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find(t => t.type==='page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('cible introuvable');
}

function cdp(url) {
  const ws = new WebSocket(url); let id=0; const pend=new Map();
  ws.on('message', raw => { const m=JSON.parse(raw); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);} });
  const ready = new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method,params}));});
  const evaluate=async expr=>{
    const r = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description||''));
    return r.result.value;
  };
  return { ready, send, evaluate, close:()=>ws.close() };
}

try {
  const t = await target();
  const c = cdp(t.webSocketDebuggerUrl);
  await c.ready; await c.send('Runtime.enable'); await sleep(2200);

  // Pointer le gestionnaire sur le vrai binaire MediaMTX, avec des ports libres.
  await c.evaluate(`window.streamcontrol.saveSettings({
    mediamtx: { binaryPath: ${JSON.stringify(MEDIAMTX_BINARY)}, configPath: "",
                rtmpPort: 21935, hlsPort: 28888, webrtcPort: 28889, rtspPort: 28554,
                streamPath: "live", autoStart: false, autoRestart: false }
  })`);

  const before = await c.evaluate('window.streamcontrol.getMediamtxStatus()');
  check('etat initial arrete', before.state === 'stopped', before.state);

  // --- Demarrage reel ----------------------------------------------------
  const startResult = await c.evaluate('window.streamcontrol.startMediamtx()');
  check('startMediamtx reussit avec un vrai binaire', startResult.ok === true, startResult.message ?? 'ok');
  check('etat passe a running', startResult.status?.state === 'running', startResult.status?.state);
  check('un PID est remonte', typeof startResult.status?.pid === 'number', `pid=${startResult.status?.pid}`);

  await sleep(1500);
  const rtmpOpen = await probe(21935);
  const hlsOpen = await probe(28888);
  check('le port RTMP configure ecoute reellement', rtmpOpen, ':21935');
  check('le port HLS configure ecoute reellement', hlsOpen, ':28888');

  // La configuration generee doit avoir ete ecrite dans le profil utilisateur.
  const cfgPath = path.join(userDataDir, 'mediamtx', 'mediamtx.yml');
  const cfgExists = fs.existsSync(cfgPath);
  check('configuration generee ecrite dans le profil', cfgExists, cfgPath);
  if (cfgExists) {
    const cfg = fs.readFileSync(cfgPath, 'utf8');
    check('la configuration reprend les ports choisis',
      cfg.includes(':21935') && cfg.includes(':28888'),
      cfg.split('\n').filter(l=>/Address/.test(l)).join(' '));
  }

  const running = await c.evaluate('window.streamcontrol.getMediamtxStatus()');
  check('getMediamtxStatus reflete l etat courant', running.state === 'running' && running.pid > 0, `state=${running.state}`);

  // --- Arret propre ------------------------------------------------------
  const stopResult = await c.evaluate('window.streamcontrol.stopMediamtx()');
  check('stopMediamtx reussit', stopResult.ok === true, stopResult.message ?? 'ok');
  await sleep(1200);
  const rtmpClosed = !(await probe(21935));
  check('le port est libere apres arret', rtmpClosed, rtmpClosed ? 'ferme' : 'encore ouvert');

  // --- Configuration invalide -------------------------------------------
  fs.writeFileSync('/tmp/bad-mediamtx.yml', 'ceci: [est: une: config: invalide\n  malformee\n', 'utf8');
  await c.evaluate(`window.streamcontrol.saveSettings({ mediamtx: { configPath: "/tmp/bad-mediamtx.yml" } })`);
  const badResult = await c.evaluate('window.streamcontrol.startMediamtx()');
  check('une configuration invalide est refusee proprement',
    badResult.ok === false && /refusee|invalide|valid/i.test(badResult.message ?? ''),
    (badResult.message ?? '').slice(0, 110));
  check('l etat passe en error sur configuration invalide',
    badResult.status?.state === 'error', badResult.status?.state);

  // --- Redemarrage apres retour a une config valide ---------------------
  await c.evaluate(`window.streamcontrol.saveSettings({ mediamtx: { configPath: "" } })`);
  const restart = await c.evaluate('window.streamcontrol.restartMediamtx()');
  check('restartMediamtx fonctionne apres correction', restart.ok === true, restart.status?.state);
  await c.evaluate('window.streamcontrol.stopMediamtx()');

  c.close();
} catch (e) {
  console.error('ERREUR:', e.message);
  results.push({n:'execution', ok:false});
} finally {
  child.kill('SIGTERM');
  await sleep(1500);
  if (!child.killed) child.kill('SIGKILL');
}

const failed = results.filter(r=>!r.ok);
console.log(`\n=== ${results.length-failed.length}/${results.length} verifications reussies ===`);
if (failed.length) { console.log('Echecs :', failed.map(f=>f.n).join(', ')); process.exitCode = 1; }
