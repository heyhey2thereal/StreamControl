import { useEffect, useState } from 'react';
import logo from './assets/logo.png';
import { Spinner } from './components/Spinner';
import { Toasts } from './components/Toasts';
import { LockScreen } from './components/LockScreen';
import { Onboarding } from './components/Onboarding';
import { UpdateDialog } from './components/UpdateDialog';
import { TranslationProvider, useTranslation } from './hooks/useTranslation';
import { useTheme } from './hooks/useTheme';
import { useStreamControl, type StreamControl } from './hooks/useStreamControl';
import { DashboardView } from './views/DashboardView';
import { FaqView } from './views/FaqView';
import { GuideView } from './views/GuideView';
import { LogsView } from './views/LogsView';
import { ObsView } from './views/ObsView';
import { ServicesView } from './views/ServicesView';
import { StreamsView } from './views/StreamsView';
import { SettingsView } from './views/SettingsView';
import { UrlsView } from './views/UrlsView';
import type { TranslationKey } from '../shared/i18n';

type ViewId =
  | 'dashboard'
  | 'streams'
  | 'services'
  | 'urls'
  | 'obs'
  | 'logs'
  | 'settings'
  | 'guide'
  | 'faq';

const NAV: Array<{ id: ViewId; icon: string; label: TranslationKey }> = [
  { id: 'dashboard', icon: '\u25A3', label: 'nav.dashboard' },
  { id: 'streams', icon: '\u25B6', label: 'nav.streams' },
  { id: 'services', icon: '\u2699', label: 'nav.services' },
  { id: 'urls', icon: '\u26A1', label: 'nav.urls' },
  { id: 'obs', icon: '\u25CF', label: 'nav.obs' },
  { id: 'logs', icon: '\u2263', label: 'nav.logs' },
  { id: 'settings', icon: '\u2692', label: 'nav.settings' },
  { id: 'guide', icon: '\u2139', label: 'nav.guide' },
  { id: 'faq', icon: '\u003F', label: 'nav.faq' },
];

/**
 * Enveloppe l'interface dans le fournisseur de langue.
 *
 * La langue vit dans les parametres : elle est lue apres le chargement initial,
 * et un changement s'applique aussitot, sans redemarrage.
 */
export default function App() {
  const sc = useStreamControl();
  useTheme(sc.settings?.ui.theme);
  return (
    <TranslationProvider language={sc.settings?.ui.language}>
      <Shell sc={sc} />
    </TranslationProvider>
  );
}

