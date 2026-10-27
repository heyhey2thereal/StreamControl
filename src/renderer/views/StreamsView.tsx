import { useEffect, useMemo, useState } from 'react';
import type { IngestProtocol, StreamEndpoint, StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Spinner } from '../components/Spinner';

/** Protocoles proposes a la creation, avec leur etat de prise en charge. */
const PROTOCOLS: Array<{ id: IngestProtocol; label: string; hint: string; supported: boolean }> = [
  {
    id: 'rtmp',
    label: 'RTMP',
    hint: 'DJI Mimo, OBS, la plupart des cameras et logiciels de diffusion',
    supported: true,
  },
  {
    id: 'srt',
    label: 'SRT',
    hint: 'Faible latence, resistant aux reseaux instables',
    supported: false,
  },
  {
    id: 'rtsp',
    label: 'RTSP',
    hint: 'Cameras IP et encodeurs professionnels',
    supported: false,
  },
];

interface FormState {
  name: string;
  path: string;
  protocol: IngestProtocol;
  source: string;
  streamKey: string;
  requireKey: boolean;
  segmentDuration: number;
  playlistSize: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  path: '',
  protocol: 'rtmp',
  source: '',
  streamKey: '',
  requireKey: false,
  segmentDuration: 2,
  playlistSize: 6,
};

/** Transforme un nom lisible en chemin technique. */
function pathFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Genere une cle d'acces aleatoire, lisible et copiable. */
function generateKey(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let value = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(rest).padStart(2, '0')} s`;
  return `${rest} s`;
}

function formatBitrate(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(2)} Mbit/s`;
  return `${kbps} kbit/s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${bytes} o`;
}

