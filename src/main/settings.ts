import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/types';
import { sanitizeMacroActions } from '../shared/macro-sanitize';
import type { Logger } from './logger';

export const SETTINGS_VERSION = 1;

export function defaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    network: {
      overrideIPv4: '',
    },
    mediamtx: {
      binaryPath: '',
      configPath: '',
      rtmpPort: 1935,
      hlsPort: 8888,
      webrtcPort: 8889,
      rtspPort: 8554,
      apiPort: 9997,
      webPagesPort: 8080,
      streamPath: 'live',
      autoStart: false,
      autoRestart: true,
    },
    obs: {
      host: '127.0.0.1',
      port: 4455,
      password: '',
      autoConnect: false,
    },
    obsExecutablePath: '',
    streams: [],
    ui: {
      refreshIntervalMs: 5000,
      maxLogLines: 500,
      language: 'fr',
      theme: 'dark',
      dismissedUpdateVersion: '',
      lockHash: '',
      lockSalt: '',
      lockHint: '',
      locked: false,
      urlsExpandedByDefault: false,
      obsTutorialOpen: false,
      onboardingDone: false,
    },
    files: {
      storagePath: '',
    },
    recording: {
      path: '',
      format: 'fmp4',
      segmentMinutes: 60,
      retainHours: 24,
    },
    remote: {
      enabled: false,
      requireApproval: true,
      passwordHash: '',
      passwordSalt: '',
      devices: [],
    },
    replay: {
      enabled: false,
      bufferSeconds: 30,
      path: '',
    },
    watch: {
      enabled: true,
      lowBitrateKbps: 800,
      lowBitrateSeconds: 8,
      failoverToBackup: false,
      backupScene: '',
    },
    macros: [],
    showRunner: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fusionne recursivement une source partielle dans une base de reference.
 * Les tableaux sont remplaces (jamais fusionnes) et les cles inconnues ignorees.
 */
function mergeInto<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T)) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (!(key in result)) continue;
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeInto(baseValue, patchValue);
    } else if (patchValue !== undefined) {
      result[key] = patchValue;
    }
  }
  return result as T;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Applique les contraintes de domaine apres une fusion. */
