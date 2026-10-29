import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTranslator, DEFAULT_LANGUAGE, isLanguage, type TranslationKey } from '../../shared/i18n';
import type {
  AppPaths,
  AppSettings,
  AppUpdateInfo,
  LockState,
  LogEntry,
  ObsStatus,
  PreflightReport,
  ServiceStatus,
  StreamEndpoint,
  StreamEndpointView,
  StreamMutationResult,
  StreamUrls,
  UpdateResult,
  WatchAlert,
} from '../../shared/types';

export interface Notice {
  id: number;
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

/**
 * Bulle produite par une macro (« notifier »).
 *
 * Elle vit dans une liste a part des notifications de l'application : une macro
 * s'affiche en bas a gauche, pour ne pas se melanger aux messages de l'outil.
 */
export interface MacroNotice {
  id: number;
  text: string;
}

export interface StreamControlState {
  ready: boolean;
  fatalError: string | null;
  settings: AppSettings | null;
  preflight: PreflightReport | null;
  mediamtx: ServiceStatus;
  obs: ObsStatus;
  logs: LogEntry[];
  notices: Notice[];
  /** Bulles produites par les macros (« notifier »), en bas a gauche. */
  macroNotices: MacroNotice[];
  /** Adresses de diffusion et leur etat. */
  streams: StreamEndpointView[];
  /** Mise a jour proposee au lancement, si une version est publiee. */
  appUpdate: AppUpdateInfo | null;
  /** Identifiant de la derniere erreur du journal deja vue par l'utilisateur. */
  seenLogErrors: number;
  /** Etat du verrouillage du poste. */
  lock: LockState;
  /** Vrai pendant la visite guidee. */
  onboarding: boolean;
  /** Alertes de surveillance, les plus recentes en tete. */
  alerts: WatchAlert[];
}

const INITIAL_MEDIAMTX: ServiceStatus = { state: 'stopped' };
const INITIAL_OBS: ObsStatus = {
  connected: false,
  connecting: false,
  host: '127.0.0.1',
  port: 4455,
  streaming: false,
  recording: false,
  scenes: [],
  studioMode: false,
  transitions: [],
};

/** Toutes les interactions avec le processus principal passent par ici. */
export function useStreamControl() {
  const api = window.streamcontrol;
  const [state, setState] = useState<StreamControlState>({
    ready: false,
    fatalError: null,
    settings: null,
    preflight: null,
    mediamtx: INITIAL_MEDIAMTX,
    obs: INITIAL_OBS,
    logs: [],
    notices: [],
    macroNotices: [],
    streams: [],
    appUpdate: null,
    seenLogErrors: 0,
    lock: { locked: false, hasPassword: false, hint: '' },
    alerts: [],
    onboarding: false,
  });

  const noticeId = useRef(0);
  /** Identifiants des bulles de macro, pour les retirer une a une. */
  const macroNoticeId = useRef(0);
  const maxLogLines = state.settings?.ui.maxLogLines ?? 2000;

  /**
   * Traduit une cle dans la langue courante.
   *
   * Les notifications sont construites ici, pas dans le rendu : sans ce
   * traducteur, elles restaient en francais meme avec l'interface en anglais.
   */
  const language = isLanguage(state.settings?.ui.language)
    ? state.settings.ui.language
    : DEFAULT_LANGUAGE;
  const tr = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      createTranslator(language)(key, params),
    [language],
  );

  const notify = useCallback((kind: Notice['kind'], text: string) => {
    const id = ++noticeId.current;
    setState((previous) => ({ ...previous, notices: [...previous.notices, { id, kind, text }] }));
    setTimeout(() => {
      setState((previous) => ({
        ...previous,
        notices: previous.notices.filter((notice) => notice.id !== id),
      }));
    }, 4200);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setState((previous) => ({
      ...previous,
      notices: previous.notices.filter((notice) => notice.id !== id),
    }));
  }, []);

  /** Retire une bulle de macro, sur un clic. */
  const dismissMacroNotice = useCallback((id: number) => {
    setState((previous) => ({
      ...previous,
      macroNotices: previous.macroNotices.filter((notice) => notice.id !== id),
    }));
  }, []);

