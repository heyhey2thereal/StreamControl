import { useTranslation } from '../hooks/useTranslation';

interface Props {
  label: string;
  hint: string;
  value: string;
  primary?: boolean;
  onCopy: () => void;
  /** Ouvre la ressource : navigateur, fenetre de lecture, ou application. */
  onOpen?: () => void;
  /** Intitule du bouton d'ouverture, quand « Ouvrir » ne convient pas. */
  openLabel?: string;
}

export function UrlRow({ label, hint, value, primary, onCopy, onOpen, openLabel }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`url-row${primary ? ' primary-url' : ''}`}>
      <div className="url-meta">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="url-value" title={value}>
        {value}
      </div>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={onCopy}>
          {t('action.copy')}
        </button>
        {onOpen ? (
          <button type="button" className="btn small ghost" onClick={onOpen}>
            {openLabel ?? t('action.open')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
