import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplayState, StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Spinner';

/**
 * Onglet Replay.
 *
 * On recupere un extrait du direct. Une **barre de lecture** montre la memoire
 * disponible (les dernieres secondes) : elle avance toute seule au rythme du
 * direct. Deux **poignees** s'y deplacent :
 * - celle de gauche fixe le **debut** de l'extrait ;
 * - celle de droite fixe la **fin**.
 *
 * La duree choisie s'affiche en clair, et le bouton sauvegarde un MP4 dans le
 * dossier des replays. Un extrait plus long que la memoire, ou plus court que
 * le minimum, est refuse.
 */
export function ReplayView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const streams = sc.streams;
  const [selectedId, setSelectedId] = useState<string>('');
  const [states, setStates] = useState<Record<string, ReplayState>>({});
  /** Positions des poignees, en secondes en arriere (0 = direct). */
  const [startAgo, setStartAgo] = useState(30);
  const [endAgo, setEndAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [savedFile, setSavedFile] = useState('');
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);

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

  // On relit l'etat de chaque flux : c'est ce qui fait grandir la barre au fur
  // et a mesure que le flux continue.
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
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selected: StreamEndpointView | undefined = streams.find((stream) => stream.id === selectedId);
  const selectedState = selectedId ? states[selectedId] : undefined;
  // La barre represente la memoire configuree : c'est la duree maximale d'un
  // replay. On borne la duree disponible a cette valeur : un tampon residuel
  // (apres une reinstallation) peut annoncer plus que la memoire, ce qui
  // remplirait la barre au-dela de 100 %.
  const available = Math.min(selectedState?.availableSeconds ?? 0, memory);

  // Le remplissage reel grandit tant que le flux publie.
  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / memory) * 100))}%`;
  // Position d'une seconde "en arriere" sur la barre : 0 (direct) est a DROITE.
  const startLeft = `${Math.min(100, Math.max(0, ((memory - startAgo) / memory) * 100))}%`;
  const endLeft = `${Math.min(100, Math.max(0, ((memory - endAgo) / memory) * 100))}%`;

  const wanted = Math.max(0, startAgo - endAgo);

  /** Convertit une position horizontale (0..1) en secondes en arriere. */
  const secondsFromRatio = (ratio: number) => Math.round((1 - Math.min(1, Math.max(0, ratio))) * memory);

  const onPointerMove = (event: React.PointerEvent | PointerEvent) => {
    if (!dragging.current || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const value = secondsFromRatio(ratio);
    if (dragging.current === 'start') setStartAgo(Math.max(endAgo, Math.min(memory, value)));
    else setEndAgo(Math.max(0, Math.min(startAgo, value)));
  };

  const stopDrag = () => { dragging.current = null; };

  useEffect(() => {
    const move = (event: PointerEvent) => onPointerMove(event);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stopDrag);
    };
  });

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage('');
    setSavedFile('');
    try {
      const result = await sc.saveReplayRange(selected.id, { fromSeconds: startAgo, toSeconds: endAgo });
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

  /**
   * Vide le tampon du flux selectionne, apres confirmation.
   *
   * Repart de zero : les segments residuels d'une session precedente ne
   * gonflent plus la duree annoncee.
   */
  const clearBuffer = async () => {
    if (!selected) return;
    if (!window.confirm(t('replay.confirmClear', { name: selected.name }))) return;
    await sc.clearReplayBuffer(selected.id);
    sc.notify('ok', t('replay.bufferCleared'));
    setStartAgo(Math.min(memory, 30));
    setEndAgo(0);
    await refresh();
  };

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
          <button
            type="button"
            className="btn small ghost"
            disabled={!selected}
            onClick={() => void clearBuffer()}
          >
            <Icon name="trash" size={14} /> {t('replay.clearBuffer')}
          </button>
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

      {/* --- Barre de lecture : toute la largeur --------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{t('replay.timelineTitle')}</h2>
        </div>

        <div className="hint">{t('replay.timelineHint', { memory })}</div>

        <div className="replay-timeline">
          {/* Graduations : la memoire a gauche, le direct a droite. */}
          <div className="replay-axis">
            <span>{t('replay.axisOldest', { seconds: memory })}</span>
            <span className="replay-live-tag">{t('replay.axisLive')}</span>
          </div>

          <div className="replay-bar" ref={barRef}>
            {/* Partie reellement memorisee : elle grandit avec le direct. */}
            <div className="replay-bar-fill" style={{ width: pct(available) }} />
            {/* Selection entre les deux poignees. */}
            <div
              className="replay-bar-select"
              style={{ left: startLeft, right: `calc(100% - ${endLeft})` }}
            />
            {/* Poignee de debut (a gauche). */}
            <button
              type="button"
              className="replay-handle"
              style={{ left: startLeft }}
              aria-label={t('replay.handleStart')}
              onPointerDown={(event) => { dragging.current = 'start'; event.preventDefault(); }}
            >
              <span className="replay-handle-label">{startAgo}s</span>
            </button>
            {/* Poignee de fin (a droite). */}
            <button
              type="button"
              className="replay-handle"
              style={{ left: endLeft }}
              aria-label={t('replay.handleEnd')}
              onPointerDown={(event) => { dragging.current = 'end'; event.preventDefault(); }}
            >
              <span className="replay-handle-label">{endAgo}s</span>
            </button>
          </div>
        </div>

        <div className="replay-summary">
          <span>{t('replay.wanted', { seconds: wanted })}</span>
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
            onClick={() => { setStartAgo(Math.min(memory, available || memory)); setEndAgo(0); }}
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

      <div className="panel">
        <div className="hint">{t('replay.help')}</div>
      </div>
    </div>
  );
}