function Shell({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewId>('dashboard');

  /**
   * Raccourcis clavier globaux.
   *
   * Ctrl+1..8 : changer d'onglet. Ctrl+R : redemarrer MediaMTX (raccourci
   * metier utile pendant une session). Echap : fermer la fenetre de mise a
   * jour. On ignore les frappes saisies dans un champ, sinon taper « r » dans
   * un nom de flux declencherait un redemarrage.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;

      if (event.ctrlKey && !event.shiftKey && !event.altKey) {
        const index = Number.parseInt(event.key, 10);
        if (index >= 1 && index <= NAV.length) {
          event.preventDefault();
          setView(NAV[index - 1].id);
          return;
        }
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          void sc.restartMediamtx();
          return;
        }
      }

      if (event.key === 'Escape') sc.dismissUpdate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sc]);

  // Tous les hooks doivent s'executer avant le moindre retour anticipe : un
  // useEffect place apres un `return` n'est jamais monte, et React desynchronise
  // alors son etat interne (c'est ce qui empechait l'ecran de verrouillage
  // d'apparaitre).
  //
  // Premiere visite : on lance la visite guidee une fois, apres le chargement.
  useEffect(() => {
    if (!sc.ready || sc.settings?.ui.onboardingDone || sc.lock.locked) return;
    sc.startOnboarding();
    // Volontairement au seul passage a `ready` : relancer a chaque changement
    // de reglages serait insupportable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc.ready]);

  // Le poste verrouille masque toute l'interface : c'est le but.
  if (sc.ready && sc.lock.locked) {
    return <LockScreen sc={sc} />;
  }

  if (!sc.ready) {
    return (
      <div className="app">
        <div />
        <div className="main">
          <div className="loading-screen">
            <Spinner size={40} />
            <div className="muted">{t('app.initializing')}</div>
          </div>
        </div>
      </div>
    );
  }

  // Seules les erreurs non encore vues sont comptees : ouvrir le journal les
  // acquitte, et la pastille ne revient qu'a la prochaine erreur.
  const errorCount = sc.logs.filter(
    (entry) => entry.level === 'error' && entry.id > sc.seenLogErrors,
  ).length;
  const liveCount = sc.streams.filter((endpoint) => endpoint.status.publishing).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="" width={30} height={30} />
          <div className="brand-text">
            <strong>StreamControl</strong>
          </div>
        </div>

        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              data-tour={`nav-${item.id}`}
              className={`nav-item${view === item.id ? ' active' : ''}`}
              onClick={() => {
                setView(item.id);
                // Ouvrir le journal vaut acquittement : la pastille disparait.
                if (item.id === 'logs') sc.acknowledgeLogs();
              }}
              style={{ width: '100%' }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{t(item.label)}</span>
              {item.id === 'logs' && errorCount > 0 ? (
                <span className="badge err" style={{ marginLeft: 'auto' }}>
                  {errorCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {sc.appUpdate ? (
            <button
              type="button"
              className="update-badge"
              onClick={() => void sc.checkUpdate(true)}
              title={t('update.title')}
            >
              <span className="dot-ping" aria-hidden />
              {t('update.availableBadge', { version: sc.appUpdate.version })}
            </button>
          ) : null}
          <button
            type="button"
            className="lock-button"
            onClick={() => {
              if (sc.lock.hasPassword) void sc.lockNow();
              else setView('settings');
            }}
          >
            <span aria-hidden>&#128274;</span>
            {sc.lock.hasPassword ? t('lock.lockNow') : t('lock.define')}
          </button>
          <div className="sidebar-meta">Version {sc.appVersion}</div>
        </div>
      </aside>

      <main className="main">
        <div className="status-strip">
          <span className={`pill ${sc.mediamtx.state === 'running' ? 'ok' : sc.mediamtx.state === 'error' ? 'err' : ''}`}>
            <span className={`led ${sc.mediamtx.state}`} aria-hidden />
            MediaMTX {sc.mediamtx.state}
          </span>
          <span className={`pill ${sc.obs.connected ? 'ok' : ''}`}>
            <span className={`led ${sc.obs.connected ? 'connected' : ''}`} aria-hidden />
            OBS {sc.obs.connected ? t('state.connected') : t('state.offline')}
          </span>
          {liveCount > 0 ? <span className="pill live">{liveCount} {t('state.live')}</span> : null}
        </div>

        {sc.fatalError ? (
          <div style={{ padding: 22 }}>
            <div className="alert err">
              <div>
                <strong>{t('app.initError')}</strong>
                <div style={{ marginTop: 6 }}>{sc.fatalError}</div>
              </div>
            </div>
          </div>
        ) : null}

        {view === 'dashboard' ? <DashboardView sc={sc} onNavigate={setView} /> : null}
        {view === 'streams' ? <StreamsView sc={sc} /> : null}
        {view === 'services' ? <ServicesView sc={sc} /> : null}
        {view === 'urls' ? <UrlsView sc={sc} /> : null}
        {view === 'obs' ? <ObsView sc={sc} /> : null}
        {view === 'logs' ? <LogsView sc={sc} /> : null}
        {view === 'settings' ? <SettingsView sc={sc} /> : null}
        {view === 'guide' ? <GuideView sc={sc} /> : null}
        {view === 'faq' ? <FaqView /> : null}
      </main>

      <Toasts notices={sc.notices} onDismiss={sc.dismissNotice} />
      <UpdateDialog sc={sc} />
      {sc.onboarding ? <Onboarding onFinish={() => void sc.finishOnboarding()} /> : null}
    </div>
  );
}
