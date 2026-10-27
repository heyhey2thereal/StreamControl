import { useEffect, useState } from 'react';
import type { StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { StatusLed } from '../components/StatusLed';

/** Valeurs a saisir dans OBS pour publier vers une adresse de StreamControl. */
function obsIngest(endpoint: StreamEndpointView): { server: string; key: string } {
  const url = new URL(endpoint.urls.rtmpIngest);
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  return {
    server: `${url.protocol}//${url.host}/${segments[0] ?? 'live'}`,
    key: segments.slice(1).join('/') || 'a-la-demande',
  };
}

/** Ligne de valeur copiable, utilisee dans le tutoriel. */
function CopyChip({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-chip${copied ? ' copied' : ''}`}
      title={value}
      onClick={() => {
        void window.streamcontrol.copyToClipboard(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      <code>{value}</code>
      <span>{copied ? t('action.copied') : t('action.copy')}</span>
    </button>
  );
}

/**
 * Tutoriel de connexion a OBS.
 *
 * Les valeurs affichees sont celles de la machine : le port et l'hote viennent
 * des parametres, les URL de la premiere adresse de diffusion. Chaque etape dit
 * aussi si elle est deja satisfaite (OBS detecte, serveur joignable).
 */
function ObsTutorial({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  // Le tutoriel est replie par defaut : c'est un guide, pas l'ecran principal.
  const [open, setOpen] = useState(sc.settings?.ui.obsTutorialOpen ?? false);
  const obs = sc.obs;
  const host = sc.settings?.obs.host ?? '127.0.0.1';
  const port = sc.settings?.obs.port ?? 4455;
  const obsInstalled = sc.preflight?.tools.some((tool) => tool.kind === 'obs' && tool.found) ?? false;
  const stream = sc.streams[0];
  const ingest = stream ? obsIngest(stream) : null;

  const step = (done: boolean) => (
    <span className={`tuto-state ${done ? 'ok' : ''}`}>{done ? t('obs.tutoDone') : t('obs.tutoTodo')}</span>
  );

  return (
    <div className="tuto">
      <button type="button" className="tuto-head" onClick={() => setOpen(!open)}>
        <span className="urls-caret">{open ? '\u25BE' : '\u25B8'}</span>
        <span className="tuto-title">{t('obs.tutoTitle')}</span>
        <span className="tuto-sub">{t('obs.tutoIntro')}</span>
      </button>

      {open ? (
        <ol className="tuto-steps">
          <li>
            <div className="tuto-step-head">
              <strong>{t('obs.tutoStep1Title')}</strong>
              {step(obsInstalled)}
            </div>
            <p>{t('obs.tutoStep1Body')}</p>
          </li>

          <li>
            <div className="tuto-step-head">
              <strong>{t('obs.tutoStep2Title')}</strong>
              {step(false)}
            </div>
            <p>{t('obs.tutoStep2Body')}</p>
            <p className="tuto-menu">{t('obs.tutoStep2Menu')}</p>
          </li>

          <li>
            <div className="tuto-step-head">
              <strong>{t('obs.tutoStep3Title')}</strong>
            </div>
            <p>{t('obs.tutoStep3Body')}</p>
          </li>

          <li>
            <div className="tuto-step-head">
              <strong>{t('obs.tutoStep4Title')}</strong>
              {step(obs.connected)}
            </div>
            <p>{t('obs.tutoStep4Body', { host, port })}</p>
            <div className="tuto-row">
              <CopyChip value={host} />
              <CopyChip value={String(port)} />
              <button
                type="button"
                className="btn small primary"
                disabled={obs.connected || obs.connecting}
                onClick={() => void sc.obsConnect()}
              >
                {obs.connecting ? t('obs.connecting') : t('obs.tutoTest')}
              </button>
            </div>
          </li>

          <li>
            <div className="tuto-step-head">
              <strong>{t('obs.tutoStep5Title')}</strong>
            </div>
            <p>{t('obs.tutoStep5Body')}</p>
            {stream ? <CopyChip value={stream.urls.hls} /> : <p className="muted">{t('obs.tutoNoStream')}</p>}
          </li>

          {ingest ? (
            <li>
              <div className="tuto-step-head">
                <strong>{t('obs.tutoRtmpTitle')}</strong>
              </div>
              <p>{t('obs.tutoRtmpBody')}</p>
              <div className="tuto-field">
                <span>{t('obs.tutoServer')}</span>
                <CopyChip value={ingest.server} />
              </div>
              <div className="tuto-field">
                <span>{t('obs.tutoKey')}</span>
                <CopyChip value={ingest.key} />
              </div>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}


export function ObsView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const obs = sc.obs;
  const [configureResult, setConfigureResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [newScene, setNewScene] = useState('');

  /** Renseigne le service personnalise d'OBS avec notre adresse RTMP. */
  const configureObs = async () => {
    setConfigureResult(null);
    const result = await window.streamcontrol.obsUseStreamControl();
    setConfigureResult(result);
    sc.notify(result.ok ? 'ok' : 'err', result.message);
  };

  const createScene = async () => {
    const name = newScene.trim();
    if (!name) return;
    const result = await sc.obsCreateScene(name);
    if (result.ok) {
      setNewScene('');
      setEditingScene(name);
    }
  };

  const connected = obs.connected;

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>OBS Studio</h1>
          <div className="topbar-sub">
            {connected
              ? `${t('obs.subtitleConnected', { host: obs.host, port: obs.port })}${obs.version ? ` - OBS ${obs.version}` : ''}`
              : t('obs.subtitleDisconnected', { host: obs.host, port: obs.port })}
          </div>
        </div>
        <div className="topbar-actions">
          <StatusLed state={connected ? 'connected' : 'disconnected'} label="WebSocket" />
          <button
            type="button"
            className={`btn small ${connected ? 'ghost' : 'primary'}`}
            disabled={obs.connecting}
            onClick={() => void (connected ? sc.obsDisconnect() : sc.obsConnect())}
          >
            {obs.connecting ? t('obs.connecting') : connected ? t('obs.disconnect') : t('obs.connect')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => setShowSetup(!showSetup)}>
            {t('obs.setup')}
          </button>
        </div>
      </div>

      {obs.authFailed ? (
        <div className="alert err">
          <div>
            <strong>{t('obs.authFailed')}</strong>
            <div style={{ marginTop: 6 }}>{t('obs.authFailedBody')}</div>
          </div>
        </div>
      ) : null}

      {obs.error && !obs.authFailed ? (
        <div className="alert warn">
          <div>{obs.error}</div>
        </div>
      ) : null}

      {showSetup ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <h2 className="panel-title">{t('obs.setup')}</h2>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void sc.launchObs()}>
              {t('obs.launch')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!connected}
              onClick={() => void configureObs()}
            >
              {t('obs.configure')}
            </button>
            <button type="button" className="btn ghost" onClick={() => void sc.refreshPreflight(true)}>
              {t('obs.checkInstall')}
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>{t('obs.configureHint')}</div>
          {configureResult ? (
            <div className={`alert ${configureResult.ok ? 'ok' : 'warn'}`} style={{ marginTop: 10, marginBottom: 0 }}>
              <div>{configureResult.message}</div>
            </div>
          ) : null}
          <div className="alert" style={{ marginTop: 12, marginBottom: 0 }}>
            <div>
              {t('obs.serverNote')} <code>Outils &gt; WebSocket Server Settings</code>, {t('obs.serverNote2')}
            </div>
          </div>
        </div>
      ) : null}

      <div className="section-title">{t('obs.liveTitle')}</div>
      <div className="panel obs-live">
        <div className="obs-live-state">
          <span className={`led ${obs.streaming ? 'running' : ''}`} aria-hidden />
          <div>
            <div className="stat-value" style={{ color: obs.streaming ? 'var(--rec)' : undefined }}>
              {obs.streaming ? t('dashboard.liveUpper') : t('obs.stopped')}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {obs.streaming
                ? t('obs.liveOnScene', { scene: obs.currentScene ?? '--' })
                : t('obs.liveHint')}
            </div>
          </div>
        </div>
        <div className="btn-row">
          {obs.streaming ? (
            <button
              type="button"
              className="btn danger"
              disabled={!connected}
              onClick={() => void sc.obsToggle('streaming')}
            >
              {t('obs.stopBroadcast')}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ghost${obs.recording ? ' danger' : ''}`}
            disabled={!connected}
            onClick={() => void sc.obsToggle('recording')}
          >
            {obs.recording ? t('obs.stopRecording') : t('obs.startRecording')}
          </button>
        </div>
      </div>

      <div className="section-title">{t('obs.scenesTitle')}</div>
      {!connected ? (
        <div className="panel muted">{t('obs.connectToSee')}</div>
      ) : (
        <div className="scene-cards">
          {obs.scenes.map((scene) => (
            <button
              key={scene.name}
              type="button"
              className={`scene-card${scene.active ? ' live' : ''}${editingScene === scene.name ? ' editing' : ''}`}
              onClick={() => setEditingScene(scene.name)}
            >
              <span className="scene-card-name">{scene.name}</span>
              {scene.active ? <span className="badge live">{t('studio.program')}</span> : null}
              {scene.name === obs.previewScene ? <span className="badge">{t('studio.preview')}</span> : null}
            </button>
          ))}
          <div className="scene-card new">
            <input
              className="input"
              value={newScene}
              placeholder={t('obs.newScenePlaceholder')}
              onChange={(event) => setNewScene(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createScene();
              }}
            />
            <button
              type="button"
              className="btn small primary"
              disabled={newScene.trim().length === 0}
              onClick={() => void createScene()}
            >
              {t('obs.newScene')}
            </button>
          </div>
        </div>
      )}

      {editingScene ? (
        <SceneEditor sc={sc} sceneName={editingScene} onClose={() => setEditingScene(null)} />
      ) : null}

      <div className="section-title">{t('studio.title')}</div>
      <div className="panel">
        <p className="update-intro">{t('studio.intro')}</p>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={obs.studioMode}
            disabled={!connected}
            onChange={(event) => void sc.obsSetStudioMode(event.target.checked)}
          />
          {t('studio.enable')}
        </label>

        {obs.studioMode ? (
          <>
            <div className="studio-grid">
              <div className="studio-stage">
                <div className="studio-stage-head">
                  <span className="badge">{t('studio.preview')}</span>
                </div>
                <div className="studio-stage-scene">{obs.previewScene ?? t('studio.none')}</div>
              </div>
              <button
                type="button"
                className="studio-go"
                onClick={() => void sc.obsTransition()}
                title={t('studio.goHint')}
              >
                <span aria-hidden>&#10132;</span>
                {t('studio.go')}
              </button>
              <div className="studio-stage program">
                <div className="studio-stage-head">
                  <span className="badge live">{t('studio.program')}</span>
                </div>
                <div className="studio-stage-scene">{obs.currentScene ?? t('studio.none')}</div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <span>{t('studio.pickPreview')}</span>
              <div className="scene-list">
                {obs.scenes.map((scene) => (
                  <button
                    key={scene.name}
                    type="button"
                    className={`scene-btn${scene.name === obs.previewScene ? ' active' : ''}`}
                    onClick={() => void sc.obsSetPreviewScene(scene.name)}
                  >
                    {scene.name}
                  </button>
                ))}
              </div>
            </div>

            <TransitionControls sc={sc} />
          </>
        ) : null}
      </div>

      <ObsTutorial sc={sc} />

    </div>
  );
}


