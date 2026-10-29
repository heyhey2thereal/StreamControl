import { useEffect, useState } from 'react';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';

/**
 * Fenetre de mise a jour, proposee au lancement.
 *
 * Elle est affichee des qu'une version est publiee, meme identique a celle
 * installee : une meme version peut etre reconstruite avec des correctifs, et
 * l'utilisateur doit alors pouvoir les lire et retélécharger l'installeur.
 *
 * Trois reponses possibles : telecharger, plus tard, ou ne plus etre rappele.
 */
export function UpdateDialog({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const update = sc.appUpdate;
  const [opening, setOpening] = useState(false);

  // Echap ferme la fenetre : c'est le geste attendu pour une boite de dialogue.
  useEffect(() => {
    if (!update) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') sc.dismissUpdate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sc, update]);

  if (!update) return null;

  const openDownload = async () => {
    const target = update.downloadUrl || update.releaseUrl;
    if (!target) return;
    setOpening(true);
    try {
      await sc.openExternal(target);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <header className="modal-head">
          <h2 id="update-title">{t('update.title')}</h2>
          <button type="button" className="btn small ghost" onClick={sc.dismissUpdate}>
            {t('action.close')}
          </button>
        </header>

        <div className="update-versions">
          <div>
            <span className="stat-label">{t('update.installed')}</span>
            <span className="stat-value-sm">{update.currentVersion}</span>
          </div>
          <div>
            <span className="stat-label">{t('update.available')}</span>
            <span className="stat-value-sm ok">{update.version}</span>
          </div>
        </div>

        <p className="update-intro">
          {update.different ? t('update.introNew') : t('update.introSame')}
        </p>

        {update.notes ? (
          <pre className="update-notes">{update.notes}</pre>
        ) : (
          <p className="muted">{t('update.noNotes')}</p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn primary" disabled={opening} onClick={() => void openDownload()}>
            {opening ? t('update.opening') : t('update.download')}
          </button>
          <button type="button" className="btn ghost" onClick={sc.dismissUpdate}>
            {t('update.later')}
          </button>
          <button type="button" className="btn ghost" onClick={() => void sc.ignoreUpdate()}>
            {t('update.ignore')}
          </button>
        </div>
      </div>
    </div>
  );
}
