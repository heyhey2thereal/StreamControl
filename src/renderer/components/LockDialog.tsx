import { useEffect, useRef, useState } from 'react';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';

/**
 * Pop-up de verrouillage du poste.
 *
 * Elle remplace l'ancienne section des Parametres : le bouton « Verrouiller »
 * ouvre directement la saisie du mot de passe et de l'indice. Definir le mot de
 * passe verrouille le poste dans la foulee, sans detour par les reglages.
 */
export function LockDialog({ sc, onClose }: { sc: StreamControl; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState(sc.lock.hint);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const defineAndLock = async () => {
    if (busy || password.trim().length < 4) return;
    setBusy(true);
    try {
      await sc.setLockPassword(password, hint);
      await sc.lockNow();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const lockWithExisting = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sc.lockNow();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const removePassword = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sc.setLockPassword('', '');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal lock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="lock-dialog-title">{t('lock.settingsTitle')}</h2>
          <button type="button" className="btn small ghost" onClick={onClose}>
            {t('action.close')}
          </button>
        </header>

        <div className="field">
          <label htmlFor="lock-dialog-password">{t('lock.password')}</label>
          <input
            ref={inputRef}
            id="lock-dialog-password"
            className="input mono"
            type="password"
            value={password}
            autoComplete="off"
            placeholder={sc.lock.hasPassword ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void defineAndLock();
            }}
          />
          <div className="hint">{t('lock.passwordHint')}</div>
        </div>

        <div className="field">
          <label htmlFor="lock-dialog-hint">{t('lock.hint')}</label>
          <input
            id="lock-dialog-hint"
            className="input"
            value={hint}
            placeholder={sc.lock.hint}
            onChange={(event) => setHint(event.target.value)}
          />
          <div className="hint">{t('lock.hintHint')}</div>
        </div>

        <div className="modal-actions">
          {sc.lock.hasPassword ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void removePassword()}>
              {t('lock.remove')}
            </button>
          ) : null}
          {sc.lock.hasPassword ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void lockWithExisting()}>
              {t('lock.lockNow')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={busy || password.trim().length < 4}
            onClick={() => void defineAndLock()}
          >
            {t('lock.set')}
          </button>
        </div>
      </div>
    </div>
  );
}