  /**
   * Relit les parametres depuis le processus principal.
   *
   * Utile quand une action modifie les parametres sans passer par le
   * formulaire : definir le mot de passe du Remote, par exemple.
   */
  const refreshSettings = useCallback(async () => {
    const settings = await api.getSettings();
    setState((previous) => ({ ...previous, settings }));
    return settings;
  }, [api]);

  const refreshPreflight = useCallback(async (verbose = false) => {
    try {
      const preflight = await api.refreshPreflight(verbose);
      setState((previous) => ({ ...previous, preflight }));
      return preflight;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [api, notify]);

  // Chargement initial puis abonnement aux evenements du processus principal.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [settings, preflight, logs, mediamtx, obs, streams, lock] = await Promise.all([
          api.getSettings(),
          api.getPreflight(),
          api.getLogs(),
          api.getMediamtxStatus(),
          api.obsGetStatus(),
          api.streamsList(),
          api.lockState(),
        ]);
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          ready: true,
          settings,
          preflight,
          logs,
          mediamtx,
          obs,
          streams,
          lock,
        }));
      } catch (error) {
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          ready: true,
          fatalError: error instanceof Error ? error.message : String(error),
        }));
      }
    })();

    const unsubscribeLog = api.on('log:entry', (entry) => {
      setState((previous) => {
        if (previous.logs.some((existing) => existing.id === entry.id)) return previous;
        const logs = [...previous.logs, entry];
        return {
          ...previous,
          logs: logs.length > maxLogLines ? logs.slice(logs.length - maxLogLines) : logs,
        };
      });
    });

    const unsubscribeService = api.on('service:status', ({ name, status }) => {
      if (name === 'mediamtx') setState((previous) => ({ ...previous, mediamtx: status }));
    });

    const unsubscribeObs = api.on('obs:status', (status) => {
      setState((previous) => ({ ...previous, obs: status }));
    });

    const unsubscribeSettings = api.on('settings:changed', (settings) => {
      setState((previous) => ({
        ...previous,
        settings,
        // Le verrouillage peut venir d'ailleurs que de cette fenetre : le
        // Remote, par exemple. On le reflete donc depuis les parametres, sinon
        // un verrouillage a distance n'afficherait jamais l'ecran de
        // verrouillage.
        lock: {
          locked: settings.ui.locked,
          hasPassword: settings.ui.lockHash.length > 0,
          hint: settings.ui.lockHint,
        },
      }));
    });

    const unsubscribePreflight = api.on('preflight:update', (preflight) => {
      setState((previous) => ({ ...previous, preflight }));
    });

    const unsubscribeStreams = api.on('streams:changed', (streams) => {
      setState((previous) => ({ ...previous, streams }));
    });

    // Un appareil se connecte : on l'annonce tout de suite, c'est ce que
    // l'utilisateur veut savoir quand il branche sa camera.
    const unsubscribeDeviceUp = api.on('device:connected', (device) => {
      const size = device.width && device.height ? ` (${device.width}x${device.height})` : '';
      notify('ok', tr('note.deviceConnected', { device: device.device, name: device.name, size }));
    });

    const unsubscribeDeviceDown = api.on('device:disconnected', (device) => {
      notify('warn', tr('note.deviceDisconnected', { device: device.device, name: device.name }));
    });

    // Un son demande par une macro est joue ici : le processus principal n'a
    // pas de lecteur audio, il transmet le fichier en `data:` URL.
    const unsubscribeSound = api.on('macro:play-sound', ({ dataUrl, volume }) => {
      try {
        const audio = new Audio(dataUrl);
        // Le volume vient du bloc (0 a 100) ; absent, on joue a plein volume.
        audio.volume = typeof volume === 'number' ? Math.max(0, Math.min(1, volume / 100)) : 1;
        void audio.play().catch(() => undefined);
      } catch {
        // Un son qui ne peut pas etre joue ne doit pas interrompre la macro.
      }
    });

    // Une macro « notifier » remonte ici quand la coche le demande : la bulle
    // s'affiche en bas a gauche, a part des notifications de l'application.
    const unsubscribeNotice = api.on('macro:notice', (text) => {
      const id = ++macroNoticeId.current;
      setState((previous) => ({
        ...previous,
        macroNotices: [...previous.macroNotices, { id, text }],
      }));
      // Une bulle de macro disparait plus lentement : elle porte souvent une
      // consigne, et l'operateur ne regarde pas forcement l'ecran a cet instant.
      setTimeout(() => {
        setState((previous) => ({
          ...previous,
          macroNotices: previous.macroNotices.filter((notice) => notice.id !== id),
        }));
      }, 7000);
    });

    return () => {
      cancelled = true;
      unsubscribeLog();
      unsubscribeService();
      unsubscribeObs();
      unsubscribeSettings();
      unsubscribePreflight();
      unsubscribeStreams();
      unsubscribeDeviceUp();
      unsubscribeDeviceDown();
      unsubscribeSound();
      unsubscribeNotice();
    };
  }, [api, maxLogLines, notify, tr]);

  // Rafraichissement periodique de l'etat de la machine.
  useEffect(() => {
    if (!state.ready) return;
    const interval = state.settings?.ui.refreshIntervalMs ?? 5000;
    // Le processus principal interroge MediaMTX et OBS en continu et pousse
    // deja les changements. Ici on ne rafraichit que l'inventaire de la
    // machine (outils, ports) : interroger OBS en plus etait un doublon.
    const timer = setInterval(() => {
      void refreshPreflight();
    }, interval);
    return () => clearInterval(timer);
  }, [api, refreshPreflight, state.ready, state.settings?.ui.refreshIntervalMs]);

  /**
   * Verification des mises a jour au demarrage.
   *
   * On interroge le depot une fois, apres le chargement, pour ne pas ralentir
   * l'affichage. Le resultat est nul quand aucune version n'est publiee, quand
   * le jeton manque, ou quand l'utilisateur a ecarte cette version.
   */
  useEffect(() => {
    if (!state.ready || !state.settings) return;
    let cancelled = false;
    void api
      .checkAppUpdate(false)
      .then((appUpdate) => {
        if (cancelled || !appUpdate) return;
        setState((previous) => ({ ...previous, appUpdate }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, state.ready, state.settings]);

  /**
   * Verifie les mises a jour a la demande (bouton des Parametres).
   * `force` ignore la version ecartee, pour la retrouver apres un refus.
   */
  const checkUpdate = useCallback(
    async (force = true): Promise<AppUpdateInfo | null> => {
      try {
        const appUpdate = await api.checkAppUpdate(force);
        setState((previous) => ({ ...previous, appUpdate }));
        if (!appUpdate) notify('ok', tr('note.noUpdate'));
        return appUpdate;
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [api, notify, tr],
  );

  /**
   * Acquitte les erreurs du journal.
   *
   * La pastille compte les erreurs non encore vues : ouvrir le journal les
   * marque comme vues, et la pastille disparait jusqu'a la prochaine erreur.
   */
  const acknowledgeLogs = useCallback(() => {
    setState((previous) => ({
      ...previous,
      seenLogErrors: previous.logs.reduce(
        (max, entry) => (entry.level === 'error' ? Math.max(max, entry.id) : max),
        previous.seenLogErrors,
      ),
    }));
  }, []);

  /** Relance la visite guidee. */
  const startOnboarding = useCallback(() => {
    setState((previous) => ({ ...previous, onboarding: true }));
  }, []);

  /** Termine la visite et retient qu'elle a ete vue. */
  const finishOnboarding = useCallback(async () => {
    setState((previous) => ({ ...previous, onboarding: false }));
    try {
      await api.saveSettings({ ui: { onboardingDone: true } } as Partial<AppSettings>);
    } catch {
      // Ne pas retenir n'est pas grave : la visite reviendra au prochain
      // demarrage, ce qui vaut mieux que bloquer l'utilisateur.
    }
  }, [api]);

  /** Definit le mot de passe de verrouillage, puis verrouille. */
  const setLockPassword = useCallback(
    async (password: string, hint: string): Promise<LockState> => {
      const lock = await api.lockSetPassword(password, hint);
      setState((previous) => ({ ...previous, lock }));
      notify('ok', tr('note.lockOn'));
      return lock;
    },
    [api, notify, tr],
  );

  /** Verrouille le poste. */
  const lockNow = useCallback(async (): Promise<LockState> => {
    try {
      const lock = await api.lockNow();
      setState((previous) => ({ ...previous, lock }));
      return lock;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return state.lock;
    }
  }, [api, notify, state.lock]);

  /** Tente de deverrouiller. */
  const unlock = useCallback(
    async (password: string): Promise<{ ok: boolean; message?: string }> => {
      const result = await api.unlock(password);
      setState((previous) => ({ ...previous, lock: result.state }));
      return { ok: result.ok, message: result.message };
    },
    [api],
  );

  /** Ferme la fenetre de mise a jour sans rien retenir. */
  const dismissUpdate = useCallback(() => {
    setState((previous) => ({ ...previous, appUpdate: null }));
  }, []);

  /** Ecarte une version : elle ne sera plus proposee. */
  const ignoreUpdate = useCallback(async () => {
    const version = state.appUpdate?.version;
    if (!version) {
      dismissUpdate();
      return;
    }
    try {
      const settings = await api.saveSettings({ ui: { dismissedUpdateVersion: version } } as Partial<AppSettings>);
      setState((previous) => ({ ...previous, settings, appUpdate: null }));
      notify('ok', tr('note.updateIgnored', { version }));
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      dismissUpdate();
    }
  }, [api, dismissUpdate, notify, state.appUpdate?.version]);

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        const settings = await api.saveSettings(patch);
        setState((previous) => ({ ...previous, settings }));
        notify('ok', tr('note.settingsSaved'));
        return settings;
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [api, notify, tr],
  );

  const resetSettings = useCallback(async () => {
    try {
      const settings = await api.resetSettings();
      setState((previous) => ({ ...previous, settings }));
      notify('warn', tr('note.settingsReset'));
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
    }
  }, [api, notify]);

  const runMediamtxAction = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      try {
        const handler =
          action === 'start' ? api.startMediamtx : action === 'stop' ? api.stopMediamtx : api.restartMediamtx;
        const result = await handler();
        setState((previous) => ({ ...previous, mediamtx: result.status }));
        if (result.message) notify(result.ok ? 'ok' : 'err', result.message);
        else if (result.ok) {
          const key =
            action === 'start'
              ? 'note.mediamtxStarted'
              : action === 'stop'
                ? 'note.mediamtxStopped'
                : 'note.mediamtxRestarted';
          notify('ok', tr(key));
        }
        void refreshPreflight();
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr, refreshPreflight],
  );

  const launchObs = useCallback(async () => {
    try {
      const result = await api.launchObs();
      if (result.message) notify(result.ok ? 'ok' : 'err', result.message);
      else notify('ok', tr('note.obsLaunched'));
      void refreshPreflight();
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
    }
  }, [api, notify, refreshPreflight]);

  const obsConnect = useCallback(async () => {
    try {
      const obs = await api.obsConnect();
      setState((previous) => ({ ...previous, obs }));
      if (obs.connected) {
        notify('ok', tr('note.obsConnected', { version: obs.version ? ` (v${obs.version})` : '' }));
      } else {
        notify('err', obs.error ?? tr('note.obsConnectFailed'));
      }
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
    }
  }, [api, notify]);

  const obsDisconnect = useCallback(async () => {
    const obs = await api.obsDisconnect();
    setState((previous) => ({ ...previous, obs }));
  }, [api]);

  const obsSetScene = useCallback(
    async (name: string) => {
      try {
        const obs = await api.obsSetScene(name);
        setState((previous) => ({ ...previous, obs }));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr],
  );

  const obsToggle = useCallback(
    async (kind: 'streaming' | 'recording') => {
      try {
        const obs = kind === 'streaming' ? await api.obsToggleStreaming() : await api.obsToggleRecording();
        setState((previous) => ({ ...previous, obs }));
        if (obs.error) notify('err', obs.error);
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr],
  );

  /** Applique un statut OBS renvoye par une action, et signale une erreur. */
  const applyObsStatus = useCallback(
    (obs: ObsStatus) => {
      setState((previous) => ({ ...previous, obs }));
      if (obs.error) notify('err', obs.error);
    },
    [notify, tr],
  );

  const obsSetStudioMode = useCallback(
    async (enabled: boolean) => {
      try {
        applyObsStatus(await api.obsSetStudioMode(enabled));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, applyObsStatus, notify, tr],
  );

  const obsSetPreviewScene = useCallback(
    async (name: string) => {
      try {
        applyObsStatus(await api.obsSetPreviewScene(name));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, applyObsStatus, notify, tr],
  );

  const obsTransition = useCallback(async () => {
    try {
      applyObsStatus(await api.obsTransition());
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
    }
  }, [api, applyObsStatus, notify]);

  const obsSetTransition = useCallback(
    async (name: string) => {
      try {
        applyObsStatus(await api.obsSetTransition(name));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, applyObsStatus, notify, tr],
  );

  const obsSetTransitionDuration = useCallback(
    async (ms: number) => {
      try {
        applyObsStatus(await api.obsSetTransitionDuration(ms));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, applyObsStatus, notify, tr],
  );

  /** Cree une scene dans OBS. */
  const obsCreateScene = useCallback(
    async (name: string): Promise<{ ok: boolean; message: string }> => {
      try {
        const result = await api.obsCreateScene(name);
        if (result.ok) {
          // La liste des scenes a change : on relit l'etat pour l'afficher.
          setState((previous) => ({ ...previous, obs: { ...previous.obs } }));
          void api.obsGetStatus().then((obs) => setState((previous) => ({ ...previous, obs })));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify('err', message);
        return { ok: false, message };
      }
    },
    [api, notify, tr],
  );

  const downloadMediamtx = useCallback(async (): Promise<UpdateResult | null> => {
    notify('warn', tr('note.mediamtxDownloading'));
    try {
      const result = await api.downloadMediamtx();
      notify(result.ok ? 'ok' : 'err', result.message);
      await refreshPreflight();
      return result;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [api, notify, refreshPreflight]);

  // --- Adresses de diffusion -----------------------------------------------
  const createStream = useCallback(
    async (input: Partial<StreamEndpoint>): Promise<StreamMutationResult> => {
      try {
        const result = await api.streamCreate(input);
        if (result.ok) {
          notify('ok', tr('note.streamCreated', { name: input.name || input.path || '' }));
          const streams = await api.streamsList();
          setState((previous) => ({ ...previous, streams }));
        } else {
          notify('err', result.message ?? tr('note.streamCreateFailed'));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify('err', message);
        return { ok: false, message };
      }
    },
    [api, notify, tr],
  );

  const updateStream = useCallback(
    async (id: string, patch: Partial<StreamEndpoint>): Promise<StreamMutationResult> => {
      try {
        const result = await api.streamUpdate(id, patch);
        if (result.ok) {
          notify('ok', tr('note.streamUpdated'));
          const streams = await api.streamsList();
          setState((previous) => ({ ...previous, streams }));
        } else {
          notify('err', result.message ?? tr('note.streamUpdateFailed'));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify('err', message);
        return { ok: false, message };
      }
    },
    [api, notify, tr],
  );

  /**
   * Active ou desactive l'enregistrement d'un flux.
   *
   * Passe par un canal dedie : l'enregistrement est une action metier a part,
   * et le message de confirmation nomme le flux et l'etat.
   */
  const setStreamRecording = useCallback(
    async (id: string, record: boolean): Promise<StreamMutationResult> => {
      const name = state.streams.find((entry) => entry.id === id)?.name ?? '';
      try {
        const result = await api.streamSetRecording(id, record);
        if (result.ok) {
          notify('ok', record ? tr('note.recordingOn', { name }) : tr('note.recordingOff', { name }));
          const streams = await api.streamsList();
          setState((previous) => ({ ...previous, streams }));
        } else {
          notify('err', result.message ?? tr('note.recordingFailed'));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify('err', message);
        return { ok: false, message };
      }
    },
    [api, notify, tr, state.streams],
  );

  const deleteStream = useCallback(
    async (id: string): Promise<StreamMutationResult> => {
      try {
        const result = await api.streamDelete(id);
        if (result.ok) {
          notify('warn', tr('note.streamDeleted'));
          const streams = await api.streamsList();
          setState((previous) => ({ ...previous, streams }));
        } else {
          notify('err', result.message ?? tr('note.streamDeleteFailed'));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify('err', message);
        return { ok: false, message };
      }
    },
    [api, notify, tr],
  );

  const openStreamWindow = useCallback(
    async (id: string) => {
      try {
        const opened = await api.openStreamWindow(id);
        if (!opened) notify('err', tr('note.viewerUnavailable'));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr],
  );

  const closeStreamWindow = useCallback(
    async (id: string) => {
      await api.closeStreamWindow(id);
    },
    [api],
  );

  const openStorage = useCallback(
    async (directory?: string) => {
      try {
        const result = await api.storageOpen(directory);
        if (!result.ok) notify('err', result.message);
        return result;
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [api, notify, tr],
  );

  /** Ouvre le dossier des enregistrements (cree au besoin). */
  const openRecording = useCallback(async () => {
    try {
      const result = await api.recordingOpen();
      if (!result.ok) notify('err', result.message);
      return result;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [api, notify, tr]);

  /** Ouvre le dossier des replays (cree au besoin). */
  const openReplayFolder = useCallback(async () => {
    try {
      const result = await api.replayOpenFolder();
      if (!result.ok) notify('err', result.message);
      return result;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [api, notify, tr]);

  /**
   * Sauvegarde le replay du dernier flux en direct.
   *
   * Sans flux actif, il n'y a rien a sauvegarder : on le dit, plutot que de
   * laisser croire a une erreur.
   */
  const saveReplayLatest = useCallback(async () => {
    const live = state.streams.filter((stream) => stream.status.publishing);
    const target = live[0];
    if (!target) {
      notify('warn', tr('replay.noLive'));
      return null;
    }
    try {
      const file = await api.replaySave(target.id);
      if (!file) {
        notify('warn', tr('replay.empty'));
        return null;
      }
      notify('ok', tr('replay.saved', { name: target.name }));
      return file;
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [api, notify, tr, state.streams]);

  /**
   * Sauvegarde le replay d'un flux precis.
   *
   * Chaque flux a son propre tampon : on peut donc sauvegarder une camera
   * sans toucher aux autres, ou les prendre toutes d'un coup.
   */
  const saveReplayFor = useCallback(
    async (id: string): Promise<string | null> => {
      const target = state.streams.find((stream) => stream.id === id);
      try {
        const file = await api.replaySave(id);
        if (!file) {
          notify('warn', tr('replay.empty'));
          return null;
        }
        notify('ok', tr('replay.saved', { name: target?.name ?? '' }));
        return file;
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [api, notify, tr, state.streams],
  );

  /** Sauvegarde le replay de tous les flux en direct, en un clic. */
  const saveReplayAll = useCallback(async (): Promise<number> => {
    const live = state.streams.filter((stream) => stream.status.publishing);
    if (live.length === 0) {
      notify('warn', tr('replay.noLive'));
      return 0;
    }
    let saved = 0;
    for (const stream of live) {
      try {
        if (await api.replaySave(stream.id)) saved += 1;
      } catch {
        // Un flux en echec ne doit pas empecher les autres.
      }
    }
    if (saved > 0) notify('ok', tr('replay.savedCount', { count: saved }));
    else notify('warn', tr('replay.empty'));
    return saved;
  }, [api, notify, tr, state.streams]);

  const clearLogs = useCallback(async () => {
    await api.clearLogs();
    setState((previous) => ({ ...previous, logs: [] }));
  }, [api]);

  const copy = useCallback(
    async (text: string, label?: string) => {
      try {
        await api.copyToClipboard(text);
        notify('ok', tr('note.copied', { label: label ?? tr('note.value') }));
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr],
  );

  const openExternal = useCallback(
    async (url: string) => {
      try {
        await api.openExternal(url);
      } catch (error) {
        notify('err', error instanceof Error ? error.message : String(error));
      }
    },
    [api, notify, tr],
  );

  const urls: StreamUrls | null = state.preflight?.urls ?? null;

  /**
   * Chemins reels, fournis par le processus principal.
   *
   * Ne jamais reconstituer un chemin cote rendu : des variables comme
   * %APPDATA% ne sont pas developpees, et l'ouverture du dossier echoue.
   */
  const [paths, setPaths] = useState<AppPaths | null>(null);

  useEffect(() => {
    void api.getPaths().then(setPaths).catch(() => setPaths(null));
  }, [api, state.settings?.files.storagePath]);

  /**
   * Alertes de surveillance, relues regulierement.
   *
   * Elles apparaissent dans le bandeau d'etat : un probleme ne doit pas rester
   * invisible parce que l'operateur regarde un autre onglet.
   */
  useEffect(() => {
    if (!state.ready) return;
    const load = () =>
      void api.watchAlerts().then((alerts) => setState((previous) => ({ ...previous, alerts }))).catch(() => undefined);
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [api, state.ready]);

  const settingsPath = paths?.settingsFile ?? '';

  return useMemo(
    () => ({
      ...state,
      urls,
      settingsPath,
      paths,
      openStorage,
      openRecording,
      openReplayFolder,
      saveReplayLatest,
      saveReplayFor,
      saveReplayAll,
      refreshSettings,
      refreshPreflight,
      saveSettings,
      resetSettings,
      startMediamtx: () => runMediamtxAction('start'),
      stopMediamtx: () => runMediamtxAction('stop'),
      restartMediamtx: () => runMediamtxAction('restart'),
      launchObs,
      obsConnect,
      obsDisconnect,
      obsSetScene,
      obsToggle,
      obsCreateScene,
      obsSetStudioMode,
      obsSetPreviewScene,
      obsTransition,
      obsSetTransition,
      obsSetTransitionDuration,
      downloadMediamtx,
      createStream,
      updateStream,
      setStreamRecording,
      deleteStream,
      openStreamWindow,
      closeStreamWindow,
      clearLogs,
      copy,
      openExternal,
      notify,
      dismissNotice,
      dismissMacroNotice,
      checkUpdate,
      dismissUpdate,
      ignoreUpdate,
      acknowledgeLogs,
      startOnboarding,
      finishOnboarding,
      setLockPassword,
      lockNow,
      unlock,
      platform: api.platform,
      appVersion: api.appVersion,
    }),
    [
      state,
      urls,
      settingsPath,
      paths,
      openStorage,
      openRecording,
      openReplayFolder,
      saveReplayLatest,
      saveReplayFor,
      saveReplayAll,
      refreshSettings,
      refreshPreflight,
      saveSettings,
      resetSettings,
      runMediamtxAction,
      launchObs,
      obsConnect,
      obsDisconnect,
      obsSetScene,
      obsToggle,
      obsSetStudioMode,
      obsSetPreviewScene,
      obsTransition,
      obsSetTransition,
      obsSetTransitionDuration,
      downloadMediamtx,
      createStream,
      updateStream,
      setStreamRecording,
      deleteStream,
      openStreamWindow,
      closeStreamWindow,
      clearLogs,
      copy,
      openExternal,
      notify,
      dismissNotice,
      dismissMacroNotice,
      checkUpdate,
      dismissUpdate,
      ignoreUpdate,
      acknowledgeLogs,
      startOnboarding,
      finishOnboarding,
      setLockPassword,
      lockNow,
      unlock,
      api.platform,
      api.appVersion,
    ],
  );
}

export type StreamControl = ReturnType<typeof useStreamControl>;
