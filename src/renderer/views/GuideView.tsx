import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';

export function GuideView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const mediamtxTool = sc.preflight?.tools.find((tool) => tool.kind === 'mediamtx');
  const obsTool = sc.preflight?.tools.find((tool) => tool.kind === 'obs');

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.guide')}</h1>
          <div className="topbar-sub">{t('guide.subtitle')}</div>
        </div>
      </div>

      <div className="alert ok">
        <div>
          <strong>{t('guide.whatTitle')}</strong>
          <div style={{ marginTop: 6 }}>{t('guide.whatBody')}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('guide.mediamtxTitle')}</h2>
            <span className={`badge ${mediamtxTool?.found ? 'ok' : 'warn'}`}>
              {mediamtxTool?.found ? t('guide.installed') : t('guide.toInstall')}
            </span>
          </div>
          <ol className="steps">
            <li>
              <strong>{t('guide.mtxStep1Title')}</strong>
              {t('guide.mtxStep1Body')}
            </li>
            <li>
              <strong>{t('guide.mtxStep2Title')}</strong>
              {t('guide.mtxStep2Body')}
            </li>
            <li>
              <strong>{t('guide.mtxStep3Title')}</strong>
              {t('guide.mtxStep3Body')}
            </li>
            <li>
              <strong>{t('guide.mtxStep4Title')}</strong>
              {t('guide.mtxStep4Body')}
            </li>
          </ol>
          <div className="hint">
            {t('guide.detectedPath')} <span className="mono">{mediamtxTool?.path ?? t('common.none')}</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('guide.obsTitle')}</h2>
            <span className={`badge ${obsTool?.found ? 'ok' : 'warn'}`}>
              {obsTool?.found ? t('guide.installed') : t('guide.notDetected')}
            </span>
          </div>
          <ol className="steps">
            <li>
              <strong>{t('guide.obsStep1Title')}</strong>
              {t('guide.obsStep1Body')}
            </li>
            <li>
              <strong>{t('guide.obsStep2Title')}</strong>
              {t('guide.obsStep2Body')}
            </li>
            <li>
              <strong>{t('guide.obsStep3Title')}</strong>
              {t('guide.obsStep3Body')}
            </li>
            <li>
              <strong>{t('guide.obsStep4Title')}</strong>
              {t('guide.obsStep4Body')}
            </li>
          </ol>
          <div className="hint">
            {t('guide.detectedPath')} <span className="mono">{obsTool?.path ?? t('common.none')}</span>
          </div>
        </div>
      </div>

      <div className="section-title">{t('guide.cameraTitle')}</div>
      <div className="panel">
        <ol className="steps">
          <li>
            <strong>{t('guide.cameraStep1Title')}</strong>
            {t('guide.cameraStep1Body')}
          </li>
          <li>
            <strong>{t('guide.cameraStep2Title')}</strong>
            {t('guide.cameraStep2Body')}
          </li>
          <li>
            <strong>{t('guide.cameraStep3Title')}</strong>
            {t('guide.cameraStep3Body')}
          </li>
          <li>
            <strong>{t('guide.cameraStep4Title')}</strong>
            {t('guide.cameraStep4Body')}
          </li>
        </ol>
      </div>

      <div className="section-title">{t('guide.shortcutsTitle')}</div>
      <div className="panel">
        <div className="shortcut-grid">
          {[
            { keys: ['Ctrl', '1'], label: t('nav.dashboard') },
            { keys: ['Ctrl', '2'], label: t('nav.streams') },
            { keys: ['Ctrl', '3'], label: t('nav.services') },
            { keys: ['Ctrl', '4'], label: t('nav.urls') },
            { keys: ['Ctrl', '5'], label: t('nav.obs') },
            { keys: ['Ctrl', '6'], label: t('nav.logs') },
            { keys: ['Ctrl', '7'], label: t('nav.settings') },
            { keys: ['Ctrl', '8'], label: t('nav.guide') },
            { keys: ['Ctrl', 'R'], label: t('guide.shortcutRestart') },
            { keys: ['Echap'], label: t('guide.shortcutClose') },
          ].map((row) => (
            <div className="shortcut-row" key={row.keys.join('+')}>
              <span className="keys">
                {row.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
              <span>{row.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">{t('guide.rolesTitle')}</div>
      <div className="panel">
        <div className="tool-row">
          <div>
            <strong>{t('guide.roleCamera')}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {t('guide.roleCameraBody')}
            </div>
          </div>
        </div>
        <div className="tool-row">
          <div>
            <strong>MediaMTX</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {t('guide.roleMediamtxBody')}
            </div>
          </div>
        </div>
        <div className="tool-row">
          <div>
            <strong>OBS Studio</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {t('guide.roleObsBody')}
            </div>
          </div>
        </div>
        <div className="tool-row">
          <div>
            <strong>StreamControl</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {t('guide.roleStreamcontrolBody')}
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">{t('guide.limitsTitle')}</div>
      <div className="panel">
        <div className="alert warn" style={{ marginBottom: 10 }}>
          <div>{t('guide.limitDeck')}</div>
        </div>
        <div className="alert warn" style={{ marginBottom: 0 }}>
          <div>{t('guide.limitPassword')}</div>
        </div>
      </div>

    </div>
  );
}
