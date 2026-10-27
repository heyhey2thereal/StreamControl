import { useState } from 'react';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Spinner } from '../components/Spinner';
import { StatusLed } from '../components/StatusLed';

export function ServicesView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const status = sc.mediamtx;
  const preflight = sc.preflight;
  const mediamtxTool = preflight?.tools.find((tool) => tool.kind === 'mediamtx');
  const ffmpegTool = preflight?.tools.find((tool) => tool.kind === 'ffmpeg');

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const start = () =>
    run('start', () => sc.startMediamtx());
  const stop = () =>
    run('stop', () => sc.stopMediamtx());
  const restart = () =>
    run('restart', () => sc.restartMediamtx());

  const busyNow = busy !== null || status.state === 'starting' || status.state === 'stopping';

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.services')}</h1>
          <div className="topbar-sub">{t('services.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn small ghost" disabled={busyNow} onClick={() => void restart()}>
            {t('action.restart')}
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">MediaMTX</h2>
            <StatusLed state={status.state} label={t('services.state')} />
          </div>

          <div className="stack" style={{ marginBottom: 14 }}>
            <div>
              <span className="stat-label">{t('services.pid')}</span>
              <div className="mono">{status.pid ?? '--'}</div>
            </div>
            <div>
              <span className="stat-label">{t('services.detail')}</span>
              <div style={{ fontSize: 12.5 }}>{status.detail ?? t('services.noDetail')}</div>
            </div>
            <div>
              <span className="stat-label">{t('services.binary')}</span>
              <div className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                {mediamtxTool?.path ?? t('dashboard.notDetected')}
              </div>
            </div>
            {mediamtxTool?.version ? (
              <div>
                <span className="stat-label">Version</span>
                <div className="mono">{mediamtxTool.version}</div>
              </div>
            ) : null}
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={busyNow || status.state === 'running'}
              onClick={() => void start()}
            >
              {busy === 'start' ? (
                <>
                  <Spinner size={13} />
                  {t('services.starting')}
                </>
              ) : (
                t('action.start')
              )}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busyNow || status.state === 'stopped'}
              onClick={() => void stop()}
            >
              {busy === 'stop' ? (
                <>
                  <Spinner size={13} />
                  {t('services.stopping')}
                </>
              ) : (
                t('action.stop')
              )}
            </button>
            <button type="button" className="btn" disabled={busyNow} onClick={() => void restart()}>
              {busy === 'restart' ? (
                <>
                  <Spinner size={13} />
                  {t('services.restarting')}
                </>
              ) : (
                t('action.restart')
              )}
            </button>
          </div>

          {busyNow ? (
            <div className="hint" style={{ marginTop: 10 }}>
              <Spinner size={14} slow label={t('services.working')} />
            </div>
          ) : null}

          {status.state === 'error' ? (
            <div className="alert err" style={{ marginTop: 12, marginBottom: 0 }}>
              <div>{status.detail ?? t('state.error')}</div>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('services.dependencies')}</h2>
            <button type="button" className="btn small ghost" onClick={() => void sc.refreshPreflight(true)}>
              {t('services.rescan')}
            </button>
          </div>

          <div className="tool-row">
            <div>
              <strong>MediaMTX</strong>
              <div className="tool-path">{mediamtxTool?.path ?? t('common.notDetected')}</div>
            </div>
            <span className={`badge ${mediamtxTool?.found ? 'ok' : 'err'}`}>
              {mediamtxTool?.found ? (mediamtxTool.origin ?? t('dashboard.detected')) : t('dashboard.absent')}
            </span>
          </div>

          <div className="tool-row">
            <div>
              <strong>{t('services.ffmpeg')}</strong>
              <div className="tool-path">{ffmpegTool?.path ?? t('services.ffmpegHint')}</div>
            </div>
            <span className={`badge ${ffmpegTool?.found ? 'ok' : 'warn'}`}>
              {ffmpegTool?.found ? t('dashboard.detected') : t('dashboard.absent')}
            </span>
          </div>

          <div className="section-title">{t('services.ports')}</div>
          {(preflight?.ports ?? []).map((port) => (
            <div className="tool-row" key={port.port}>
              <div>
                <strong>
                  {port.port} &middot; {port.label}
                </strong>
              </div>
              <span className={`badge ${port.inUse ? 'warn' : 'ok'}`}>
                {port.inUse ? t('services.portBusy') : t('services.portFree')}
              </span>
            </div>
          ))}

          <div className="alert" style={{ marginTop: 14, marginBottom: 0 }}>
            <div>
              {t('services.portNote')} <code>netstat -ano | findstr :1935</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