export function sanitizeSettings(settings: AppSettings): AppSettings {
  const clean = mergeInto(defaultSettings(), settings);

  clean.mediamtx.rtmpPort = clampNumber(clean.mediamtx.rtmpPort, 1935, 1, 65535);
  clean.mediamtx.hlsPort = clampNumber(clean.mediamtx.hlsPort, 8888, 1, 65535);
  clean.mediamtx.webrtcPort = clampNumber(clean.mediamtx.webrtcPort, 8889, 1, 65535);
  clean.mediamtx.rtspPort = clampNumber(clean.mediamtx.rtspPort, 8554, 1, 65535);
  clean.mediamtx.apiPort = clampNumber(clean.mediamtx.apiPort, 9997, 1, 65535);
  clean.mediamtx.webPagesPort = clampNumber(clean.mediamtx.webPagesPort, 8080, 1, 65535);
  clean.mediamtx.streamPath =
    String(clean.mediamtx.streamPath || 'live').replace(/[^\w\-./]/g, '').replace(/^\/+|\/+$/g, '') || 'live';
  clean.mediamtx.binaryPath = String(clean.mediamtx.binaryPath ?? '').trim();
  clean.mediamtx.configPath = String(clean.mediamtx.configPath ?? '').trim();
  clean.mediamtx.autoStart = Boolean(clean.mediamtx.autoStart);
  clean.mediamtx.autoRestart = Boolean(clean.mediamtx.autoRestart);

  clean.obs.host = String(clean.obs.host || '127.0.0.1').trim();
  clean.obs.port = clampNumber(clean.obs.port, 4455, 1, 65535);
  clean.obs.password = String(clean.obs.password ?? '');
  clean.obs.autoConnect = Boolean(clean.obs.autoConnect);

  clean.obsExecutablePath = String(clean.obsExecutablePath ?? '').trim();

  clean.streams = Array.isArray(clean.streams) ? clean.streams : [];
  clean.network.overrideIPv4 = String(clean.network.overrideIPv4 ?? '').trim();

  clean.recording.path = String(clean.recording.path ?? '').trim();
  clean.recording.format = clean.recording.format === 'mpegts' ? 'mpegts' : 'fmp4';
  clean.recording.segmentMinutes = clampNumber(clean.recording.segmentMinutes, 60, 1, 1440);
  clean.recording.retainHours = clampNumber(clean.recording.retainHours, 24, 0, 8760);

  clean.remote.enabled = Boolean(clean.remote.enabled);
  clean.remote.requireApproval = clean.remote.requireApproval !== false;
  clean.remote.passwordHash = String(clean.remote.passwordHash ?? '').trim();
  clean.remote.passwordSalt = String(clean.remote.passwordSalt ?? '').trim();
  clean.remote.devices = Array.isArray(clean.remote.devices)
    ? clean.remote.devices
        .filter((device) => device && typeof device.token === 'string' && device.token)
        .map((device) => ({
          token: String(device.token),
          name: String(device.name ?? 'Appareil'),
          address: device.address ? String(device.address) : undefined,
          addedAt: Number.isFinite(device.addedAt) ? Number(device.addedAt) : Date.now(),
          lastSeenAt: Number.isFinite(device.lastSeenAt) ? Number(device.lastSeenAt) : undefined,
        }))
    : [];

  clean.replay.enabled = Boolean(clean.replay.enabled);
  clean.replay.bufferSeconds = clampNumber(clean.replay.bufferSeconds, 30, 5, 600);
  clean.replay.path = String(clean.replay.path ?? '').trim();

  clean.watch.enabled = clean.watch.enabled !== false;
  clean.watch.lowBitrateKbps = clampNumber(clean.watch.lowBitrateKbps, 800, 0, 100000);
  clean.watch.lowBitrateSeconds = clampNumber(clean.watch.lowBitrateSeconds, 8, 2, 120);
  clean.watch.failoverToBackup = Boolean(clean.watch.failoverToBackup);
  clean.watch.backupScene = String(clean.watch.backupScene ?? '').trim();

  clean.macros = Array.isArray(clean.macros)
    ? clean.macros
        .filter((macro) => macro && typeof macro.id === 'string' && Array.isArray(macro.actions))
        .map((macro) => ({
          id: String(macro.id),
          name: String(macro.name ?? 'Macro'),
          actions: sanitizeMacroActions(macro.actions),
          triggers: Array.isArray(macro.triggers)
            ? macro.triggers
                .filter((trigger) => trigger && typeof trigger.kind === 'string')
                .map((trigger) => ({
                  kind: trigger.kind,
                  path: trigger.path ? String(trigger.path) : undefined,
                  alertKind: trigger.alertKind ? String(trigger.alertKind) : undefined,
                  at: trigger.at ? String(trigger.at) : undefined,
                }))
            : [],
          disabled: Boolean(macro.disabled),
          createdAt: Number.isFinite(macro.createdAt) ? Number(macro.createdAt) : Date.now(),
        }))
    : [];

  clean.showRunner = Array.isArray(clean.showRunner)
    ? clean.showRunner
        .filter((step) => step && typeof step.id === 'string')
        .map((step) => ({
          id: String(step.id),
          name: String(step.name ?? 'Etape'),
          at: String(step.at ?? ''),
          notes: String(step.notes ?? ''),
          done: Boolean(step.done),
          actions: sanitizeMacroActions(step.actions),
        }))
    : [];

  clean.ui.refreshIntervalMs = clampNumber(clean.ui.refreshIntervalMs, 5000, 1000, 60000);
  clean.ui.maxLogLines = clampNumber(clean.ui.maxLogLines, 500, 100, 5000);
  clean.ui.language = clean.ui.language === 'en' ? 'en' : 'fr';
  clean.ui.theme = clean.ui.theme === 'light' ? 'light' : 'dark';
  clean.ui.dismissedUpdateVersion = String(clean.ui.dismissedUpdateVersion ?? '').trim();
  clean.ui.lockHash = String(clean.ui.lockHash ?? '').trim();
  clean.ui.lockSalt = String(clean.ui.lockSalt ?? '').trim();
  clean.ui.lockHint = String(clean.ui.lockHint ?? '').trim();
  clean.ui.locked = Boolean(clean.ui.locked);
  clean.ui.urlsExpandedByDefault = Boolean(clean.ui.urlsExpandedByDefault);
  clean.ui.obsTutorialOpen = Boolean(clean.ui.obsTutorialOpen);
  clean.ui.onboardingDone = Boolean(clean.ui.onboardingDone);

  clean.version = SETTINGS_VERSION;
  return clean;
}

export class SettingsStore extends EventEmitter {
  private readonly filePath: string;
  private settings: AppSettings;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly logger: Logger) {
    super();
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = defaultSettings();
  }

  get path(): string {
    return this.filePath;
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.settings = sanitizeSettings(mergeInto(defaultSettings(), parsed));
      this.logger.info('settings', `Parametres charges depuis ${this.filePath}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.settings = defaultSettings();
        this.logger.info('settings', 'Aucun fichier de parametres, valeurs par defaut appliquees.');
        await this.persist();
      } else {
        this.settings = defaultSettings();
        this.logger.errorFrom('settings', error, 'Lecture des parametres impossible, valeurs par defaut retablies');
        await this.persist();
      }
    }

    this.logger.setMaxEntries(this.settings.ui.maxLogLines);
    this.emit('changed', this.get());
    return this.get();
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = sanitizeSettings(mergeInto(this.settings, patch));
    this.logger.setMaxEntries(this.settings.ui.maxLogLines);
    await this.persist();
    this.emit('changed', this.get());
    return this.get();
  }

  async reset(): Promise<AppSettings> {
    this.settings = defaultSettings();
    this.logger.setMaxEntries(this.settings.ui.maxLogLines);
    await this.persist();
    this.emit('changed', this.get());
    this.logger.info('settings', 'Parametres reinitialises.');
    return this.get();
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.settings, null, 2)}\n`;
    const tmpPath = `${this.filePath}.tmp`;
    // Serialise les ecritures pour eviter deux renommages concurrents.
    this.writeChain = this.writeChain.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(tmpPath, payload, 'utf8');
        await fs.rename(tmpPath, this.filePath);
      } catch (error) {
        this.logger.errorFrom('settings', error, 'Ecriture des parametres impossible');
      }
    });
    return this.writeChain;
  }
}