/** Petit bouton de copie, avec retour visuel. */
function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' copied' : ''}`}
      title={`${t('action.copy')} ${label}`}
      onClick={() => {
        onCopy();
        setCopied(true);
      }}
    >
      {copied ? t('action.copied') : t('action.copy')}
    </button>
  );
}

/** Une ligne d'URL copiable. */
function UrlLine({
  label,
  hint,
  value,
  copy,
  onOpen,
}: {
  label: string;
  hint: string;
  value: string;
  copy: (value: string, label: string) => void;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  if (!value) {
    return (
      <div className="url-line disabled">
        <div className="url-line-label">
          <strong>{label}</strong>
          <span>{hint}</span>
        </div>
        <div className="url-line-value unavailable">{t('streams.notSupported')}</div>
      </div>
    );
  }

  return (
    <div className="url-line">
      <div className="url-line-label">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="url-line-value" title={value}>
        {value}
      </div>
      <div className="url-line-actions">
        <CopyButton label={label} onCopy={() => copy(value, label)} />
        {onOpen ? (
          <button type="button" className="copy-btn" onClick={onOpen} title={t('action.open')}>
            {t('action.open')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Carte d'une adresse : etat, URL, actions. */
function EndpointCard({
  endpoint,
  sc,
  onEdit,
}: {
  endpoint: StreamEndpointView;
  sc: StreamControl;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { status, urls } = endpoint;
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);

  const protocolLabel = PROTOCOLS.find((p) => p.id === endpoint.protocol)?.label ?? endpoint.protocol;
  const uptime = status.startedAt ? Math.round((Date.now() - status.startedAt) / 1000) : 0;

  return (
    <article className={`endpoint${status.publishing ? ' live' : ''}${endpoint.enabled ? '' : ' disabled'}`}>
      <header className="endpoint-head">
        <div className="endpoint-title">
          <span className={`live-dot${status.publishing ? ' on' : ''}`} aria-hidden />
          <div>
            <h3>{endpoint.name}</h3>
            <div className="endpoint-path">
              /{endpoint.path}
              <span className="proto-tag">{protocolLabel}</span>
              {endpoint.streamKey ? <span className="key-tag">{t('streams.keyRequired')}</span> : null}
              {!endpoint.enabled ? <span className="key-tag off">{t('streams.disabled')}</span> : null}
            </div>
          </div>
        </div>

        <div className="endpoint-actions">
          <button
            type="button"
            className="btn small primary"
            disabled={opening}
            onClick={() => {
              // L'ouverture prend un instant (creation de la fenetre) : on le
              // montre, sinon le clic semble sans effet.
              setOpening(true);
              void sc.openStreamWindow(endpoint.id).finally(() => setOpening(false));
            }}
            title={t('action.watch')}
          >
            {opening ? (
              <>
                <Spinner size={13} />
                {t('streams.opening')}
              </>
            ) : (
              t('action.watch')
            )}
          </button>
          <button type="button" className="btn small ghost" onClick={onEdit}>
            {t('action.edit')}
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              // Dupliquer : on reprend les reglages et on laisse le nom a
              // completer, pour ne pas se heurter au chemin deja pris.
              void sc.createStream({
                name: `${endpoint.name} (copie)`,
                path: `${endpoint.path}-copie`,
                protocol: endpoint.protocol,
                source: endpoint.source,
                streamKey: endpoint.streamKey,
                segmentDuration: endpoint.segmentDuration,
                playlistSize: endpoint.playlistSize,
              });
            }}
            title={t('streams.duplicate')}
          >
            {t('streams.duplicate')}
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void sc.updateStream(endpoint.id, { enabled: !endpoint.enabled })}
          >
            {endpoint.enabled ? t('action.disable') : t('action.enable')}
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="btn small danger"
                onClick={() => void sc.deleteStream(endpoint.id)}
              >
                {t('action.confirm')}
              </button>
              <button type="button" className="btn small ghost" onClick={() => setConfirming(false)}>
                {t('action.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className="btn small danger" onClick={() => setConfirming(true)}>
              {t('action.delete')}
            </button>
          )}
        </div>
      </header>

      <div className="endpoint-stats">
        <div className="stat">
          <span className="stat-label">{t('services.state')}</span>
          <span className={`stat-value-sm${status.publishing ? ' ok' : ''}`}>
            {status.publishing ? t('state.live') : t('state.offline')}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.bitrate')}</span>
          <span className="stat-value-sm">{status.publishing ? formatBitrate(status.bitrateKbps) : '--'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.video')}</span>
          <span className="stat-value-sm">
            {status.videoWidth && status.videoHeight ? `${status.videoWidth}x${status.videoHeight}` : '--'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.audio')}</span>
          <span className="stat-value-sm">{status.hasAudio ? t('common.yes') : '--'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.duration')}</span>
          <span className="stat-value-sm">{status.publishing ? formatDuration(uptime) : '--'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.received')}</span>
          <span className="stat-value-sm">{status.bytesReceived > 0 ? formatBytes(status.bytesReceived) : '--'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.viewers')}</span>
          <span className="stat-value-sm">{status.viewers}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('streams.source')}</span>
          <span className="stat-value-sm">{endpoint.source || '--'}</span>
        </div>
      </div>

      <button type="button" className="endpoint-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? t('streams.hideUrls') : t('streams.showUrls')}
      </button>

      {expanded ? (
        <div className="endpoint-urls">
          <div className="urls-toolbar">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                // Tout copier d'un coup : le bloc sert a coller dans un ticket,
                // un message ou un fichier de notes.
                const lines = [
                  `${endpoint.name} (/${endpoint.path})`,
                  `RTMP   ${urls.rtmpIngest}`,
                  `HLS    ${urls.hls}`,
                  `Page   ${urls.watch}`,
                  `WebRTC ${urls.mediamtxWatch}`,
                  `API    ${urls.api}`,
                  `SRT    ${urls.srtIngest}`,
                  `RTSP   ${urls.rtspIngest}`,
                ];
                if (endpoint.streamKey) lines.splice(2, 0, `Cle    ${endpoint.streamKey}`);
                void sc.copy(lines.join('\n'), `${endpoint.name} : toutes les URL`);
              }}
            >
              {t('streams.copyAllUrls')}
            </button>
          </div>
          <UrlLine
            label={t('url.rtmp')}
            hint={t('url.rtmpHint')}
            value={urls.rtmpIngest}
            copy={(v, l) => void sc.copy(v, l)}
          />
          {endpoint.streamKey ? (
            <UrlLine
              label={t('url.key')}
              hint={t('url.keyHint')}
              value={endpoint.streamKey}
              copy={(v, l) => void sc.copy(v, l)}
            />
          ) : null}
          <UrlLine
            label={t('url.hls')}
            hint={t('url.hlsHint')}
            value={urls.hls}
            copy={(v, l) => void sc.copy(v, l)}
            onOpen={() => void sc.openExternal(urls.hls)}
          />
          <UrlLine
            label={t('url.page')}
            hint={t('url.pageHint')}
            value={urls.watch}
            copy={(v, l) => void sc.copy(v, l)}
            onOpen={() => void sc.openExternal(urls.watch)}
          />
          <UrlLine
            label={t('url.pageDirect')}
            hint={t('url.pageDirectHint')}
            value={urls.mediamtxWatch}
            copy={(v, l) => void sc.copy(v, l)}
            onOpen={() => void sc.openExternal(urls.mediamtxWatch)}
          />
          <UrlLine
            label={t('url.api')}
            hint={t('url.apiHint')}
            value={urls.api}
            copy={(v, l) => void sc.copy(v, l)}
          />
          <UrlLine
            label={t('url.srt')}
            hint={t('url.srtHint')}
            value={urls.srtIngest}
            copy={(v, l) => void sc.copy(v, l)}
          />
          <UrlLine
            label={t('url.rtsp')}
            hint={t('url.rtspHint')}
            value={urls.rtspIngest}
            copy={(v, l) => void sc.copy(v, l)}
          />
        </div>
      ) : null}
    </article>
  );
}

/** Formulaire de creation et de modification d'une adresse. */
function EndpointForm({
  sc,
  editing,
  onDone,
}: {
  sc: StreamControl;
  editing: StreamEndpointView | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pathTouched, setPathTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Le formulaire se remplit quand on passe en modification.
  useEffect(() => {
    if (!editing) {
      setForm(EMPTY_FORM);
      setPathTouched(false);
      return;
    }
    setForm({
      name: editing.name,
      path: editing.path,
      protocol: editing.protocol,
      source: editing.source,
      streamKey: editing.streamKey,
      requireKey: editing.streamKey.length > 0,
      segmentDuration: editing.segmentDuration,
      playlistSize: editing.playlistSize,
    });
    setPathTouched(true);
  }, [editing]);

  const effectivePath = pathTouched ? form.path : pathFromName(form.name);
  const protocol = PROTOCOLS.find((p) => p.id === form.protocol);
  const pathError = sc.streams.some(
    (endpoint) => endpoint.path === effectivePath && endpoint.id !== editing?.id,
  )
    ? t('form.pathTaken', { path: effectivePath })
    : '';

  const canSubmit =
    form.name.trim().length > 0 && effectivePath.length > 0 && !pathError && Boolean(protocol?.supported) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const payload: Partial<StreamEndpoint> = {
        name: form.name.trim(),
        path: effectivePath,
        protocol: form.protocol,
        source: form.source.trim(),
        streamKey: form.requireKey ? form.streamKey : '',
        segmentDuration: form.segmentDuration,
        playlistSize: form.playlistSize,
      };

      const result = editing
        ? await sc.updateStream(editing.id, payload)
        : await sc.createStream(payload);

      if (result.ok) onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="endpoint-form">
      <header className="form-head">
        <h2>{editing ? t('form.editTitle', { name: editing.name }) : t('form.newTitle')}</h2>
        <button type="button" className="btn small ghost" onClick={onDone}>
          {t('action.close')}
        </button>
      </header>

      <div className="form-grid">
        <label className="field">
          <span>{t('form.name')}</span>
          <input
            className="input"
            value={form.name}
            placeholder={t('form.namePlaceholder')}
            autoFocus
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <small>{t('form.nameHint')}</small>
        </label>

        <label className="field">
          <span>{t('form.path')}</span>
          <input
            className="input"
            value={effectivePath}
            placeholder="live"
            onChange={(event) => {
              setPathTouched(true);
              setForm({ ...form, path: event.target.value });
            }}
          />
          <small className={pathError ? 'error' : ''}>
            {pathError || t('form.pathFinal', { path: effectivePath || '...' })}
          </small>
        </label>
      </div>

      <div className="field">
        <span>{t('form.protocol')}</span>
        <div className="protocol-picker">
          {PROTOCOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`protocol-option${form.protocol === item.id ? ' selected' : ''}${item.supported ? '' : ' unavailable'}`}
              onClick={() => setForm({ ...form, protocol: item.id })}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
              {!item.supported ? <em>{t('form.notYetSupported')}</em> : null}
            </button>
          ))}
        </div>
        {!protocol?.supported ? (
          <small className="error">{t('form.protocolUnsupported')}</small>
        ) : null}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>{t('form.source')}</span>
          <input
            className="input"
            value={form.source}
            placeholder={t('form.sourcePlaceholder')}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
          />
          <small>{t('form.sourceHint')}</small>
        </label>

        <div className="field">
          <span>{t('form.segment')}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            value={form.segmentDuration}
            onChange={(event) =>
              setForm({ ...form, segmentDuration: Number.parseInt(event.target.value, 10) || 2 })
            }
          />
          <small>{t('form.segmentHint')}</small>
        </div>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.requireKey}
          onChange={(event) =>
            setForm({
              ...form,
              requireKey: event.target.checked,
              streamKey: event.target.checked && !form.streamKey ? generateKey() : form.streamKey,
            })
          }
        />
        {t('form.requireKey')}
      </label>

      {form.requireKey ? (
        <div className="key-row">
          <input
            className="input mono"
            value={form.streamKey}
            onChange={(event) => setForm({ ...form, streamKey: event.target.value })}
          />
          <button
            type="button"
            className="btn small"
            onClick={() => setForm({ ...form, streamKey: generateKey() })}
          >
            {t('form.regenerate')}
          </button>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? t('form.saving') : editing ? t('action.save') : t('form.create')}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          {t('action.cancel')}
        </button>
      </div>
    </section>
  );
}

/** Vue principale : moteur, liste des adresses, formulaire. */
export function StreamsView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StreamEndpointView | null>(null);
  const [filter, setFilter] = useState('');

  const mediamtx = sc.mediamtx;
  const serverRunning = mediamtx.state === 'running';
  const liveCount = sc.streams.filter((endpoint) => endpoint.status.publishing).length;

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sc.streams;
    return sc.streams.filter(
      (endpoint) =>
        endpoint.name.toLowerCase().includes(needle) ||
        endpoint.path.toLowerCase().includes(needle) ||
        endpoint.source.toLowerCase().includes(needle),
    );
  }, [sc.streams, filter]);

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div className="content">
      <div className="topbar">
        <div>
          <h1>{t('streams.title')}</h1>
          <div className="topbar-sub">
            {sc.streams.length > 1
              ? t('streams.countPlural', { count: sc.streams.length })
              : t('streams.count', { count: sc.streams.length })}
            {liveCount > 0 ? `, ${t('streams.liveCount', { count: liveCount })}` : ''}
            {' \u00b7 '}
            {serverRunning ? t('streams.serverActive') : t('streams.serverStopped')}
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`btn small ${serverRunning ? 'ghost' : 'primary'}`}
            disabled={mediamtx.state === 'starting' || mediamtx.state === 'stopping'}
            onClick={() => void (serverRunning ? sc.stopMediamtx() : sc.startMediamtx())}
          >
            {mediamtx.state === 'starting' || mediamtx.state === 'stopping' ? (
              <>
                <Spinner size={13} />
                {mediamtx.state === 'starting' ? t('services.starting') : t('services.stopping')}
              </>
            ) : serverRunning ? (
              t('action.stop')
            ) : (
              t('action.start')
            )}
          </button>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            {t('streams.new')}
          </button>
        </div>
      </div>

      {/* Bandeau d'etat du serveur de flux */}
      <div className={`engine-bar${serverRunning ? ' ok' : ''}${mediamtx.state === 'error' ? ' error' : ''}`}>
        <div className="engine-info">
          {mediamtx.state === 'starting' || mediamtx.state === 'stopping' ? (
            <Spinner size={16} slow />
          ) : (
            <span className={`live-dot${serverRunning ? ' on' : ''}`} aria-hidden />
          )}
          <div>
            <strong>
              {mediamtx.state === 'starting'
                ? t('services.starting')
                : mediamtx.state === 'stopping'
                  ? t('services.stopping')
                  : serverRunning
                    ? t('streams.serverRunning')
                    : t('streams.serverOff')}
            </strong>
            <span>
              {serverRunning
                ? t('streams.ports', {
                    rtmp: sc.settings?.mediamtx.rtmpPort ?? 1935,
                    hls: sc.settings?.mediamtx.hlsPort ?? 8888,
                  })
                : t('streams.serverOffHint')}
            </span>
          </div>
        </div>

        {serverRunning ? (
          <div className="engine-metrics">
            <div>
              <span className="stat-label">{t('state.live')}</span>
              <span className="stat-value-sm">{liveCount}</span>
            </div>
            <div>
              <span className="stat-label">{t('streams.homePage')}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  void sc.openExternal(`http://127.0.0.1:${sc.settings?.mediamtx.webPagesPort ?? 8080}/`)
                }
              >
                {t('action.open')}
              </button>
            </div>
          </div>
        ) : null}

        {mediamtx.detail && mediamtx.state === 'error' ? (
          <div className="engine-error">{mediamtx.detail}</div>
        ) : null}
      </div>

      {creating || editing ? <EndpointForm sc={sc} editing={editing} onDone={closeForm} /> : null}

      {sc.streams.length > 0 ? (
        <div className="list-toolbar">
          <input
            className="input"
            placeholder={t('streams.filter')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      ) : null}

      {sc.streams.length === 0 && !creating ? (
        <div className="empty-state">
          <h2>{t('streams.emptyTitle')}</h2>
          <p>{t('streams.emptyBody')}</p>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {t('streams.emptyAction')}
          </button>
        </div>
      ) : null}

      {visible.length === 0 && sc.streams.length > 0 ? (
        <div className="empty-state">
          <p>{t('streams.noMatch', { filter })}</p>
        </div>
      ) : null}

      <div className="endpoint-list">
        {visible.map((endpoint) => (
          <EndpointCard
            key={endpoint.id}
            endpoint={endpoint}
            sc={sc}
            onEdit={() => {
              setCreating(false);
              setEditing(endpoint);
            }}
          />
        ))}
      </div>
    </div>
  );
}
