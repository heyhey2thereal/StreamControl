import { useEffect, useRef, useState } from 'react';
import emblem from '../assets/emblem.png';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';

/**
 * Ecran de verrouillage.
 *
 * Il masque toute l'interface : le poste sert de serveur de flux, et un
 * passant ne doit pas pouvoir arreter une diffusion ni modifier une adresse.
 *
 * Le mot de passe n'est jamais stocke en clair cote application : seule une
 * empreinte est comparee cote processus principal. Le champ n'apparait qu'apres
 * un clic sur « Vous souhaitez deverrouiller ? », pour que l'ecran reste lisible
 * de loin.
 */
export function LockScreen({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await sc.unlock(password);
      if (!result.ok) {
        setError(result.message ?? t('lock.wrong'));
        setPassword('');
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-grid">
        <div className="lock-left">
          <h1 className="lock-title">{t('lock.lockedTitle')}</h1>
          <p className="lock-body">{t('lock.lockedBody')}</p>

          {!formOpen ? (
            <button type="button" className="lock-cta" onClick={() => setFormOpen(true)}>
              {t('lock.wantUnlock')}
            </button>
          ) : (
            <form className="lock-form" onSubmit={submit}>
              <input
                ref={inputRef}
                className="input mono"
                type="password"
                value={password}
                autoComplete="off"
                placeholder={t('lock.passwordPlaceholder')}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="submit" className="btn primary" disabled={busy || password.length === 0}>
                {busy ? t('lock.checking') : t('lock.unlock')}
              </button>
            </form>
          )}

          {error ? <div className="lock-error">{error}</div> : null}
          {sc.lock.hint ? (
            <div className="lock-hint">
              {t('lock.hintLabel')} <strong>{sc.lock.hint}</strong>
            </div>
          ) : null}
        </div>
      </div>

      <img className="lock-watermark" src={emblem} alt="" aria-hidden />
    </div>
  );
}
