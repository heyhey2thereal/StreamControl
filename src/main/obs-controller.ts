import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ObsScene, ObsStatus, ServiceActionResult } from '../shared/types';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';
import { detectTool } from './detection';
import { isTcpReachable } from './network';
import { ObsClient } from './obs-client';

/**
 * Couche metier autour d'OBS Studio :
 * - detection et lancement de obs64.exe ;
 * - connexion au serveur obs-websocket v5 ;
 * - lecture/ecriture de l'etat (scenes, streaming, enregistrement).
 */
export class ObsController extends EventEmitter {
  private readonly client: ObsClient;
  private status: ObsStatus = {
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

  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
  ) {
    super();
    this.client = new ObsClient(logger);

    this.client.on('state', (state: string) => {
      const { host, port } = this.settings.get().obs;
      this.status = {
        ...this.status,
        host,
        port,
        connected: state === 'connected',
        connecting: state === 'connecting',
        authFailed: state === 'auth-failed',
      };
      this.emitStatus();
      if (state === 'connected') void this.refresh();
    });

    this.client.on('disconnected', () => {
      this.status = {
        ...this.status,
        connected: false,
        connecting: false,
        streaming: false,
        recording: false,
        scenes: [],
        currentScene: undefined,
        error: 'Connexion perdue. OBS est peut-etre ferme.',
      };
      this.emitStatus();
    });

    // Les evenements d'OBS sont traduits en rafraichissements de statut.
    this.client.on('event', (eventType: string, data: Record<string, unknown>) => {
      switch (eventType) {
        case 'CurrentPreviewSceneChanged':
          this.status.previewScene = String(data.sceneName ?? this.status.previewScene ?? '');
          void this.refresh();
          break;
        case 'StudioModeStateChanged':
          this.status.studioMode = data.studioModeEnabled === true;
          this.emitStatus();
          void this.refresh();
          break;
        case 'CurrentSceneTransitionChanged':
          void this.refresh();
          break;
        case 'CurrentProgramSceneChanged':
          this.status.currentScene = String(data.sceneName ?? this.status.currentScene ?? '');
          this.markActiveScene();
          this.emitStatus();
          // Une scene peut avoir ete creee ou renommee juste avant : on relit
          // la liste pour que l'interface ne reste pas sur une liste perimee.
          void this.refresh();
          break;
        // Toute modification de la liste des scenes doit remonter a l'interface.
        // OBS 30+ emet SceneCreated / SceneRemoved / SceneNameChanged, et
        // SceneListChanged dans tous les cas.
        case 'SceneListChanged':
        case 'SceneCreated':
        case 'SceneRemoved':
        case 'SceneNameChanged':
          void this.refresh();
          break;
        case 'StreamStateChanged':
          // `outputActive` dit si la sortie tourne vraiment. OBS refuse par
          // ailleurs une diffusion mal configuree en laissant la sortie
          // inactive, sans refuser la requete : c'est ici qu'on le voit.
          this.status.streaming = data.outputActive === true;
          this.emitStatus();
          void this.refresh();
          break;
        case 'RecordStateChanged':
          this.status.recording = data.outputActive === true;
          this.emitStatus();
          void this.refresh();
          break;
        default:
          break;
      }
    });
  }

