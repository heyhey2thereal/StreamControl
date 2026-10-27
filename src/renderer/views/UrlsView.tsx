import { useMemo, useState } from 'react';
import type { StreamEndpointView } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { UrlRow } from '../components/UrlRow';

/** Ouvre le flux d'une adresse dans le navigateur par defaut. */
function useCopyActions(sc: StreamControl) {
  return useMemo(
    () => ({
      copy: (value: string, label: string) => void sc.copy(value, label),
    }),
    [sc],
  );
}

/**
 * Bloc de configuration a coller dans un logiciel de diffusion (OBS, etc.).
 * Le serveur et la cle sont derives de l'URL d'ingestion de l'adresse.
 */
function buildPublisherHint(endpoint: StreamEndpointView): string {
  const url = new URL(endpoint.urls.rtmpIngest);
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  const application = segments[0] ?? 'live';
  const key = segments.slice(1).join('/') || endpoint.streamKey || 'a-la-demande';

  return [
    'Parametres > Diffusion > Service : Personnalise...',
    `Serveur : ${url.protocol}//${url.host}/${application}`,
    `Cle de flux : ${key}`,
  ].join('\n');
}

/** Etat de repli d'une section, conserve entre deux ouvertures de l'onglet. */
const COLLAPSED_KEY = 'streamcontrol.urls.collapsed';
/** Sections explicitement depliees par l'utilisateur. */
const OPENED_KEY = 'streamcontrol.urls.opened';

/** Adresses repliees par l'utilisateur (identifiants). */
function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Un stockage indisponible ne doit pas casser l'affichage.
  }
}

