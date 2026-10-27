import { useEffect, useState } from 'react';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { StatusLed } from '../components/StatusLed';

type ViewId = 'dashboard' | 'streams' | 'services' | 'urls' | 'obs' | 'logs' | 'settings' | 'guide';

interface Props {
  sc: StreamControl;
  onNavigate: (view: ViewId) => void;
}

type PreviewMode = 'off' | 'live';

/** Intervalle de changement de flux quand plusieurs sont en direct. */
const PREVIEW_ROTATE_MS = 5000;

/**
 * Apercu des flux en direct.
 *
 * L'image vient de la meme page de lecture que la fenetre de lecture, servie
 * en version reduite : elle seule sait lire le HLS faible latence. On ne
 * reecrit donc pas de lecteur ici, et le comportement est identique partout.
 *
 * Quand plusieurs adresses publient, l'apercu les parcourt a tour de role.
 */
function StreamPreview({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PreviewMode>('off');
  /** Index du flux affiche, dans la liste des flux en direct. */
  const [index, setIndex] = useState(0);

  // Seules les adresses qui publient reellement ont une image a montrer.
  const live = sc.streams.filter((endpoint) => endpoint.status.publishing);
  const current = live.length > 0 ? live[index % live.length] : null;

  // Un flux disparait : on revient au premier pour ne pas pointer sur une
  // adresse qui n'existe plus.
  useEffect(() => {
    if (index >= live.length) setIndex(0);
  }, [index, live.length]);

  // Rotation : on change de flux toutes les cinq secondes, uniquement quand il
  // y en a plusieurs.
  useEffect(() => {
    if (live.length < 2) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % live.length), PREVIEW_ROTATE_MS);
    return () => clearInterval(timer);
  }, [live.length]);

  const running = sc.mediamtx.state === 'running';

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t('dashboard.preview')}</h2>
        <div className="btn-row">
          <button
            type="button"
            className={`btn small${mode === 'live' ? ' primary' : ''}`}
            disabled={!running}
            onClick={() => setMode(mode === 'live' ? 'off' : 'live')}
          >
            {mode === 'live' ? t('dashboard.previewStop') : t('dashboard.previewStart')}
          </button>
        </div>
      </div>

      <div className="preview">
        {mode === 'live' && current ? (
          <iframe
            key={current.urls.embed}
            className="preview-frame"
            src={current.urls.embed}
            title={current.name}
            allow="autoplay"
          />
        ) : null}

        {mode === 'off' ? (
          <div className="preview-empty">
            <div className="big">&#9635;</div>
            <div>{running ? t('dashboard.previewHint') : t('dashboard.previewHintMediamtx')}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {t('dashboard.latency')}
            </div>
          </div>
        ) : null}

        {mode === 'live' && live.length === 0 ? (
          <div className="preview-empty">
            <div className="big">&#9635;</div>
            <div>{t('dashboard.previewNoLive')}</div>
          </div>
        ) : null}

        <div className="preview-overlay">
          {current ? <span className="badge live">{current.name}</span> : <span className="badge ok">HLS</span>}
        </div>
        <div className="preview-overlay right">
          {live.length > 1 ? (
            <span className="badge">
              {t('dashboard.previewRotation', { index: (index % live.length) + 1, total: live.length })}
            </span>
          ) : null}
          {sc.obs.streaming ? <span className="badge live">OBS live</span> : null}
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ sc, onNavigate }: Props) {
  const { t } = useTranslation();
  const preflight = sc.preflight;
  const mediamtxTool = preflight?.tools.find((tool) => tool.kind === 'mediamtx');
  const obsTool = preflight?.tools.find((tool) => tool.kind === 'obs');
  const portsInUse = preflight?.ports.filter((port) => port.inUse) ?? [];

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.dashboard')}</h1>
          <div className="topbar-sub">
            {preflight?.network.primaryIPv4
              ? t('dashboard.subtitle', {
                  ip: preflight.network.primaryIPv4,
                  host: preflight.network.hostname,
                })
              : t('dashboard.noIpv4')}
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn small ghost" onClick={() => void sc.refreshPreflight(true)}>
            {t('action.refresh')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => void sc.copy(preflight?.network.primaryIPv4 ?? '', 'IP')}
            disabled={!preflight?.network.primaryIPv4}
          >
            {t('dashboard.copyIp')}
          </button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <div className="panel">
          <div className="stat-label">{t('dashboard.mediamtx')}</div>
          <div className="stat-value" style={{ color: sc.mediamtx.state === 'running' ? 'var(--ok)' : undefined }}>
            {sc.mediamtx.state === 'running' ? t('dashboard.live') : sc.mediamtx.state.toUpperCase()}
          </div>
          <StatusLed state={sc.mediamtx.state} label={t('nav.services')} />
        </div>

        <div className="panel">
          <div className="stat-label">{t('dashboard.obs')}</div>
          <div className="stat-value" style={{ color: sc.obs.connected ? 'var(--ok)' : undefined }}>
            {sc.obs.connected ? t('state.connected').toUpperCase() : t('dashboard.offline')}
          </div>
          <StatusLed state={sc.obs.connected ? 'connected' : 'disconnected'} label="WebSocket" />
        </div>

        <div className="panel">
          <div className="stat-label">{t('dashboard.localAddress')}</div>
          <div className="stat-value">{preflight?.network.primaryIPv4 ?? '--'}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {t('dashboard.interfaces', { count: preflight?.network.allIPv4.length ?? 0 })}
          </div>
        </div>

        <div className="panel">
          <div className="stat-label">{t('dashboard.obsOutput')}</div>
          <div className="stat-value">
            {sc.obs.streaming
              ? t('dashboard.liveUpper')
              : sc.obs.recording
                ? t('dashboard.recUpper')
                : t('dashboard.idleUpper')}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {sc.obs.currentScene
              ? t('obs.activeScene', { name: sc.obs.currentScene })
              : t('common.none')}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <StreamPreview sc={sc} />

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('dashboard.quick')}</h2>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={sc.mediamtx.state === 'starting' || sc.mediamtx.state === 'stopping'}
              onClick={() => void (sc.mediamtx.state === 'running' ? sc.stopMediamtx() : sc.startMediamtx())}
            >
              {sc.mediamtx.state === 'running' ? t('dashboard.stopMediamtx') : t('dashboard.startMediamtx')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={sc.mediamtx.state === 'starting' || sc.mediamtx.state === 'stopping'}
              onClick={() => void sc.restartMediamtx()}
            >
              {t('dashboard.restartMediamtx')}
            </button>
            <button type="button" className="btn" onClick={() => void sc.launchObs()}>
              {t('dashboard.launchObs')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void (sc.obs.connected ? sc.obsDisconnect() : sc.obsConnect())}
            >
              {sc.obs.connected ? t('dashboard.disconnectObs') : t('dashboard.connectObs')}
            </button>
            <button type="button" className="btn ghost" onClick={() => onNavigate('urls')}>
              {t('dashboard.viewUrls')}
            </button>
          </div>

          <div className="section-title">{t('dashboard.components')}</div>
          <div className="tool-row">
            <div>
              <strong>MediaMTX</strong>
              <div className="tool-path">{mediamtxTool?.path ?? t('dashboard.notDetected')}</div>
            </div>
            <span className={`badge ${mediamtxTool?.found ? 'ok' : 'err'}`}>
              {mediamtxTool?.found
                ? mediamtxTool.origin === 'bundled'
                  ? t('dashboard.bundled')
                  : t('dashboard.detected')
                : t('dashboard.absent')}
            </span>
          </div>
          <div className="tool-row">
            <div>
              <strong>OBS Studio</strong>
              <div className="tool-path">{obsTool?.path ?? t('dashboard.notDetected')}</div>
            </div>
            <span className={`badge ${obsTool?.found ? 'ok' : 'warn'}`}>
              {obsTool?.found ? t('dashboard.detected') : t('dashboard.absent')}
            </span>
          </div>
          <div className="tool-row">
            <div>
              <strong>{t('dashboard.portsUsed')}</strong>
              <div className="tool-path">
                {portsInUse.length === 0
                  ? t('dashboard.noConflict')
                  : portsInUse.map((port) => `${port.label} (${port.port})`).join(', ')}
              </div>
            </div>
            <span className={`badge ${portsInUse.length === 0 ? 'ok' : 'warn'}`}>
              {portsInUse.length === 0 ? t('dashboard.free') : t('dashboard.alerts', { count: portsInUse.length })}
            </span>
          </div>

          {mediamtxTool?.found === false ? (
            <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
              <div>{t('dashboard.mediamtxMissing')}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