/**
 * Reglages de transition.
 *
 * La duree est validee a la fin du glissement : un appel par pixel saturerait
 * OBS et l'interface paraitrait figee. On garde donc une valeur locale pendant
 * le glissement, envoyee au relachement.
 */
function TransitionControls({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const obs = sc.obs;
  const [duration, setDuration] = useState(obs.transitionDurationMs ?? 300);

  useEffect(() => {
    if (typeof obs.transitionDurationMs === 'number') setDuration(obs.transitionDurationMs);
  }, [obs.transitionDurationMs]);

  return (
    <div className="grid grid-2" style={{ marginTop: 12 }}>
      <div className="field">
        <span>{t('studio.transition')}</span>
        <select
          className="input"
          value={obs.currentTransition ?? ''}
          onChange={(event) => void sc.obsSetTransition(event.target.value)}
        >
          {obs.transitions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>{t('studio.duration', { ms: duration })}</span>
        <input
          className="input"
          type="range"
          min={0}
          max={3000}
          step={50}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          onMouseUp={() => void sc.obsSetTransitionDuration(duration)}
          onTouchEnd={() => void sc.obsSetTransitionDuration(duration)}
          onKeyUp={() => void sc.obsSetTransitionDuration(duration)}
        />
      </div>
    </div>
  );
}

/**
 * Configuration d'une scene.
 *
 * On choisit les flux qu'elle affiche (1 a 4). OBS les repartit en grille.
 * L'apercu a droite montre la disposition obtenue avant de valider.
 */
function SceneEditor({
  sc,
  sceneName,
  onClose,
}: {
  sc: StreamControl;
  sceneName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // On pre-coche ce que la scene affiche deja, UNE SEULE FOIS a l'ouverture.
  //
  // Le tableau `sc.streams` change a chaque rafraichissement d'etat (toutes les
  // 1,5 s) : le mettre en dependance relancait cet effet en boucle, et la
  // selection de l'utilisateur etait ecrasee aussitot.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void window.streamcontrol.obsSceneStreams(sceneName).then((names) => {
      if (cancelled) return;
      setSelected((previous) => {
        // On ne remplace pas un choix deja fait par l'utilisateur.
        if (previous.length > 0) return previous;
        return sc.streams
          .filter((endpoint) => names.includes(endpoint.name))
          .map((endpoint) => endpoint.id);
      });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // Volontairement limite a la scene : voir le commentaire ci-dessus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneName]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((entry) => entry !== id);
      if (previous.length >= 4) return previous;
      return [...previous, id];
    });
  };

  /**
   * Applique la configuration a la scene.
   *
   * @param goLive envoie aussi la scene en direct : on configure, on la met au
   *   programme, et on lance la diffusion si elle ne tourne pas.
   */
  const apply = async (goLive: boolean) => {
    setBusy(true);
    try {
      const result = await window.streamcontrol.obsConfigureScene(sceneName, selected);
      sc.notify(result.ok ? 'ok' : 'err', result.message);
      if (!result.ok) return;

      if (goLive) {
        // La scene configuree devient celle qui part en direct.
        await sc.obsSetScene(sceneName);
        const configured = await window.streamcontrol.obsUseStreamControl();
        if (!configured.ok) sc.notify('warn', configured.message);
        await sc.obsToggle('streaming');
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel scene-editor">
      <div className="panel-head">
        <h2 className="panel-title">{t('scene.configTitle', { name: sceneName })}</h2>
        <button type="button" className="btn small ghost" onClick={onClose}>
          {t('action.close')}
        </button>
      </div>

      <div className="scene-editor-grid">
        <div>
          <div className="hint" style={{ marginBottom: 8 }}>{t('scene.pickStreams')}</div>
          {sc.streams.length === 0 ? (
            <p className="muted">{t('obs.pickEmpty')}</p>
          ) : (
            <div className="pick-list">
              {sc.streams.map((endpoint) => {
                const order = selected.indexOf(endpoint.id);
                return (
                  <button
                    key={endpoint.id}
                    type="button"
                    className={`pick-item${order >= 0 ? ' selected' : ''}`}
                    onClick={() => toggle(endpoint.id)}
                  >
                    <span className="pick-order">{order >= 0 ? order + 1 : ''}</span>
                    <span className="pick-name">{endpoint.name}</span>
                    <span className="pick-path">/{endpoint.path}</span>
                    <span className={`led ${endpoint.status.publishing ? 'running' : ''}`} aria-hidden />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t('scene.previewHint', { count: selected.length })}
          </div>
          <ScenePreview
            cells={selected.map((id) => sc.streams.find((endpoint) => endpoint.id === id)?.name ?? '')}
          />
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !loaded}
          onClick={() => void apply(false)}
        >
          {busy ? t('scene.applying') : t('scene.apply')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !loaded || selected.length === 0}
          onClick={() => void apply(true)}
          title={t('scene.applyAndLiveHint')}
        >
          {t('scene.applyAndLive')}
        </button>
      </div>
    </div>
  );
}

/**
 * Apercu de la grille obtenue.
 *
 * On affiche le nom de chaque flux dans sa cellule : l'utilisateur voit
 * exactement quelle adresse ira ou, avant de valider.
 */
function ScenePreview({ cells }: { cells: string[] }) {
  const { t } = useTranslation();
  if (cells.length === 0) {
    return <div className="scene-preview empty">{t('scene.empty')}</div>;
  }
  return (
    <div className={`scene-preview cells-${cells.length}`}>
      {cells.map((name, index) => (
        <span key={`${name}-${index}`} className="scene-cell">
          {name}
        </span>
      ))}
    </div>
  );
}

