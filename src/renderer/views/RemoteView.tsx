import { useState } from 'react';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';

/**
 * Onglet StreamControl Remote.
 *
 * Il a sa propre place dans la barre laterale : c'est un service a part
 * entiere, pas un reglage parmi d'autres. On y active le panneau distant, on
 * fixe son mot de passe, et on voit les appareils autorises.
 */
export function RemoteView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const remote = sc.settings?.remote;
  const enabled = remote?.enabled ?? false;
  const hasPassword = Boolean(remote?.passwordHash);
  const devices = remote?.devices ?? [];

  const ip = sc.preflight?.network.primaryIPv4 ?? '127.0.0.1';
  const port = sc.settings?.mediamtx.webPagesPort ?? 8080;
  /**
   * Deux adresses distinctes, et ce n'est pas un detail.
   *
   * Windows bloque une requete d'un poste vers SA PROPRE adresse de reseau :
   * ouvrir `http://<ip-du-lan>:<port>/remote` sur ce PC donne
   * ERR_NETWORK_ACCESS_DENIED, meme quand tout fonctionne. Sur le telephone,
   * c'est l'adresse du LAN qu'il faut ; sur ce PC, c'est la boucle locale.
   */
  const localUrl = `http://127.0.0.1:${port}/remote`;
  const phoneUrl = `http://${ip}:${port}/remote`;

  /** Enregistre un reglage du Remote, en gardant le reste tel quel. */
  const patchRemote = async (partial: Partial<NonNullable<typeof remote>>) => {
    if (!remote) return;
    await sc.saveSettings({ remote: { ...remote, ...partial } });
  };

  const applyPassword = async (value: string) => {
    setBusy(true);
    try {
      const result = await window.streamcontrol.remoteSetPassword(value);
      if (result.ok) {
        setPassword('');
        sc.notify('ok', value ? t('remote.passwordSet') : t('remote.passwordNone'));
        await sc.refreshSettings();
      } else {
        sc.notify('err', result.message ?? t('remote.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const forget = async (token: string) => {
    await window.streamcontrol.remoteForget(token);
    await sc.refreshSettings();
    sc.notify('ok', t('remote.forgotten'));
  };

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('remote.title')}</h1>
          <div className="topbar-sub">{t('remote.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <span className={`pill ${enabled ? 'ok' : ''}`}>
            <span className={`led ${enabled ? 'connected' : ''}`} aria-hidden />
            {enabled ? t('state.running') : t('state.stopped')}
          </span>
        </div>
      </div>

      {/* --- Activation ------------------------------------------------- */}
      <div className="section-title">{t('remote.service')}</div>
      <div className="panel">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => void patchRemote({ enabled: event.target.checked })}
          />
          {t('remote.enable')}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={remote?.requireApproval !== false}
            onChange={(event) => void patchRemote({ requireApproval: event.target.checked })}
          />
          {t('remote.requireApproval')}
        </label>

        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('remote.addressPhone')}</label>
          <div className="input-row">
            <input className="input mono" readOnly value={phoneUrl} />
            <button type="button" className="btn small" onClick={() => void sc.copy(phoneUrl)}>
              <Icon name="urls" size={14} /> {t('action.copy')}
            </button>
          </div>
          <div className="hint">{t('remote.addressPhoneHint')}</div>
        </div>

        <div className="field">
          <label>{t('remote.addressLocal')}</label>
          <div className="input-row">
            <input className="input mono" readOnly value={localUrl} />
            <button type="button" className="btn small ghost" onClick={() => void sc.openExternal(localUrl)}>
              {t('action.open')}
            </button>
          </div>
          <div className="hint">{t('remote.addressLocalHint')}</div>
        </div>
      </div>

      {/* --- Mot de passe ---------------------------------------------- */}
      <div className="section-title">{t('remote.passwordLabel')}</div>
      <div className="panel">
        <div className="field">
          <div className="input-row">
            <input
              id="remote-password"
              className="input mono"
              type="password"
              value={password}
              autoComplete="off"
              placeholder={hasPassword ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="btn small primary"
              disabled={busy || password.trim().length < 4}
              onClick={() => void applyPassword(password)}
            >
              <Icon name="security" size={14} /> {t('remote.setPassword')}
            </button>
            {hasPassword ? (
              <button type="button" className="btn small ghost" disabled={busy} onClick={() => void applyPassword('')}>
                {t('remote.removePassword')}
              </button>
            ) : null}
          </div>
          <div className="hint">{t('remote.passwordHint')}</div>
          <span className={`badge ${hasPassword ? 'ok' : ''}`}>
            {hasPassword ? t('remote.passwordSet') : t('remote.passwordNone')}
          </span>
        </div>
      </div>

      {/* --- Appareils autorises ---------------------------------------- */}
      <div className="section-title">
        {t('remote.devices')}
        {devices.length > 0 ? <span className="badge" style={{ marginLeft: 8 }}>{devices.length}</span> : null}
      </div>
      <div className="panel">
        {devices.length === 0 ? (
          <div className="muted">{t('remote.noDevice')}</div>
        ) : (
          devices.map((device) => (
            <div className="tool-row" key={device.token}>
              <div>
                <strong>
                  <Icon name="remote" size={14} /> {device.name}
                </strong>
                <div className="tool-path">
                  {device.address ?? t('remote.unknownAddress')} · {new Date(device.addedAt).toLocaleString()}
                </div>
              </div>
              <button type="button" className="btn small danger" onClick={() => void forget(device.token)}>
                {t('remote.forget')}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <div className="hint">{t('remote.help')}</div>
      </div>
    </div>
  );
}
