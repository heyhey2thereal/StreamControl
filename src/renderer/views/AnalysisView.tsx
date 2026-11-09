import { useEffect, useState } from 'react';
import type { StreamDiagnostics, WatchAlert } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';

/** Libelle et classe d'une alerte, selon sa nature. */
function alertStyle(kind: WatchAlert['kind']): string {
  if (kind === 'offline') return 'err';
  if (kind === 'low-bitrate') return 'warn';
  return 'ok';
}

/** Formatte une duree en secondes. */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/**
 * Onglet Analyse.
 *
 * Deux parties : les **alertes** de surveillance (une camera qui tombe, un
 * debit qui chute), et l'**analyse technique** de chaque flux (debit, sa
 * stabilite, resolution reelle, coupures). L'objectif : reperer un flux qui
 * semble fonctionner alors que l'image saccade.
 */
export function AnalysisView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);
  const [rows, setRows] = useState<StreamDiagnostics[]>([]);

  const reload = async () => {
    setAlerts(await window.streamcontrol.watchAlerts());
    setRows(await window.streamcontrol.diagnosticsList());
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, []);

  const pending = alerts.filter((alert) => !alert.acknowledged).length;

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.analysis')}</h1>
          <div className="topbar-sub">{t('analysis.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          {pending > 0 ? (
            <button
              type="button"
              className="btn small"
              onClick={() => void window.streamcontrol.watchAcknowledge().then(reload)}
            >
              {t('watch.acknowledge')}
            </button>
          ) : null}
          <button type="button" className="btn small ghost" onClick={() => void window.streamcontrol.watchReset().then(reload)}>
            {t('watch.reset')}
          </button>
        </div>
      </div>

      {/* --- Alertes ---------------------------------------------------- */}
      <div className="section-title">
        {t('watch.title')}
        {pending > 0 ? <span className="badge err" style={{ marginLeft: 8 }}>{pending}</span> : null}
      </div>
      <div className="panel">
        {alerts.length === 0 ? (
          <div className="muted">{t('watch.empty')}</div>
        ) : (
          alerts.slice(0, 40).map((alert) => (
            <div className="tool-row" key={alert.id}>
              <div>
                <strong style={{ fontSize: 12.5 }}>
                  <span className={`badge ${alertStyle(alert.kind)}`} style={{ marginRight: 8 }}>
                    {t(`watch.kind.${alert.kind}` as never)}
                  </span>
                  {alert.message}
                </strong>
                <div className="tool-path">{new Date(alert.at).toLocaleTimeString()}</div>
              </div>
              {!alert.acknowledged ? <span className="badge warn">{t('watch.new')}</span> : null}
            </div>
          ))
        )}
      </div>

      {/* --- Analyse technique ------------------------------------------ */}
      <div className="section-title">{t('analysis.title')}</div>
      {rows.length === 0 ? (
        <div className="panel">
          <div className="muted">{t('analysis.empty')}</div>
        </div>
      ) : (
        rows.map((row) => (
          <div className="panel" key={row.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ flex: 1 }}>{row.name}</strong>
              <span className={`badge ${row.publishing ? 'live' : ''}`}>
                {row.publishing ? t('state.live') : t('state.offline')}
              </span>
              {row.publishing ? (
                <span className={`badge ${row.stable ? 'ok' : 'warn'}`}>
                  {row.stable ? t('analysis.stable') : t('analysis.unstable')}
                </span>
              ) : null}
            </div>
            <div className="tool-path" style={{ marginTop: 2 }}>
              /{row.path}
            </div>

            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <div className="stat">
                <span className="stat-label">{t('analysis.bitrate')}</span>
                <span className="stat-value-sm">
                  {row.bitrateKbps > 0 ? `${row.bitrateKbps} kbit/s` : '--'}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('analysis.resolution')}</span>
                <span className="stat-value-sm">
                  {row.width && row.height ? `${row.width}x${row.height}` : '--'}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('analysis.minMax')}</span>
                <span className="stat-value-sm">
                  {row.bitrateKbps > 0 ? `${row.minBitrateKbps} - ${row.maxBitrateKbps}` : '--'}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('analysis.jitter')}</span>
                <span className={`stat-value-sm${row.stable ? ' ok' : ''}`}>
                  {row.bitrateKbps > 0 ? `${Math.round(row.bitrateJitter * 100)} %` : '--'}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('analysis.outages')}</span>
                <span className={`stat-value-sm${row.outages > 0 ? ' err' : ''}`}>{row.outages}</span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('analysis.session')}</span>
                <span className="stat-value-sm">{formatDuration(row.sessionSeconds)}</span>
              </div>
            </div>
          </div>
        ))
      )}

      {/* --- Replay ----------------------------------------------------- */}
      <div className="section-title">{t('replay.title')}</div>
      <div className="panel">
        <div className="hint">{t('replay.subtitle')}</div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn small primary" onClick={() => void sc.saveReplayLatest()}>
            <Icon name="replay" size={14} /> {t('replay.saveLatest')}
          </button>
          <button type="button" className="btn small" onClick={() => void sc.saveReplayAll()}>
            {t('replay.saveAll')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => void sc.openReplayFolder()}>
            {t('replay.openFolder')}
          </button>
        </div>
        {!sc.settings?.replay.enabled ? (
          <div className="hint" style={{ marginTop: 8 }}>
            {t('replay.disabledHint')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