/** Adresses explicitement depliees par l'utilisateur (identifiants). */
function readOpened(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPENED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeOpened(ids: Set<string>): void {
  try {
    window.localStorage.setItem(OPENED_KEY, JSON.stringify([...ids]));
  } catch {
    // Un stockage indisponible ne doit pas casser l'affichage.
  }
}

/** Une section repliable par adresse. */
function EndpointSection({
  endpoint,
  sc,
  defaultExpanded,
}: {
  endpoint: StreamEndpointView;
  sc: StreamControl;
  /** Reglage : deplier par defaut. Les sections sont repliees par defaut. */
  defaultExpanded: boolean;
}) {
  const { t } = useTranslation();
  // Le choix de l'utilisateur prime ; a defaut, c'est le reglage qui decide.
  // Une section repliee le reste tant qu'on ne la rouvre pas.
  const [expanded, setExpanded] = useState(() => {
    const collapsed = readCollapsed();
    if (collapsed.has(endpoint.id)) return false;
    const opened = readOpened();
    if (opened.has(endpoint.id)) return true;
    return defaultExpanded;
  });
  const actions = useCopyActions(sc);
  const publisherHint = buildPublisherHint(endpoint);

  return (
    <section className="urls-section">
      <header className="urls-head">
        <button
          type="button"
          className="urls-toggle"
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            // On note le choix des deux cotes : « ouvert » et « ferme » sont
            // tous deux explicites, et survivent au redemarrage.
            const collapsed = readCollapsed();
            const opened = readOpened();
            if (next) {
              collapsed.delete(endpoint.id);
              opened.add(endpoint.id);
            } else {
              opened.delete(endpoint.id);
              collapsed.add(endpoint.id);
            }
            writeCollapsed(collapsed);
            writeOpened(opened);
          }}
        >
          <span className="urls-caret">{expanded ? '\u25BE' : '\u25B8'}</span>
          <span className="urls-name">{endpoint.name}</span>
          <span className="urls-path">/{endpoint.path}</span>
        </button>
        <span className={`badge ${endpoint.status.publishing ? 'live' : ''}`}>
          {endpoint.status.publishing ? t('state.live') : t('state.offline')}
        </span>
      </header>

      {expanded ? (
        <div className="urls-body">
          <div className="section-title">Ingestion : ou la source publie</div>
          <UrlRow
            label="RTMP"
            hint="Camera, telephone, logiciel de diffusion"
            value={endpoint.urls.rtmpIngest}
            primary
            onCopy={() => actions.copy(endpoint.urls.rtmpIngest, 'RTMP')}
          />
          {endpoint.urls.srtIngest ? (
            <UrlRow
              label={t('url.srt')}
              hint={t('url.srtHint')}
              value={endpoint.urls.srtIngest}
              onCopy={() => actions.copy(endpoint.urls.srtIngest, 'SRT')}
            />
          ) : null}
          {endpoint.urls.rtspIngest ? (
            <UrlRow
              label={t('url.rtsp')}
              hint={t('url.rtspHint')}
              value={endpoint.urls.rtspIngest}
              onCopy={() => actions.copy(endpoint.urls.rtspIngest, 'RTSP')}
            />
          ) : null}

          <div className="section-title">Lecture : ou regarder le flux</div>
          <UrlRow
            label={t('url.hls')}
            hint="VLC, lecteur multimedia, page web"
            value={endpoint.urls.hls}
            onCopy={() => actions.copy(endpoint.urls.hls, 'HLS')}
            onOpen={() => void sc.openExternal(endpoint.urls.hls)}
          />
          <UrlRow
            label={t('url.page')}
            hint={t('url.pageHint')}
            value={endpoint.urls.watch}
            onCopy={() => actions.copy(endpoint.urls.watch, t('url.page'))}
            onOpen={() => void sc.openExternal(endpoint.urls.watch)}
          />
          <UrlRow
            label={t('url.pageDirect')}
            hint={t('url.pageDirectHint')}
            value={endpoint.urls.mediamtxWatch}
            onCopy={() => actions.copy(endpoint.urls.mediamtxWatch, t('url.pageDirect'))}
            onOpen={() => void sc.openExternal(endpoint.urls.mediamtxWatch)}
          />
          <UrlRow
            label="Fenetre"
            hint="Lecture dans une fenetre de StreamControl"
            value={endpoint.urls.watch}
            onCopy={() => actions.copy(endpoint.urls.watch, t('url.page'))}
            onOpen={() => void sc.openStreamWindow(endpoint.id)}
            openLabel={t('action.watch')}
          />
          <UrlRow
            label={t('url.api')}
            hint={t('url.apiHint')}
            value={endpoint.urls.api}
            onCopy={() => actions.copy(endpoint.urls.api, 'API')}
          />

          <div className="section-title">Configuration d'un logiciel de diffusion</div>
          <div className="publisher-hint">
            <pre>{publisherHint}</pre>
            <button
              type="button"
              className="btn small"
              onClick={() => actions.copy(publisherHint, 'Configuration de diffusion')}
            >
              {t('action.copy')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Vue principale : une section par adresse creee. */
export function UrlsView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const host = sc.preflight?.network.primaryIPv4 ?? null;

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sc.streams;
    return sc.streams.filter(
      (endpoint) =>
        endpoint.name.toLowerCase().includes(needle) || endpoint.path.toLowerCase().includes(needle),
    );
  }, [sc.streams, filter]);

  return (
    <div className="content">
      <div className="topbar">
        <div>
          <h1>{t('nav.urls')}</h1>
          <div className="topbar-sub">
            {host
              ? `Construites a partir de l'adresse locale ${host}`
              : 'Adresse locale indisponible'}
            {sc.streams.length > 0
              ? ` \u00b7 ${sc.streams.length > 1 ? t('streams.countPlural', { count: sc.streams.length }) : t('streams.count', { count: sc.streams.length })}`
              : ''}
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void sc.refreshPreflight(true)}
          >
            {t('action.refresh')}
          </button>
        </div>
      </div>

      {sc.streams.length === 0 ? (
        <div className="empty-state">
          <h2>{t('streams.emptyTitle')}</h2>
          <p>{t('streams.emptyBody')}</p>
        </div>
      ) : (
        <>
          {sc.streams.length > 3 ? (
            <div className="list-toolbar">
              <input
                className="input"
                placeholder={t('streams.filter')}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="empty-state">
              <p>{t('streams.noMatch', { filter })}</p>
            </div>
          ) : (
            visible.map((endpoint) => (
              <EndpointSection
                key={endpoint.id}
                endpoint={endpoint}
                sc={sc}
                defaultExpanded={sc.settings?.ui.urlsExpandedByDefault ?? false}
              />
            ))
          )}

          <div className="section-title">Exemple d'utilisation</div>
          <ol className="steps">
            <li>
              <strong>Choisissez une adresse ci-dessus</strong>
              Copiez son URL d&apos;ingestion RTMP.
            </li>
            <li>
              <strong>Saisissez-la dans votre source</strong>
              Camera, telephone ou logiciel de diffusion : cherchez l&apos;option de
              diffusion en direct par RTMP, puis collez l&apos;URL.
            </li>
            <li>
              <strong>Verifiez l&apos;etat</strong>
              L&apos;adresse doit passer « En direct » dans l&apos;onglet Flux. Les journaux
              indiquent la raison si rien ne se passe.
            </li>
            <li>
              <strong>Regardez le flux</strong>
              Ouvrez la page web dans un navigateur, ou la fenetre de lecture dans
              l&apos;application.
            </li>
          </ol>
        </>
      )}
    </div>
  );
}
