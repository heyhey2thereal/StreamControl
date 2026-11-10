import { useCallback, useEffect, useState } from 'react';
import type { ReplayState, StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Spinner';

/**
 * Onglet Replay.
 *
 * On recupere un extrait du direct : on choisit le flux, la duree voulue
 * (« de N secondes a M secondes en arriere »), et on sauvegarde un MP4 dans le
 * dossier des replays. L'application memorise en continu les dernieres
 * secondes de chaque flux (voir les Parametres > Replay) : un replay plus long
 * que cette memoire est refuse.
 */
export function ReplayView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const streams = sc.streams;
  const [selectedId, setSelectedId] = useState<string>('');
  const [states, setStates] = useState<Record<string, ReplayState>>({});
  const [fromSeconds, setFromSeconds] = useState(30);
  const [toSeconds, setToSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [savedFile, setSavedFile] = useState('');

  const memory = sc.settings?.replay.bufferSeconds ?? 60;
  const minimum = sc.settings?.replay.minimumSeconds ?? 30;
  const enabled = sc.settings?.replay.enabled ?? false;

  // Le premier flux en direct est selectionne par defaut : c'est celui qu'on
  // veut recuperer le plus souvent.
  useEffect(() => {
    if (selectedId) return;
    const live = streams.find((stream) => stream.status.publishing) ?? streams[0];
    if (live) setSelectedId(live.id);
  }, [selectedId, streams]);

  // On relit l'etat de chaque flux pour connaitre la memoire disponible.
  const refresh = useCallback(async () => {
    const next: Record<string, ReplayState> = {};
    for (const stream of streams) {
      try {
        next[stream.id] = await window.streamcontrol.replayState(stream.id);
      } catch {
        // Un flux en erreur ne doit pas empecher les autres.
      }
    }
    setStates(next);
  }, [streams]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selected: StreamEndpointView | undefined = streams.find((stream) => stream.id === selectedId);
  const selectedState = selectedId ? states[selectedId] : undefined;
  const available = selectedState?.availableSeconds ?? 0;

  // Duree reellement demandee : « de from a to », bornee par la memoire.
  const wanted = Math.max(0, Math.min(fromSeconds, memory) - Math.max(0, toSeconds));

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage('');
    setSavedFile('');
    try {
      const result = await sc.saveReplayRange(selected.id, { fromSeconds, toSeconds });
      if (result?.ok) {
        setMessage(result.message);
        setSavedFile(result.file ?? '');
      } else {
        setMessage(result?.message ?? t('replay.failed'));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const canSave = enabled && Boolean(selected) && wanted >= minimum && available >= minimum && !busy;

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('replay.title')}</h1>
          <div className="topbar-sub">{t('replay.subtitle')}</div>
        </div>
        <div className="topbar-actions">
          <span className={`pill ${enabled ? 'ok' : ''}`}>
            <span className={`led ${enabled ? 'running' : ''}`} aria-hidden />
            {enabled ? t('state.running') : t('state.stopped')}
          </span>
          <button type="button" className="btn small ghost" onClick={() => void sc.openReplayFolder()}>
            <Icon name="files" size={14} /> {t('replay.openFolder')}
          </button>
        </div>
      </div>

      {!enabled ? (
        <div className="alert warn">
          <div>
            <strong>{t('replay.disabledTitle')}</strong>
            <div style={{ marginTop: 6 }}>{t('replay.disabledHint')}</div>
          </div>
        </div>
      ) : null}

      <div className="replay-layout">
        {/* --- Choix du flux ------------------------------------------- */}
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('replay.pickStream')}</h2>
          </div>
          {streams.length === 0 ? (
            <p className="muted">{t('replay.noStream')}</p>
          ) : (
            <div className="pick-list">
              {streams.map((stream) => {
                const state = states[stream.id];
                const ready = state?.ready ?? false;
                return (
                  <button
                    key={stream.id}
                    type="button"
                    className={`pick-item replay-pick${selectedId === stream.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(stream.id)}
                  >
                    <span className="pick-name">{stream.name}</span>
                    <span className="pick-path">/{stream.path}</span>
                    <span className={`led ${stream.status.publishing ? 'running' : ''}`} aria-hidden />
                    <span className={`badge ${ready ? 'ok' : ''}`}>
                      {state ? `${state.availableSeconds} s` : '--'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* --- Choix de la plage -------------------------------------- */}
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('replay.rangeTitle')}</h2>
          </div>

          <div className="hint">{t('replay.rangeHint', { memory, minimum })}</div>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="field">
              <label>{t('replay.fromLabel')}</label>
              <input
                className="input"
                type="number"
                min={0}
                max={memory}
                value={fromSeconds}
                onChange={(event) => setFromSeconds(Number.parseInt(event.target.value, 10) || 0)}
              />
              <div className="hint">{t('replay.fromHint')}</div>
            </div>
            <div className="field">
              <label>{t('replay.toLabel')}</label>
              <input
                className="input"
                type="number"
                min={0}
                max={memory}
                value={toSeconds}
                onChange={(event) => setToSeconds(Number.parseInt(event.target.value, 10) || 0)}
              />
              <div className="hint">{t('replay.toHint')}</div>
            </div>
          </div>

          <div className="replay-summary">
            <span>
              {t('replay.wanted', { seconds: wanted })}
            </span>
            <span className={`badge ${wanted >= minimum ? 'ok' : 'err'}`}>
              {wanted >= minimum ? t('replay.wantedOk') : t('replay.wantedTooShort', { minimum })}
            </span>
          </div>

          {selected && !selectedState?.ready ? (
            <div className="hint" style={{ marginTop: 8 }}>
              {t('replay.notReady', { seconds: available, minimum })}
            </div>
          ) : null}

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" disabled={!canSave} onClick={() => void save()}>
              {busy ? <Spinner size={14} /> : null}
              {busy ? t('replay.saving') : t('replay.save')}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setFromSeconds(memory);
                setToSeconds(0);
              }}
            >
              {t('replay.wholeMemory')}
            </button>
          </div>

          {message ? (
            <div className={`alert ${savedFile ? '' : 'warn'}`} style={{ marginTop: 12, marginBottom: 0 }}>
              <div>
                {message}
                {savedFile ? <div className="mono" style={{ marginTop: 6, fontSize: 11 }}>{savedFile}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="hint">{t('replay.help')}</div>
      </div>
    </div>
  );
}
