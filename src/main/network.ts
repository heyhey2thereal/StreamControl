import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import type { NetworkInfo, PortCheckResult } from '../shared/types';

/**
 * Adaptateurs virtuels qui ne correspondent pas au reseau du LAN.
 * Les adresses qu'ils portent sont inutilisables depuis la camera.
 */
const VIRTUAL_ADAPTER_PATTERNS = [
  /virtual/i,
  /vmware/i,
  /vbox/i,
  /hyper-?v/i,
  /docker/i,
  /wsl/i,
  /loopback/i,
  /tailscale/i,
  /zerotier/i,
  /radmin/i,
  /hamachi/i,
  /bluetooth/i,
  /tap-?windows/i,
  /npcap/i,
];

function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name));
}

function isUsableIPv4(address: string): boolean {
  if (net.isIPv4(address) !== true) return false;
  if (address.startsWith('169.254.')) return false; // APIPA : pas de bail DHCP
  if (address.startsWith('127.')) return false;
  return true;
}

/** Score de preference : les plages privees usuelles d'un LAN d'abord. */
function scoreAddress(address: string): number {
  if (address.startsWith('192.168.')) return 100;
  if (address.startsWith('10.')) return 90;
  const match = /^172\.(\d+)\./.exec(address);
  if (match) {
    const second = Number.parseInt(match[1], 10);
    if (second >= 16 && second <= 31) return 80;
  }
  return 10; // adresse publique ou plage exotique
}

interface Candidate {
  address: string;
  score: number;
}

function collectCandidates(): Candidate[] {
  const interfaces = os.networkInterfaces();
  const candidates: Candidate[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    const virtual = isVirtualAdapter(name);
    for (const entry of entries) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4') continue;
      if (!isUsableIPv4(entry.address)) continue;
      // Une carte virtuelle reste candidate, mais toujours derriere une carte physique.
      const penalty = virtual ? 1000 : 0;
      candidates.push({ address: entry.address, score: scoreAddress(entry.address) - penalty });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function getNetworkInfo(overrideIPv4?: string): NetworkInfo {
  const candidates = collectCandidates();
  const allIPv4 = [...new Set(candidates.map((c) => c.address))];

  const override = (overrideIPv4 ?? '').trim();
  const primary = override && net.isIPv4(override) ? override : (allIPv4[0] ?? null);

  return {
    primaryIPv4: primary,
    allIPv4,
    hostname: os.hostname(),
  };
}

/** Verifie si un port est deja pris sur la machine locale. */
export function isPortInUse(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen({ port, host, exclusive: true });
  });
}

/** Teste l'accessibilite TCP d'un service distant. */
export function isTcpReachable(
  host: string,
  port: number,
  timeoutMs = 1200,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function checkPorts(
  ports: Array<{ port: number; label: string }>,
): Promise<PortCheckResult[]> {
  return Promise.all(
    ports.map(async ({ port, label }) => ({
      port,
      label,
      inUse: await isPortInUse(port),
    })),
  );
}

/** Liste les IPv4 locales via PowerShell, en secours si os.networkInterfaces est pauvre. */
export function listIPv4ViaPowerShell(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress",
      ],
      { timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => net.isIPv4(line)),
        );
      },
    );
  });
}
