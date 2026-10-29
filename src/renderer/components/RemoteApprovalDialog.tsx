import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';

/** Une demande d'appairage, telle que remontee par le processus principal. */
export interface RemotePairRequest {
  id: string;
  name: string;
  address: string;
  at: number;
}

/**
 * Pop-up d'appairage du panneau distant.
 *
 * Quand un telephone ouvre `/remote` pour la premiere fois, cette fenetre
 * s'affiche sur le poste : « {appareil} souhaite acceder au panneau de
 * controle », avec Accepter et Refuser. Rien n'est autorise sans ce clic.
 */
export function RemoteApprovalDialog() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<RemotePairRequest[]>([]);
  const [busy, setBusy] = useState(false);

  // Les demandes en attente sont relues au montage : une demande arrivee avant
  // l'ouverture de la fenetre ne doit pas etre manquee.
  useEffect(() => {
    void window.streamcontrol.remotePending().then(setRequests).catch(() => undefined);
  }, []);

  // Une nouvelle demande s'ajoute a la liste, sans ecraser celles en attente.
  useEffect(() => {
    const unsubscribe = window.streamcontrol.on('remote:pair-request', (request) => {
      setRequests((previous) =>
        previous.some((entry) => entry.id === request.id) ? previous : [...previous, request],
      );
    });
    return unsubscribe;
  }, []);

  if (requests.length === 0) return null;
  const request = requests[0];

  const answer = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await window.streamcontrol.remoteApprove(request.id, accept);
      setRequests((previous) => previous.filter((entry) => entry.id !== request.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal remote-modal" role="dialog" aria-modal="true" aria-labelledby="remote-approve-title">
        <header className="modal-head">
          <h2 id="remote-approve-title">{t('remote.approveTitle')}</h2>
        </header>

        <p className="update-intro">{t('remote.approveBody', { device: request.name })}</p>
        <div className="hint mono">{request.address}</div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void answer(false)}>
            {t('remote.approveRefuse')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void answer(true)}>
            {t('remote.approveAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}