  getStatus(): ObsStatus {
    return { ...this.status, scenes: [...this.status.scenes] };
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private markActiveScene(): void {
    this.status.scenes = this.status.scenes.map((scene) => ({
      ...scene,
      active: scene.name === this.status.currentScene,
    }));
  }

  private async resolveExecutable(): Promise<string | null> {
    const { obsExecutablePath } = this.settings.get();
    const detected = await detectTool('obs', {
      logger: this.logger,
      overridePath: obsExecutablePath,
    });
    return detected.found && detected.path ? detected.path : null;
  }

  /** Lance OBS Studio si l'executable est detecte et s'il ne tourne pas deja. */
  async launchObs(): Promise<ServiceActionResult> {
    const { host, port } = this.settings.get().obs;

    if (await isTcpReachable(host, port, 900)) {
      this.logger.info('obs', 'OBS repond deja sur le port WebSocket, lancement inutile.');
      return {
        ok: true,
        status: { state: 'running', detail: 'OBS semble deja demarre.' },
        message: 'OBS est deja en cours d\'execution.',
      };
    }

    const executable = await this.resolveExecutable();
    if (!executable) {
      const message =
        'obs64.exe introuvable. Installez OBS Studio depuis obsproject.com ou indiquez le chemin dans les Parametres.';
      this.logger.error('obs', message);
      return { ok: false, status: { state: 'error', detail: message }, message };
    }

    this.logger.info('obs', `Lancement d'OBS : ${executable}`);
    try {
      const child = spawn(executable, ['--disable-shutdown-check'], {
        cwd: path.dirname(executable),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      this.logger.info('obs', `OBS demarre (PID ${child.pid}). Le chargement de l'interface prend quelques secondes.`);

      // Laisse le temps au serveur WebSocket de devenir disponible.
      if (this.settings.get().obs.autoConnect) {
        void this.waitAndConnect();
      }

      return {
        ok: true,
        status: { state: 'running', pid: child.pid, startedAt: Date.now(), detail: 'OBS lance.' },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Lancement d\'OBS impossible');
      return { ok: false, status: { state: 'error', detail: message }, message };
    }
  }

  /** Attend l'ouverture du port WebSocket puis se connecte (max ~20 s). */
  private async waitAndConnect(): Promise<void> {
    const { host, port } = this.settings.get().obs;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      if (await isTcpReachable(host, port, 800)) {
        this.logger.info('obs', `Serveur WebSocket disponible (tentative ${attempt}).`);
        await this.connect();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.logger.warn('obs', 'OBS n\'a pas ouvert son port WebSocket dans le delai prevu.');
  }

  async connect(): Promise<ObsStatus> {
    const { host, port, password } = this.settings.get().obs;
    this.status = { ...this.status, host, port, connecting: true, error: undefined, authFailed: false };
    this.emitStatus();

    try {
      await this.client.connect({ host, port, password });
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        connected: false,
        connecting: false,
        error: message,
        authFailed: this.client.getState() === 'auth-failed',
      };
      this.emitStatus();
    }
    return this.getStatus();
  }

  async disconnect(): Promise<ObsStatus> {
    this.client.disconnect();
    this.status = {
      ...this.status,
      connected: false,
      connecting: false,
      streaming: false,
      recording: false,
      scenes: [],
      currentScene: undefined,
    };
    this.emitStatus();
    return this.getStatus();
  }

  /** Recharge version, etats et liste des scenes depuis OBS. */
  async refresh(): Promise<ObsStatus> {
    if (this.client.getState() !== 'connected') return this.getStatus();

    try {
      const versionInfo = await this.client.request<{ obsVersion?: string; obsWebSocketVersion?: string }>(
        'GetVersion',
      );
      const sceneList = await this.client.request<{
        currentProgramSceneName?: string;
        scenes?: Array<{ sceneName: string }>;
      }>('GetSceneList');
      const streamStatus = await this.client.request<{ outputActive?: boolean }>('GetStreamStatus');
      const recordStatus = await this.client.request<{ outputActive?: boolean }>('GetRecordStatus');

      // Mode studio : OBS distingue la scene « programme » (diffusee) de la
      // scene « previsualisation » (preparee). Les requetes existent depuis la
      // v5, mais on tolere leur absence pour ne pas casser la connexion.
      let studioMode = false;
      let previewScene: string | undefined;
      try {
        const studio = await this.client.request<{ studioModeEnabled?: boolean }>('GetStudioModeEnabled');
        studioMode = studio.studioModeEnabled === true;
        if (studioMode) {
          const preview = await this.client.request<{ currentPreviewSceneName?: string }>(
            'GetCurrentPreviewScene',
          );
          previewScene = preview.currentPreviewSceneName;
        }
      } catch {
        studioMode = false;
      }

      let transitions: string[] = [];
      let currentTransition: string | undefined;
      let transitionDurationMs: number | undefined;
      try {
        const list = await this.client.request<{
          transitions?: Array<{ transitionName?: string }>;
          currentSceneTransitionName?: string;
          currentSceneTransitionDuration?: number;
        }>('GetSceneTransitionList');
        transitions = (list.transitions ?? [])
          .map((entry) => entry.transitionName)
          .filter((entry): entry is string => Boolean(entry));
        currentTransition = list.currentSceneTransitionName;
        transitionDurationMs = list.currentSceneTransitionDuration;
      } catch {
        transitions = [];
      }

      const currentScene = sceneList.currentProgramSceneName;
      const scenes: ObsScene[] = (sceneList.scenes ?? []).map((scene) => ({
        name: scene.sceneName,
        active: scene.sceneName === currentScene,
      }));

      this.status = {
        ...this.status,
        connected: true,
        connecting: false,
        authFailed: false,
        version: versionInfo.obsVersion,
        currentScene,
        scenes,
        streaming: Boolean(streamStatus.outputActive),
        recording: Boolean(recordStatus.outputActive),
        studioMode,
        previewScene,
        transitions,
        currentTransition,
        transitionDurationMs,
        // Les sources sont relues ici : l'editeur de macros les propose, et
        // une source ajoutee dans OBS apparait sans redemarrer StreamControl.
        sources: await this.listSources(),
        error: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Lecture de l\'etat OBS impossible');
      this.status = { ...this.status, error: message };
    }

    this.emitStatus();
    return this.getStatus();
  }

  async setScene(sceneName: string): Promise<ObsStatus> {
    if (!sceneName) return this.getStatus();
    try {
      await this.client.request('SetCurrentProgramScene', { sceneName });
      this.status.currentScene = sceneName;
      this.markActiveScene();
      this.logger.info('obs', `Scene active : ${sceneName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, `Changement de scene (${sceneName}) impossible`);
      this.status.error = message;
    }
    this.emitStatus();
    return this.getStatus();
  }

  /**
   * Active ou desactive le mode studio.
   *
   * En mode studio, on prepare une scene en previsualisation avant de la
   * diffuser : c'est ce qui permet d'enchainer deux adresses sans couper.
   */
  async setStudioMode(enabled: boolean): Promise<ObsStatus> {
    try {
      await this.client.request('SetStudioModeEnabled', { studioModeEnabled: enabled });
      this.logger.info('obs', enabled ? 'Mode studio active.' : 'Mode studio desactive.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Changement de mode studio impossible');
      this.status = { ...this.status, error: message };
    }
    return this.refresh();
  }

  /** Prepare une scene en previsualisation (mode studio). */
  async setPreviewScene(sceneName: string): Promise<ObsStatus> {
    if (!sceneName) return this.getStatus();
    try {
      await this.client.request('SetCurrentPreviewScene', { sceneName });
      this.status = { ...this.status, previewScene: sceneName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, `Previsualisation de « ${sceneName} » impossible`);
      this.status = { ...this.status, error: message };
    }
    return this.refresh();
  }

  /** Envoie la previsualisation en programme, avec la transition choisie. */
  async transition(): Promise<ObsStatus> {
    try {
      await this.client.request('TriggerStudioModeTransition');
      this.logger.info('obs', 'Transition declenchee.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Transition impossible');
      this.status = { ...this.status, error: message };
    }
    // La scene programme change : on laisse OBS emettre l'evenement, mais on
    // relit aussi tout de suite pour que l'interface ne reste pas en arriere.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return this.refresh();
  }

  /** Change la transition utilisee par OBS (fondu, coupe...). */
  async setTransition(name: string): Promise<ObsStatus> {
    if (!name) return this.getStatus();
    try {
      await this.client.request('SetCurrentSceneTransition', { transitionName: name });
      this.logger.info('obs', `Transition : ${name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Changement de transition impossible');
      this.status = { ...this.status, error: message };
    }
    return this.refresh();
  }

  /** Change la duree de la transition, en millisecondes. */
  async setTransitionDuration(ms: number): Promise<ObsStatus> {
    const duration = Math.min(20000, Math.max(0, Math.round(ms)));
    try {
      await this.client.request('SetCurrentSceneTransitionDuration', { transitionDuration: duration });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Changement de duree de transition impossible');
      this.status = { ...this.status, error: message };
    }
    return this.refresh();
  }

  async toggleStreaming(): Promise<ObsStatus> {
    const starting = !this.status.streaming;
    let failure: string | null = null;

    try {
      await this.client.request(starting ? 'StartStream' : 'StopStream');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Commande de diffusion impossible');
      failure = message;
    }

    if (!failure && starting) {
      // OBS accepte StartStream puis echoue en silence quand la sortie est mal
      // configuree (service absent, cle de flux refusee, encodeur
      // indisponible). On verifie donc que la sortie tourne vraiment.
      if (await this.waitForStreamActive()) {
        this.logger.info('obs', 'Diffusion demarree.');
      } else {
        failure =
          "OBS n'a pas demarre la sortie : la diffusion a echoue. Verifiez dans OBS " +
          'Parametres > Diffusion (service et cle de flux renseignes) puis ' +
          "Parametres > Sortie (encodeur disponible), et regardez la barre d'etat d'OBS.";
        this.logger.error('obs', failure);
      }
    } else if (!failure) {
      this.logger.info('obs', 'Diffusion arretee.');
    }

    // Le rafraichissement remet `error` a zero : on applique le message apres.
    const status = await this.refresh();
    if (failure) {
      this.status = { ...this.status, error: failure };
      this.emitStatus();
      return this.getStatus();
    }
    return status;
  }

  /** Attend que la sortie de diffusion soit reellement active (max ~6 s). */
  private async waitForStreamActive(): Promise<boolean> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const status = await this.client.request<{ outputActive?: boolean }>('GetStreamStatus');
        if (status.outputActive === true) return true;
      } catch {
        // OBS n'a pas repondu : on retente jusqu'a l'echeance.
      }
    }
    return false;
  }

  async toggleRecording(): Promise<ObsStatus> {
    try {
      await this.client.request(this.status.recording ? 'StopRecord' : 'StartRecord');
      this.logger.info('obs', this.status.recording ? 'Enregistrement arrete.' : 'Enregistrement demarre.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Commande d\'enregistrement impossible');
      this.status.error = message;
    }
    return this.refresh();
  }

  /** Verifie que le binaire OBS est bien present (sans le lancer). */
  async checkInstalled(): Promise<{ found: boolean; path?: string }> {
    const executable = await this.resolveExecutable();
    return { found: Boolean(executable), path: executable ?? undefined };
  }

  /**
   * Configure OBS pour publier vers StreamControl.
   *
   * OBS distingue « diffuser » (envoyer sa scene vers un service) de
   * « enregistrer ». On renseigne un service personnalise pointant sur notre
   * adresse RTMP. `SaveStreamSettings` n'existe pas dans obs-websocket v5 :
   * `SetStreamServiceSettings` ecrit deja la configuration.
   */
  async useStreamControl(server: string, key: string): Promise<{ ok: boolean; message: string }> {
    if (this.client.getState() !== 'connected') {
      return { ok: false, message: 'Connectez-vous a OBS avant de configurer la diffusion.' };
    }
    if (!server) {
      return { ok: false, message: "Creez d'abord une adresse dans l'onglet Flux." };
    }

    try {
      await this.client.request('SetStreamServiceSettings', {
        streamServiceType: 'rtmp_custom',
        streamServiceSettings: { server, key, use_auth: false },
      });

      const current = await this.client.request<{
        streamServiceType?: string;
        streamServiceSettings?: { server?: string };
      }>('GetStreamServiceSettings');

      const applied = current.streamServiceSettings?.server ?? '';
      if (applied && applied !== server) {
        return { ok: false, message: `OBS a conserve un autre serveur : ${applied}` };
      }

      this.logger.info('obs', `Diffusion OBS configuree vers ${server}.`);
      return { ok: true, message: `OBS publiera vers ${server}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Configuration de la diffusion OBS impossible');
      return { ok: false, message };
    }
  }

  /** Prefixe des sources creees par StreamControl. */
  private static readonly SOURCE_PREFIX = 'StreamControl - ';

  /**
   * Prepare une scene : elle affiche de 1 a 4 flux, repartis en grille.
   *
   * Chaque flux devient une source navigateur pointant sur notre page
   * `/embed`, posee dans une cellule du canevas. Une seule source remplit
   * l'ecran ; deux se partagent la largeur ; trois laissent la moitie basse au
   * troisieme ; quatre forment une grille 2x2.
   *
   * Les sources de StreamControl qui ne sont plus utilisees sont retirees de
   * la scene, pour qu'une ancienne adresse ne reste pas affichee par erreur.
   */
  async configureScene(
    sceneName: string,
    sources: Array<{ name: string; url: string }>,
  ): Promise<{ ok: boolean; message: string }> {
    if (this.client.getState() !== 'connected') {
      return { ok: false, message: "Connectez-vous a OBS avant de configurer une scene." };
    }
    if (!sceneName) {
      return { ok: false, message: 'Choisissez une scene.' };
    }

    const kept = sources.slice(0, 4);

    try {
      // La scene peut ne pas exister encore : on la cree.
      try {
        await this.client.request('CreateScene', { sceneName });
      } catch {
        // Elle existe deja : c'est le cas normal.
      }

      const video = await this.client.request<{ baseWidth?: number; baseHeight?: number }>(
        'GetVideoSettings',
      );
      const width = video.baseWidth ?? 1920;
      const height = video.baseHeight ?? 1080;
      const cells = layoutCells(kept.length, width, height);

      const wanted = new Set(kept.map((entry) => `${ObsController.SOURCE_PREFIX}${entry.name}`));
      await this.removeStaleSources(sceneName, wanted);

      for (let index = 0; index < kept.length; index += 1) {
        const entry = kept[index];
        const inputName = `${ObsController.SOURCE_PREFIX}${entry.name}`;
        const cell = cells[index];
        const inputSettings = {
          url: entry.url,
          width,
          height,
          shutdown: false,
          restart_when_active: false,
        };

        if (await this.inputExists(inputName)) {
          await this.client.request('SetInputSettings', { inputName, inputSettings, overlay: true });
        } else {
          await this.client.request('CreateInput', {
            sceneName,
            inputName,
            inputKind: 'browser_source',
            inputSettings,
            sceneItemEnabled: true,
          });
        }

        const sceneItemId = await this.ensureSceneItem(sceneName, inputName);

        // On dimensionne par « bounds » plutot qu'en echelle : la source garde
        // son rapport, donc l'image n'est pas deformee, et la cellule est
        // entierement remplie.
        await this.client.request('SetSceneItemTransform', {
          sceneName,
          sceneItemId,
          sceneItemTransform: {
            positionX: cell.x,
            positionY: cell.y,
            scaleX: 1,
            scaleY: 1,
            alignment: 5,
            boundsType: 'OBS_BOUNDS_SCALE_INNER',
            boundsAlignment: 0,
            boundsWidth: cell.width,
            boundsHeight: cell.height,
            cropLeft: 0,
            cropRight: 0,
            cropTop: 0,
            cropBottom: 0,
          },
        });
      }

      this.logger.info(
        'obs',
        `Scene « ${sceneName} » configuree : ${kept.length} flux (${width}x${height}).`,
      );
      return {
        ok: true,
        message:
          kept.length === 0
            ? `Scene « ${sceneName} » videe.`
            : `Scene « ${sceneName} » : ${kept.length} flux en grille.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, `Configuration de la scene « ${sceneName} » impossible`);
      return { ok: false, message };
    }
  }

  /**
   * Noms des adresses deja affichees par une scene.
   *
   * On relit les sources de la scene et on ne garde que les notres : l'editeur
   * peut ainsi pre-cocher ce qui est deja en place.
   */
  async sceneStreams(sceneName: string): Promise<string[]> {
    if (this.client.getState() !== 'connected') return [];
    try {
      const items = await this.client.request<{
        sceneItems?: Array<{ sourceName?: string }>;
      }>('GetSceneItemList', { sceneName });
      return (items.sceneItems ?? [])
        .map((item) => item.sourceName ?? '')
        .filter((name) => name.startsWith(ObsController.SOURCE_PREFIX))
        .map((name) => name.slice(ObsController.SOURCE_PREFIX.length));
    } catch {
      return [];
    }
  }

  /** Cree une scene vide dans OBS. */
  async createScene(sceneName: string): Promise<{ ok: boolean; message: string }> {
    const name = sceneName.trim();
    if (!name) return { ok: false, message: 'Donnez un nom a la scene.' };
    if (this.client.getState() !== 'connected') {
      return { ok: false, message: 'Connectez-vous a OBS.' };
    }
    try {
      await this.client.request('CreateScene', { sceneName: name });
      this.logger.info('obs', `Scene « ${name} » creee.`);
      await this.refresh();
      return { ok: true, message: `Scene « ${name} » creee.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, `Creation de la scene « ${name} » impossible`);
      return { ok: false, message };
    }
  }

  /** Retire de la scene nos sources qui ne servent plus. */
  private async removeStaleSources(sceneName: string, wanted: Set<string>): Promise<void> {
    try {
      const items = await this.client.request<{
        sceneItems?: Array<{ sourceName?: string; sceneItemId?: number }>;
      }>('GetSceneItemList', { sceneName });

      for (const item of items.sceneItems ?? []) {
        const sourceName = item.sourceName ?? '';
        if (!sourceName.startsWith(ObsController.SOURCE_PREFIX)) continue;
        if (wanted.has(sourceName)) continue;
        if (typeof item.sceneItemId !== 'number') continue;
        await this.client.request('RemoveSceneItem', {
          sceneName,
          sceneItemId: item.sceneItemId,
        });
      }
    } catch {
      // La liste peut etre indisponible : on continue, quitte a laisser une
      // source en trop plutot que d'echouer.
    }
  }

  /** Ajoute la source a la scene si besoin, et renvoie son identifiant. */
  private async ensureSceneItem(sceneName: string, inputName: string): Promise<number | undefined> {
    try {
      const created = await this.client.request<{ sceneItemId?: number }>('CreateSceneItem', {
        sceneName,
        sourceName: inputName,
        sceneItemEnabled: true,
      });
      return created.sceneItemId;
    } catch {
      // Deja presente : on recupere son identifiant.
      const found = await this.client.request<{ sceneItemId?: number }>('GetSceneItemId', {
        sceneName,
        sourceName: inputName,
      });
      return found.sceneItemId;
    }
  }

  /** Affiche un flux unique dans la scene courante, en plein cadre. */
  async showStreamInScene(name: string, url: string): Promise<{ ok: boolean; message: string }> {
    if (this.client.getState() !== 'connected') {
      return { ok: false, message: "Connectez-vous a OBS avant d'ajouter un flux." };
    }
    try {
      const sceneList = await this.client.request<{ currentProgramSceneName?: string }>('GetSceneList');
      const sceneName = sceneList.currentProgramSceneName;
      if (!sceneName) return { ok: false, message: 'Aucune scene active dans OBS.' };

      const result = await this.configureScene(sceneName, [{ name, url }]);
      return result.ok
        ? { ok: true, message: `« ${name} » est affiche dans la scene « ${sceneName} ».` }
        : result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('obs', error, 'Ajout du flux dans OBS impossible');
      return { ok: false, message };
    }
  }

  /** Vrai si une source de ce nom existe deja dans OBS. */
  private async inputExists(inputName: string): Promise<boolean> {
    try {
      const list = await this.client.request<{ inputs?: Array<{ inputName?: string }> }>('GetInputList');
      return (list.inputs ?? []).some((input) => input.inputName === inputName);
    } catch {
      // En cas de doute, on tente la creation : un refus est rattrape.
      return false;
    }
  }

  // --- Actions pour les macros -------------------------------------------

  /** Supprime une scene OBS. */
  async removeScene(sceneName: string): Promise<void> {
    await this.client.request('RemoveScene', { sceneName });
    await this.refresh();
  }

  /** Renomme une scene OBS. */
  async renameScene(from: string, to: string): Promise<void> {
    await this.client.request('SetSceneName', { sceneName: from, newSceneName: to });
    await this.refresh();
  }

  /**
   * Affiche ou masque une source dans la scene programme.
   *
   * OBS identifie une source par un numero DANS la scene : il faut donc le
   * resoudre d'abord, ce que fait `GetSceneItemId`.
   */
  async setSourceVisible(sourceName: string, visible: boolean): Promise<void> {
    const scene = this.status.currentScene;
    if (!scene) throw new Error('Aucune scene active dans OBS.');
    const item = await this.client.request<{ sceneItemId?: number }>('GetSceneItemId', {
      sceneName: scene,
      sourceName,
    });
    if (item.sceneItemId === undefined) throw new Error(`Source « ${sourceName} » introuvable.`);
    await this.client.request('SetSceneItemEnabled', {
      sceneName: scene,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: visible,
    });
  }

  /** Active ou coupe le son d'une source. */
  async setSourceMuted(sourceName: string, muted: boolean): Promise<void> {
    await this.client.request('SetInputMute', { inputName: sourceName, inputMuted: muted });
  }

  /** Regle le volume d'une source, de 0 a 100. */
  async setSourceVolume(sourceName: string, volume: number): Promise<void> {
    // OBS exprime le volume en decibels, avec un facteur multiplicatif.
    // La conversion lineaire est celle de l'interface d'OBS.
    const ratio = Math.max(0, Math.min(100, volume)) / 100;
    const db = ratio <= 0 ? -100 : 20 * Math.log10(ratio);
    await this.client.request('SetInputVolume', { inputName: sourceName, inputVolumeDb: db });
  }

  /** Noms des sources connues d'OBS, pour l'editeur de macros. */
  async listSources(): Promise<string[]> {
    try {
      const list = await this.client.request<{ inputs?: Array<{ inputName?: string }> }>('GetInputList');
      return (list.inputs ?? [])
        .map((input) => input.inputName)
        .filter((name): name is string => Boolean(name));
    } catch {
      return [];
    }
  }

  /** Met l'enregistrement en pause, s'il tourne. */
  async pauseRecording(): Promise<void> {
    await this.client.request('PauseRecord');
    await this.refresh();
  }

  /** Reprend l'enregistrement en pause. */
  async resumeRecording(): Promise<void> {
    await this.client.request('ResumeRecord');
    await this.refresh();
  }

  /**
   * Decoupe l'enregistrement : le fichier en cours est clos, un nouveau
   * demarre. Utile pour separer les sequences d'un evenement.
   */
  async splitRecording(): Promise<void> {
    await this.client.request('SplitRecordFile');
    await this.refresh();
  }

  /** Indique si le fichier de configuration d'OBS existe (installation reelle). */
  static async obsConfigExists(): Promise<boolean> {
    const candidates = [
      path.join(process.env.APPDATA ?? '', 'obs-studio'),
      path.join(process.env.LOCALAPPDATA ?? '', 'obs-studio'),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) return true;
      } catch {
        // Dossier absent : on teste le suivant.
      }
    }
    return false;
  }

  dispose(): void {
    this.client.disconnect();
  }
}

/** Une cellule de la grille, en pixels du canevas OBS. */
export interface SceneCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Repartit de 1 a 4 flux sur le canevas.
 *
 * 1 : plein ecran. 2 : cote a cote. 3 : deux en haut, le troisieme sur toute la
 * largeur en bas. 4 : grille 2x2. Les cellules remplissent tout le canevas,
 * sans trou.
 */
export function layoutCells(count: number, width: number, height: number): SceneCell[] {
  const halfW = Math.round(width / 2);
  const halfH = Math.round(height / 2);

  switch (Math.max(1, Math.min(4, count))) {
    case 1:
      return [{ x: 0, y: 0, width, height }];
    case 2:
      return [
        { x: 0, y: 0, width: halfW, height },
        { x: halfW, y: 0, width: width - halfW, height },
      ];
    case 3:
      return [
        { x: 0, y: 0, width: halfW, height: halfH },
        { x: halfW, y: 0, width: width - halfW, height: halfH },
        { x: 0, y: halfH, width, height: height - halfH },
      ];
    default:
      return [
        { x: 0, y: 0, width: halfW, height: halfH },
        { x: halfW, y: 0, width: width - halfW, height: halfH },
        { x: 0, y: halfH, width: halfW, height: height - halfH },
        { x: halfW, y: halfH, width: width - halfW, height: height - halfH },
      ];
  }
}
