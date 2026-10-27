import { useEffect, useState } from 'react';
import { LANGUAGES, THEMES } from '../../shared/i18n';
import type { AppSettings, StorageEntry } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Spinner } from '../components/Spinner';

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
  };
}

export function SettingsView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(sc.settings ? toDraft(sc.settings) : null);
  const [storageEntries, setStorageEntries] = useState<StorageEntry[]>([]);
  const [lockPassword, setLockPassword] = useState('');
  const [lockHint, setLockHint] = useState('');
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallMessage, setFirewallMessage] = useState('');

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

  // Resynchronise le brouillon si les parametres changent ailleurs.
  useEffect(() => {
    if (sc.settings) setDraft(toDraft(sc.settings));
  }, [sc.settings]);

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
        // Le verrouillage a son propre panneau : ce formulaire ne doit pas
        // l'ecraser avec des valeurs vides.
        lockHash: draft.lockHash,
        lockSalt: draft.lockSalt,
        lockHint: draft.lockHint,
        locked: draft.locked,
      },
      files: { storagePath: draft.storagePath },
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

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('settings.mediamtxPanel')}</h2>
          </div>

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

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('settings.obsPanel')}</h2>
          </div>

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

          <div className="section-title">{t('settings.interface')}</div>
          <div className="grid grid-2">
            {numberField(t('settings.refresh'), draft.refreshIntervalMs, (value) =>
              patch({ refreshIntervalMs: value }), t('settings.refreshHint'))}
            {numberField(t('settings.maxLines'), draft.maxLogLines, (value) =>
              patch({ maxLogLines: value }), t('settings.maxLinesHint'))}
          </div>

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
        </div>
      </div>

      <div className="section-title">{t('settings.appearance')}</div>
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

      <div className="section-title">{t('settings.updates')}</div>
      <div className="panel">
        <div className="field">
          <label>{t('settings.checkUpdate')}</label>
          <div className="input-row">
            <button
              type="button"
              className="btn small"
              onClick={() => void sc.checkUpdate(true)}
            >
              {t('settings.checkUpdate')}
            </button>
          </div>
          <div className="hint">{t('settings.checkUpdateHint')}</div>
        </div>
      </div>

      <div className="section-title">{t('settings.interface')}</div>
      <div className="panel">
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

      <div className="section-title">{t('lock.settingsTitle')}</div>
      <div className="panel">
        <div className="field">
          <label>{t('lock.password')}</label>
          <input
            id="settings-lock-password"
            className="input mono"
            type="password"
            value={lockPassword}
            autoComplete="off"
            placeholder={sc.lock.hasPassword ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}
            onChange={(event) => setLockPassword(event.target.value)}
          />
          <div className="hint">{t('lock.passwordHint')}</div>
        </div>
        <div className="field">
          <label>{t('lock.hint')}</label>
          <input
            id="settings-lock-hint"
            className="input"
            value={lockHint}
            placeholder={sc.lock.hint}
            onChange={(event) => setLockHint(event.target.value)}
          />
          <div className="hint">{t('lock.hintHint')}</div>
        </div>
        <div className="btn-row">
          <span className="badge">{sc.lock.hasPassword ? t('lock.stateOn') : t('lock.stateOff')}</span>
          <button
            type="button"
            className="btn small primary"
            disabled={lockPassword.trim().length < 4}
            onClick={() => void sc.setLockPassword(lockPassword, lockHint)}
          >
            {t('lock.set')}
          </button>
          {sc.lock.hasPassword ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void sc.setLockPassword('', '')}
            >
              {t('lock.remove')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="section-title">{t('settings.files')}</div>
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
      </div>

      <div className="section-title">{t('settings.filesUsedTitle')}</div>
      <div className="panel">
        <div className="tool-row">
          <div>
            <strong>{t('settings.settingsFile')}</strong>
            <div className="tool-path">{sc.paths?.settingsFile ?? t('settings.loadingShort')}</div>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void sc.openExternal('https://github.com/bluenviron/mediamtx/releases')}
          >
            {t('settings.releases')}
          </button>
        </div>
        {storageEntries.map((entry) => (
          <div className="tool-row" key={`file-${entry.key}`}>
            <div>
              <strong>{entry.label}</strong>
              <div className="tool-path">{entry.exists ? entry.current : t('settings.notCreated')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
