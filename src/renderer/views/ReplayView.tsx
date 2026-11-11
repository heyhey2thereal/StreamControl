import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplayState, StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Spinner';
import { StreamPreview } from '../components/StreamPreview';
import { ReplayFilmstrip } from '../components/ReplayFilmstrip';

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
  /**
   * Clip du tampon prepare pour l'apercu et la pellicule : son jeton et sa
   * duree. Le fichier n'est jamais remplace, donc la lecture tient pendant le
   * direct.
   *
   * On le prepare UNE FOIS par flux, et a la demande (bouton « Actualiser ») :
   * le re-preparer en boucle remplacait la source du lecteur toutes les
   * quelques secondes, ce qui relancait la video au milieu de la lecture —
   * c'etait le « rafraichissement aleatoire » constate.
   */
  const [clip, setClip] = useState<{ url: string; seconds: number } | null>(null);
  const [clipNonce, setClipNonce] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | 'select' | null>(null);
  /** Ecart entre le curseur et la poignee de debut, pour un deplacement fluide. */
  const selectOffset = useRef(0);

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
  // Prepare un clip du tampon pour le flux selectionne.
  //
  // Le clip est fige (jeton) : la lecture ne casse donc pas quand le tampon
  // avance. On en prepare un nouveau quand on change de flux, ou quand
  // l'operateur clique « Actualiser ». On ne le remplace JAMAIS tout seul :
  // le remplacement periodique relancait la lecture au milieu de l'extrait.
  const clipBase = selected?.urls.replayClip ?? '';
  useEffect(() => {
    if (!clipBase || !enabled) {
      setClip(null);
      return undefined;
    }
    let cancelled = false;
    const prepare = async () => {
      try {
        // La base est `<...>/clip/<flux>` ; `/new` renvoie un clip frais.
        const response = await fetch(`${clipBase}/new`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = (await response.json()) as { ok?: boolean; url?: string; seconds?: number };
        if (cancelled || result.ok !== true || !result.url) return;
        setClip({ url: new URL(result.url, clipBase).toString(), seconds: result.seconds ?? 0 });
      } catch {
        // Tampon pas encore pret : on retente au prochain cycle.
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [clipBase, enabled, clipNonce]);

  // La barre represente la memoire configuree : c'est la duree maximale d'un
  // replay. On borne la duree disponible a cette valeur : un tampon residuel
  // (apres une reinstallation) peut annoncer plus que la memoire, ce qui
  // remplirait la barre au-dela de 100 %.
  const available = Math.min(selectedState?.availableSeconds ?? 0, memory);
  // On ne peut pas demander plus que ce qui est reellement memorise : sans ce
  // plafond, « un replay de 300 s » etait accepte alors que le flux n'avait que
  // 32 s, et l'extrait etait plus court que voulu.
  const reachable = Math.max(available, minimum);

  // Le plus ANCIEN est a DROITE, le plus RECENT (le direct) a GAUCHE. La
  // memoire s'etend donc du direct (a gauche) vers la droite a mesure que le
  // temps passe.
  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / memory) * 100))}%`;
  // Position d'une seconde « en arriere » : 0 s (direct) = tout a GAUCHE,
  // `memory` s (le plus ancien) = tout a DROITE.
  const agoLeft = (seconds: number) =>
    `${Math.min(100, Math.max(0, (seconds / memory) * 100))}%`;
  // Poignee de debut : la plus ancienne, donc la plus a DROITE.
  const startLeft = agoLeft(startAgo);
  // Poignee de fin : la plus recente, donc la plus a GAUCHE.
  const endLeft = agoLeft(endAgo);
  // Remplissage : ancre au direct (a gauche), il s'etend vers la droite. Sa
  // largeur est la memoire reelle.
  const fillWidth = pct(available);
  // Tete de lecture : bord droit du remplissage, donc elle avance vers la droite.
  const playheadLeft = agoLeft(available);

  // Clip du tampon : video deplacable dans le temps (le direct HLS ne l'est
  // pas). Il sert a l'apercu et a la pellicule. On prefere le clip prepare avec
  // son jeton (fichier fige) ; a defaut, l'adresse generique.
  const clipSrc = clip?.url || selected?.urls.replayClip || '';
  // Le clip finit au direct : « il y a startAgo secondes » correspond a
  // `clipSeconds - startAgo` depuis le debut du clip.
  const clipSeconds = clip?.seconds ?? available;
  const previewFrom = Math.max(0, clipSeconds - startAgo);
  const previewTo = Math.max(previewFrom, clipSeconds - endAgo);

  const wanted = Math.max(0, startAgo - endAgo);

  /**
   * Convertit une position horizontale (0..1) en secondes « en arriere ».
   *
   * Le direct (0 s) est a GAUCHE : la position croit vers la droite.
   */
  const secondsFromRatio = (ratio: number) => Math.round(Math.min(1, Math.max(0, ratio)) * memory);

  const onPointerMove = (event: React.PointerEvent | PointerEvent) => {
    if (!dragging.current || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const value = secondsFromRatio(ratio);
    if (dragging.current === 'start') {
      setStartAgo(Math.max(endAgo, Math.min(reachable, value)));
    } else if (dragging.current === 'end') {
      setEndAgo(Math.max(0, Math.min(startAgo, value)));
    } else {
      // Deplacement de TOUTE la selection : on conserve sa largeur et on la
      // fait glisser. Sans cela, on ne pouvait qu'etendre une poignee, jamais
      // deplacer l'extrait choisi vers la gauche ou la droite.
      const width = startAgo - endAgo;
      const nextStart = Math.max(width, Math.min(reachable, value + selectOffset.current));
      setStartAgo(nextStart);
      setEndAgo(nextStart - width);
    }
  };

  /** Saisit la selection entiere pour la faire glisser. */
  const beginSelectDrag = (event: React.PointerEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    selectOffset.current = startAgo - secondsFromRatio(ratio);
    dragging.current = 'select';
    event.preventDefault();
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

  // La duree disponible peut diminuer (flux qui redemarre, memoire videe) :
  // on ramene alors les poignees dans la plage reellement atteignable, pour ne
  // pas demander un extrait plus long que ce qui existe.
  useEffect(() => {
    if (startAgo > reachable) setStartAgo(reachable);
    if (endAgo > reachable) setEndAgo(0);
  }, [reachable, startAgo, endAgo]);

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
          <button
            type="button"
            className="btn small ghost"
            disabled={!selected || !clipBase}
            onClick={() => setClipNonce((value) => value + 1)}
            title={t('replay.refreshHint')}
          >
            <Icon name="refresh" size={14} /> {t('replay.refresh')}
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
          {/* Graduations : le direct a gauche, la memoire (le plus ancien) a droite. */}
          <div className="replay-axis">
            <span className="replay-live-tag">{t('replay.axisLive')}</span>
            <span>{t('replay.axisOldest', { seconds: memory })}</span>
          </div>

          {/* Pellicule : une vignette par seconde, comme un montage video. */}
          {clipSrc && clipSeconds >= 1 ? (
            <ReplayFilmstrip src={clipSrc} seconds={clipSeconds} memory={memory} />
          ) : null}

          <div className="replay-bar" ref={barRef}>
            {/* Partie reellement memorisee : ancree au direct (a gauche), elle
                s'etend vers la droite a mesure que le temps passe. */}
            <div className="replay-bar-fill" style={{ width: fillWidth }} />
            {/* Tete de lecture : bord droit du remplissage, donc elle avance
                vers la droite. */}
            <div className="replay-playhead" style={{ left: playheadLeft }} aria-hidden />
            {/* Selection entre les deux poignees. On peut la SAISIR pour la
                deplacer entiere (a gauche ou a droite), sans changer sa duree. */}
            <div
              className="replay-bar-select"
              style={{ left: endLeft, right: `calc(100% - ${startLeft})` }}
              onPointerDown={beginSelectDrag}
              title={t('replay.dragSelection')}
            />
            {/* Poignee de debut : la plus ANCIENNE, donc la plus a DROITE. */}
            <button
              type="button"
              className="replay-handle"
              style={{ left: startLeft }}
              aria-label={t('replay.handleStart')}
              onPointerDown={(event) => { dragging.current = 'start'; event.preventDefault(); }}
            >
              <span className="replay-handle-label">{startAgo}s</span>
            </button>
            {/* Poignee de fin : la plus RECENTE, donc la plus a GAUCHE. */}
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

        {/* --- Apercu de la selection -------------------------------------- */}
        {/* Le lecteur lit le clip du tampon : on peut donc s'y deplacer, et
            l'apercu montre l'image au debut de la plage choisie. */}
        <div className="replay-preview">
          {clipSrc && clipSeconds >= 1 ? (
            <StreamPreview src={clipSrc} fromSeconds={previewFrom} toSeconds={previewTo} />
          ) : (
            <div className="replay-preview-empty">{t('replay.previewNoLive')}</div>
          )}
          <div className="hint">{t('replay.previewHint')}</div>
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
            onClick={() => { setStartAgo(Math.min(reachable, available || reachable)); setEndAgo(0); }}
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

