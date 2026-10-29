import { useTranslation } from '../hooks/useTranslation';

/**
 * Questions frequentes et remerciements.
 *
 * Regroupees dans leur propre onglet : ce sont les questions qu'on se pose
 * quand quelque chose ne marche pas, et on ne doit pas avoir a les chercher
 * dans le guide d'installation.
 */
export function FaqView() {
  const { t } = useTranslation();

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.faq')}</h1>
          <div className="topbar-sub">{t('faq.subtitle')}</div>
        </div>
      </div>

      <div className="section-title">{t('faq.title')}</div>
      <div className="faq">
        <details className="faq-item">
          <summary>{t('faq.latencyQ')}</summary>
          <div className="faq-body">
            <p>{t('faq.latencyIntro')}</p>
            <ul>
              <li>{t('faq.latencyWifi')}</li>
              <li>{t('faq.latencyDistance')}</li>
              <li>{t('faq.latencySlow')}</li>
              <li>{t('faq.latencyBframes')}</li>
            </ul>
            <p className="muted">{t('faq.latencyFix')}</p>
          </div>
        </details>

        <details className="faq-item">
          <summary>{t('faq.noVideoQ')}</summary>
          <div className="faq-body">
            <ul>
              <li>{t('faq.noVideoPath')}</li>
              <li>{t('faq.noVideoUrl')}</li>
              <li>{t('faq.noVideoFirewall')}</li>
              <li>{t('faq.noVideoCodec')}</li>
              <li>{t('faq.noVideoBusy')}</li>
            </ul>
            <p className="muted">{t('faq.noVideoCheck')}</p>
          </div>
        </details>

        <details className="faq-item">
          <summary>{t('faq.startQ')}</summary>
          <div className="faq-body">
            <ul>
              <li>{t('faq.startNotRunning')}</li>
              <li>{t('faq.startPort')}</li>
              <li>{t('faq.startMissing')}</li>
            </ul>
          </div>
        </details>

        <details className="faq-item">
          <summary>{t('faq.howQ')}</summary>
          <div className="faq-body">
            <p>{t('faq.howBody1')}</p>
            <p>{t('faq.howBody2')}</p>
            <p>{t('faq.howBody3')}</p>
          </div>
        </details>

        <details className="faq-item">
          <summary>{t('faq.devQ')}</summary>
          <div className="faq-body">
            <p>{t('faq.devBody')}</p>
          </div>
        </details>
      </div>

      <div className="thanks">
        <strong>{t('thanks.title')}</strong>
        <p>{t('thanks.body')}</p>
        <p className="muted">{t('thanks.author')}</p>
      </div>
    </div>
  );
}
