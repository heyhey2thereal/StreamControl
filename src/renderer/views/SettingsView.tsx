import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LANGUAGES, THEMES } from '../../shared/i18n';
import type { AppSettings, StorageEntry } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Spinner } from '../components/Spinner';
import { Icon, type IconName } from '../components/Icon';

interface Draft {
  mediamtx: AppSettings['mediamtx'];
  obs: AppSettings['obs'];
  obsExecutablePath: string;
  overrideIPv4: string;
  refreshIntervalMs: number;
  maxLogLines: number;
  language: AppSettings['ui']['language'];
  theme: AppSettings['ui']['theme'];
  /** Conservees telles quelles : elles ne sont pas modifiees par ce formulaire. */
  dismissedUpdateVersion: string;
  urlsExpandedByDefault: boolean;
  obsTutorialOpen: boolean;
  onboardingDone: boolean;
  lockHash: string;
  lockSalt: string;
  lockHint: string;
  locked: boolean;
  storagePath: string;
  recording: AppSettings['recording'];
  replay: AppSettings['replay'];
  watch: AppSettings['watch'];
}

function toDraft(settings: AppSettings): Draft {
  return {
    mediamtx: { ...settings.mediamtx },
    obs: { ...settings.obs },
    obsExecutablePath: settings.obsExecutablePath,
    overrideIPv4: settings.network.overrideIPv4,
    refreshIntervalMs: settings.ui.refreshIntervalMs,
    maxLogLines: settings.ui.maxLogLines,
    language: settings.ui.language,
    theme: settings.ui.theme,
    dismissedUpdateVersion: settings.ui.dismissedUpdateVersion,
    urlsExpandedByDefault: settings.ui.urlsExpandedByDefault,
    obsTutorialOpen: settings.ui.obsTutorialOpen,
    onboardingDone: settings.ui.onboardingDone,
    lockHash: settings.ui.lockHash,
    lockSalt: settings.ui.lockSalt,
    lockHint: settings.ui.lockHint,
    locked: settings.ui.locked,
    storagePath: settings.files.storagePath,
    recording: { ...settings.recording },
    replay: { ...settings.replay },
    watch: { ...settings.watch },
  };
}

/** Categories de reglages, dans l'ordre d'affichage. */
const CATEGORIES = [
  'general',
  'network',
  'mediamtx',
  'obs',
  'recording',
  'replay',
  'automation',
  'files',
  'security',
  'updates',
] as const;

type CategoryId = (typeof CATEGORIES)[number];

const CATEGORY_LABEL: Record<CategoryId, string> = {
  general: 'settings.catGeneral',
  network: 'settings.catNetwork',
  mediamtx: 'settings.catMediamtx',
  obs: 'settings.catObs',
  recording: 'settings.catRecording',
  replay: 'settings.catReplay',
  automation: 'settings.catAutomation',
  files: 'settings.catFiles',
  security: 'settings.catSecurity',
  updates: 'settings.catUpdates',
};

/** Icones des categories, pour un repere visuel rapide. */
const CATEGORY_ICON: Record<CategoryId, IconName> = {
  general: 'general',
  network: 'network',
  mediamtx: 'streams',
  obs: 'obs',
  recording: 'recording',
  replay: 'replay',
  automation: 'macros',
  files: 'files',
  security: 'security',
  updates: 'updates',
};

/** Une section de reglages : sa categorie, son contenu, ses mots cles. */
interface Section {
  id: string;
  category: CategoryId;
  title: string;
  /** Texte sur lequel porte la recherche (titre + libelles + indices). */
  keywords: string;
  node: ReactNode;
}

export function SettingsView({ sc, onOpenLock }: { sc: StreamControl; onOpenLock: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(sc.settings ? toDraft(sc.settings) : null);
  const [storageEntries, setStorageEntries] = useState<StorageEntry[]>([]);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallMessage, setFirewallMessage] = useState('');
  const [recordingMessage, setRecordingMessage] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId>('general');

  // L'inventaire des fichiers est relu a l'ouverture et apres chaque changement
  // de dossier : il sert a montrer ou sont les fichiers, pas a les deplacer.
  const refreshStorage = async () => {
    setStorageEntries(await window.streamcontrol.storageList());
  };

  useEffect(() => {
    void refreshStorage();
  }, [sc.settings?.files.storagePath]);

  // Ouvre les ports dans le pare-feu Windows. La creation demande les droits
  // administrateur : un refus est signale, pas bloquant.
  const openFirewall = async () => {
    setFirewallBusy(true);
    try {
      const result = await window.streamcontrol.openFirewallPorts();
      setFirewallMessage(result.message);
      sc.notify(result.ok ? 'ok' : 'warn', result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFirewallMessage(message);
      sc.notify('err', message);
    } finally {
      setFirewallBusy(false);
    }
  };

  const pickStorageDir = async () => {
    const picked = await window.streamcontrol.storagePickDir();
    if (picked) patch({ storagePath: picked });
  };

  const pickRecordingDir = async () => {
    const picked = await window.streamcontrol.recordingPickDir();
    if (picked && draft) patch({ recording: { ...draft.recording, path: picked } });
  };

  const probeRecording = async () => {
    const result = await window.streamcontrol.recordingProbe();
    const message = result.ok
      ? t('recording.probeOk', { path: result.directory })
      : t('recording.probeFail', { message: result.message });
    setRecordingMessage(message);
    sc.notify(result.ok ? 'ok' : 'warn', message);
  };

  // Resynchronise le brouillon si les parametres changent ailleurs.
  useEffect(() => {
    if (sc.settings) setDraft(toDraft(sc.settings));
  }, [sc.settings]);

  // Recherche : filtre les reglages en direct. Une recherche vide affiche la
  // categorie choisie ; sinon, on cherche dans toutes les categories.
  const searching = query.trim().length > 0;
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (haystack: string): boolean =>
    !searching || haystack.toLowerCase().includes(normalizedQuery);

  const visibleCategories = useMemo(
    () => (searching ? new Set<CategoryId>(CATEGORIES) : new Set<CategoryId>([category])),
    [category, searching],
  );

  if (!draft) {
    return (
      <div className="content">
        <div className="loading-screen">
          <Spinner size={36} />
          <div className="muted">{t('settings.loading')}</div>
        </div>
      </div>
    );
  }

  const patch = (partial: Partial<Draft>) => setDraft({ ...draft, ...partial });

  const save = () =>
    void sc.saveSettings({
      mediamtx: draft.mediamtx,
      obs: draft.obs,
      obsExecutablePath: draft.obsExecutablePath,
      network: { overrideIPv4: draft.overrideIPv4 },
      ui: {
        refreshIntervalMs: draft.refreshIntervalMs,
        maxLogLines: draft.maxLogLines,
        language: draft.language,
        theme: draft.theme,
        dismissedUpdateVersion: draft.dismissedUpdateVersion,
        urlsExpandedByDefault: draft.urlsExpandedByDefault,
        obsTutorialOpen: draft.obsTutorialOpen,
        onboardingDone: draft.onboardingDone,
        // Le verrouillage a sa propre pop-up : ce formulaire ne doit pas
        // l'ecraser avec des valeurs vides.
        lockHash: draft.lockHash,
        lockSalt: draft.lockSalt,
        lockHint: draft.lockHint,
        locked: draft.locked,
      },
      files: { storagePath: draft.storagePath },
      recording: draft.recording,
      replay: draft.replay,
      watch: draft.watch,
      // Le Remote a son propre onglet : ce formulaire ne doit pas ecraser ses
      // reglages avec une valeur chargee au montage.
    });

  const pickExecutable = async (kind: 'mediamtx' | 'obs') => {
    const picked = await window.streamcontrol.browseForExecutable(kind);
    if (!picked) return;
    if (kind === 'mediamtx') patch({ mediamtx: { ...draft.mediamtx, binaryPath: picked } });
    else patch({ obsExecutablePath: picked });
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    hint?: string,
  ) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || 0)}
      />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );

  const sections: Section[] = [
    {
      id: 'appearance',
      category: 'general',
      title: t('settings.appearance'),
      keywords: `${t('settings.appearance')} langue language theme apparence ${t('settings.themeLight')} ${t('settings.themeDark')}`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.languageLabel')}</label>
            <select
              id="settings-language"
              className="input"
              value={draft.language}
              onChange={(event) => patch({ language: event.target.value as AppSettings['ui']['language'] })}
            >
              {Object.entries(LANGUAGES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <div className="hint">{t('settings.languageHint')}</div>
          </div>

          <div className="field">
            <label>{t('settings.themeLabel')}</label>
            <select
              id="settings-theme"
              className="input"
              value={draft.theme}
              onChange={(event) => patch({ theme: event.target.value as AppSettings['ui']['theme'] })}
            >
              {THEMES.map((code) => (
                <option key={code} value={code}>
                  {code === 'light' ? t('settings.themeLight') : t('settings.themeDark')}
                </option>
              ))}
            </select>
            <div className="hint">{t('settings.themeHint')}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'interface',
      category: 'general',
      title: t('settings.interface'),
      keywords: `${t('settings.interface')} rafraichissement refresh journal logs lignes url deplier tour visite`,
      node: (
        <div className="panel">
          <div className="grid grid-2">
            {numberField(t('settings.refresh'), draft.refreshIntervalMs, (value) =>
              patch({ refreshIntervalMs: value }), t('settings.refreshHint'))}
            {numberField(t('settings.maxLines'), draft.maxLogLines, (value) =>
              patch({ maxLogLines: value }), t('settings.maxLinesHint'))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.urlsExpandedByDefault}
              onChange={(event) => patch({ urlsExpandedByDefault: event.target.checked })}
            />
            {t('settings.urlsExpanded')}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.obsTutorialOpen}
              onChange={(event) => patch({ obsTutorialOpen: event.target.checked })}
            />
            {t('settings.obsTutorialOpen')}
          </label>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                // Rejouer la visite : on efface le drapeau puis on la relance.
                patch({ onboardingDone: false });
                void sc.saveSettings({ ui: { ...sc.settings?.ui, onboardingDone: false } as never });
                sc.startOnboarding();
              }}
            >
              {t('settings.replayTour')}
            </button>
          </div>
          <div className="hint">{t('settings.replayTourHint')}</div>
        </div>
      ),
    },
    {
      id: 'network',
      category: 'network',
      title: t('settings.networkPanel'),
      keywords: `${t('settings.networkPanel')} reseau network ip ipv4 adresse firewall pare-feu acces ports`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.forceIpv4')}</label>
            <select
              className="input"
              value={draft.overrideIPv4}
              onChange={(event) => patch({ overrideIPv4: event.target.value })}
            >
              <option value="">{t('settings.autoDetect')}</option>
              {(sc.preflight?.network.allIPv4 ?? []).map((address) => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </select>
            <div className="hint">{t('settings.forceIpv4Hint')}</div>
          </div>

          <div className="section-title">{t('settings.firewallTitle')}</div>
          <div className="hint">{t('settings.firewallHint')}</div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn primary"
              disabled={firewallBusy}
              onClick={() => void openFirewall()}
            >
              {firewallBusy ? (
                <>
                  <Spinner size={13} />
                  {t('settings.firewallWorking')}
                </>
              ) : (
                t('settings.firewallOpen')
              )}
            </button>
          </div>
          {firewallMessage ? <div className="hint">{firewallMessage}</div> : null}
        </div>
      ),
    },
    {
      id: 'mediamtx',
      category: 'mediamtx',
      title: t('settings.mediamtxPanel'),
      keywords: `${t('settings.mediamtxPanel')} mediamtx binaire executable config chemin port rtmp hls webrtc rtsp api pages demarrage redemarrage`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.mediamtxPath')}</label>
            <div className="input-row">
              <input
                className="input"
                value={draft.mediamtx.binaryPath}
                placeholder={t('settings.emptyMeansBundled')}
                onChange={(event) =>
                  patch({ mediamtx: { ...draft.mediamtx, binaryPath: event.target.value } })
                }
              />
              <button type="button" className="btn small" onClick={() => void pickExecutable('mediamtx')}>
                {t('settings.browse')}
              </button>
            </div>
            <div className="hint">{t('settings.mediamtxPathHint')}</div>
          </div>

          <div className="field">
            <label>{t('settings.mediamtxConfig')}</label>
            <div className="input-row">
              <input
                className="input"
                value={draft.mediamtx.configPath}
                placeholder={t('settings.emptyMeansGenerated')}
                onChange={(event) =>
                  patch({ mediamtx: { ...draft.mediamtx, configPath: event.target.value } })
                }
              />
            </div>
            <div className="hint">{t('settings.mediamtxConfigHint')}</div>
          </div>

          <div className="field">
            <label>{t('settings.streamPath')}</label>
            <input
              className="input"
              value={draft.mediamtx.streamPath}
              onChange={(event) => patch({ mediamtx: { ...draft.mediamtx, streamPath: event.target.value } })}
            />
            <div className="hint">{t('settings.streamPathHint')}</div>
          </div>

          <div className="grid grid-2">
            {numberField(t('settings.portRtmp'), draft.mediamtx.rtmpPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, rtmpPort: value } }), t('settings.portRtmpHint'))}
            {numberField(t('settings.portHls'), draft.mediamtx.hlsPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, hlsPort: value } }), t('settings.portHlsHint'))}
            {numberField(t('settings.portWebrtc'), draft.mediamtx.webrtcPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, webrtcPort: value } }), t('settings.portWebrtcHint'))}
            {numberField(t('settings.portRtsp'), draft.mediamtx.rtspPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, rtspPort: value } }), t('settings.portRtspHint'))}
            {numberField(t('settings.portApi'), draft.mediamtx.apiPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, apiPort: value } }), t('settings.portApiHint'))}
            {numberField(t('settings.portWebPages'), draft.mediamtx.webPagesPort, (value) =>
              patch({ mediamtx: { ...draft.mediamtx, webPagesPort: value } }), t('settings.portWebPagesHint'))}
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.mediamtx.autoStart}
              onChange={(event) =>
                patch({ mediamtx: { ...draft.mediamtx, autoStart: event.target.checked } })
              }
            />
            {t('settings.autoStartMediamtx')}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.mediamtx.autoRestart}
              onChange={(event) =>
                patch({ mediamtx: { ...draft.mediamtx, autoRestart: event.target.checked } })
              }
            />
            {t('settings.autoRestart')}
          </label>

          <div className="hint" style={{ marginTop: 12 }}>
            {t('settings.bundledNote')}
          </div>
        </div>
      ),
    },
    {
      id: 'obs',
      category: 'obs',
      title: t('settings.obsPanel'),
      keywords: `${t('settings.obsPanel')} obs studio websocket hote host port mot de passe connexion`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.obsPath')}</label>
            <div className="input-row">
              <input
                className="input"
                value={draft.obsExecutablePath}
                placeholder={t('settings.emptyMeansAuto')}
                onChange={(event) => patch({ obsExecutablePath: event.target.value })}
              />
              <button type="button" className="btn small" onClick={() => void pickExecutable('obs')}>
                {t('settings.browse')}
              </button>
            </div>
            <div className="hint">{t('settings.obsPathHint')}</div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>{t('settings.obsHost')}</label>
              <input
                className="input"
                value={draft.obs.host}
                onChange={(event) => patch({ obs: { ...draft.obs, host: event.target.value } })}
              />
            </div>
            {numberField(t('settings.obsPort'), draft.obs.port, (value) =>
              patch({ obs: { ...draft.obs, port: value } }), t('settings.obsPortHint'))}
          </div>

          <div className="field">
            <label>{t('settings.obsPassword')}</label>
            <input
              className="input"
              type="password"
              value={draft.obs.password}
              onChange={(event) => patch({ obs: { ...draft.obs, password: event.target.value } })}
            />
            <div className="hint">{t('settings.obsPasswordHint')}</div>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.obs.autoConnect}
              onChange={(event) => patch({ obs: { ...draft.obs, autoConnect: event.target.checked } })}
            />
            {t('settings.obsAutoConnect')}
          </label>
        </div>
      ),
    },
    {
      id: 'recording',
      category: 'recording',
      title: t('recording.title'),
      keywords: `${t('recording.title')} enregistrement recording dossier fichier segment format conservation retention rec`,
      node: (
        <div className="panel">
          <div className="hint">{t('recording.subtitle')}</div>
          <div className="hint">{t('recording.perStreamHint')}</div>

          <div className="field">
            <label>{t('recording.folder')}</label>
            <div className="input-row">
              <input
                className="input"
                value={draft.recording.path}
                placeholder={t('settings.emptyMeansDefault')}
                onChange={(event) =>
                  patch({ recording: { ...draft.recording, path: event.target.value } })
                }
              />
              <button type="button" className="btn small" onClick={() => void pickRecordingDir()}>
                {t('recording.choose')}
              </button>
            </div>
            <div className="hint">{t('recording.folderHint')}</div>
          </div>

          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => void sc.openRecording()}>
              {t('recording.openFolder')}
            </button>
            <button type="button" className="btn small ghost" onClick={() => void probeRecording()}>
              {t('recording.probe')}
            </button>
          </div>
          {recordingMessage ? <div className="hint">{recordingMessage}</div> : null}

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="field">
              <label>{t('recording.format')}</label>
              <select
                className="input"
                value={draft.recording.format}
                onChange={(event) =>
                  patch({
                    recording: { ...draft.recording, format: event.target.value as 'fmp4' | 'mpegts' },
                  })
                }
              >
                <option value="fmp4">fmp4</option>
                <option value="mpegts">mpegts</option>
              </select>
              <div className="hint">{t('recording.formatHint')}</div>
            </div>
            {numberField(t('recording.segment'), draft.recording.segmentMinutes, (value) =>
              patch({ recording: { ...draft.recording, segmentMinutes: value } }), t('recording.segmentHint'))}
            {numberField(t('recording.retain'), draft.recording.retainHours, (value) =>
              patch({ recording: { ...draft.recording, retainHours: value } }), t('recording.retainHint'))}
          </div>
        </div>
      ),
    },
    {
      id: 'replay',
      category: 'replay',
      title: t('replay.title'),
      keywords: `${t('replay.title')} replay instantane tampon dernieres secondes clip ralenti`,
      node: (
        <div className="panel">
          <div className="hint">{t('replay.subtitle')}</div>
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={draft.replay.enabled}
              onChange={(event) =>
                patch({ replay: { ...draft.replay, enabled: event.target.checked } })
              }
            />
            {t('replay.enable')}
          </label>
          {numberField(t('replay.buffer'), draft.replay.bufferSeconds, (value) =>
            patch({ replay: { ...draft.replay, bufferSeconds: value } }), t('replay.bufferHint'))}
          <div className="hint">
            {t('replay.disabledHint')}
          </div>
        </div>
      ),
    },
    {
      id: 'watch',
      category: 'automation',
      title: t('watch.title'),
      keywords: `${t('watch.title')} surveillance alerte probleme detection debit coupure bascule secours`,
      node: (
        <div className="panel">
          <div className="hint">{t('analysis.subtitle')}</div>
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={draft.watch.enabled}
              onChange={(event) =>
                patch({ watch: { ...draft.watch, enabled: event.target.checked } })
              }
            />
            {t('watch.enable')}
          </label>
          <div className="grid grid-2">
            {numberField(t('watch.lowBitrate'), draft.watch.lowBitrateKbps, (value) =>
              patch({ watch: { ...draft.watch, lowBitrateKbps: value } }), t('watch.lowBitrateHint'))}
            {numberField(t('watch.lowBitrateSeconds'), draft.watch.lowBitrateSeconds, (value) =>
              patch({ watch: { ...draft.watch, lowBitrateSeconds: value } }))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.watch.failoverToBackup}
              onChange={(event) =>
                patch({ watch: { ...draft.watch, failoverToBackup: event.target.checked } })
              }
            />
            {t('watch.failover')}
          </label>
          {draft.watch.failoverToBackup ? (
            <div className="field">
              <label>{t('watch.backupScene')}</label>
              <select
                className="input"
                value={draft.watch.backupScene}
                onChange={(event) => patch({ watch: { ...draft.watch, backupScene: event.target.value } })}
              >
                <option value="">{t('macro.pickScene')}</option>
                {sc.obs.scenes.map((scene) => (
                  <option key={scene.name} value={scene.name}>
                    {scene.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'files',
      category: 'files',
      title: t('settings.files'),
      keywords: `${t('settings.files')} fichiers dossier rangement inventaire ${t('settings.filesUsedTitle')}`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.filesFolder')}</label>
            <div className="input-row">
              <input
                className="input"
                value={draft.storagePath}
                placeholder={t('settings.emptyMeansDefault')}
                onChange={(event) => patch({ storagePath: event.target.value })}
              />
              <button type="button" className="btn small" onClick={() => void pickStorageDir()}>
                {t('settings.choose')}
              </button>
            </div>
            <div className="hint">{t('settings.filesHint')}</div>
            {sc.paths ? (
              <div className="hint">
                {t('settings.filesUsed')} <span className="mono">{sc.paths.storageDir}</span>
              </div>
            ) : null}
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => void sc.openStorage(draft.storagePath)}
            >
              {t('settings.openFolder')}
            </button>
          </div>

          <div className="section-title">{t('settings.detected')}</div>
          {storageEntries.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {t('settings.inventory')}
            </div>
          ) : (
            storageEntries.map((entry) => (
              <div className="tool-row" key={entry.key}>
                <div>
                  <strong>{entry.label}</strong>
                  <div className="tool-path">{entry.exists ? entry.current : t('settings.absent')}</div>
                </div>
                <span className={`badge ${entry.exists ? 'ok' : ''}`}>
                  {entry.exists ? t('settings.present') : t('settings.absent')}
                </span>
              </div>
            ))
          )}

          <div className="section-title">{t('settings.filesUsedTitle')}</div>
          <div className="tool-row">
            <div>
              <strong>{t('settings.settingsFile')}</strong>
              <div className="tool-path">{sc.paths?.settingsFile ?? t('settings.loadingShort')}</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'security',
      category: 'security',
      title: t('lock.settingsTitle'),
      keywords: `${t('lock.settingsTitle')} verrouillage securite mot de passe indice lock`,
      node: (
        <div className="panel">
          <div className="btn-row">
            <span className="badge">{sc.lock.hasPassword ? t('lock.stateOn') : t('lock.stateOff')}</span>
            <button type="button" className="btn small primary" onClick={onOpenLock}>
              {sc.lock.hasPassword ? t('lock.lockNow') : t('lock.define')}
            </button>
          </div>
          <div className="hint">{t('lock.movedToDialog')}</div>
        </div>
      ),
    },
    {
      id: 'updates',
      category: 'updates',
      title: t('settings.updates'),
      keywords: `${t('settings.updates')} mise a jour update version installeur telecharger`,
      node: (
        <div className="panel">
          <div className="field">
            <label>{t('settings.checkUpdate')}</label>
            <div className="input-row">
              <button type="button" className="btn small" onClick={() => void sc.checkUpdate(true)}>
                {t('settings.checkUpdate')}
              </button>
            </div>
            <div className="hint">{t('settings.checkUpdateHint')}</div>
          </div>
        </div>
      ),
    },
  ];

  const sectionText = (section: Section) => `${section.title} ${section.keywords}`;
  const visibleSections = sections.filter(
    (section) => visibleCategories.has(section.category) && matches(sectionText(section)),
  );

  const usedCategories = searching
    ? CATEGORIES.filter((id) =>
        sections.some((section) => section.category === id && matches(sectionText(section))),
      )
    : CATEGORIES;

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.settings')}</h1>
          <div className="topbar-sub">{t('settings.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn small ghost" onClick={() => void sc.resetSettings()}>
            {t('settings.reset')}
          </button>
          <button type="button" className="btn small primary" onClick={save}>
            {t('settings.save')}
          </button>
        </div>
      </div>

      <div className="settings-toolbar">
        <input
          id="settings-search"
          className="input"
          type="search"
          value={query}
          placeholder={t('settings.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="settings-categories">
          {usedCategories.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip${!searching && category === id ? ' active' : ''}`}
              onClick={() => {
                setQuery('');
                setCategory(id);
              }}
            >
              <span className="chip-icon" aria-hidden>
                <Icon name={CATEGORY_ICON[id]} size={15} />
              </span>
              {t(CATEGORY_LABEL[id] as never)}
            </button>
          ))}
        </div>
      </div>

      {visibleSections.length === 0 ? (
        <div className="panel">
          <div className="muted">{t('settings.searchNoResult')}</div>
        </div>
      ) : (
        visibleSections.map((section) => (
          <div key={section.id}>
            <div className="section-title">{section.title}</div>
            {section.node}
          </div>
        ))
      )}
    </div>
  );
}
