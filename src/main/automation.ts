/**
 * Automatisation : macros et conducteur de spectacle.
 *
 * Une macro est une suite d'actions rejouable en un clic : passer sur une scene
 * OBS, attendre, demarrer un enregistrement, revenir sur une autre scene. Le
 * conducteur de spectacle en est la version horodatee : des etapes nommees,
 * avec notes et actions, que l'operateur fait avancer une a une.
 *
 * L'operateur garde toujours la main : rien ne se declenche sans une action
 * explicite (un clic, ou la connexion d'un flux pour les macros a declencheur).
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  Macro,
  MacroAction,
  MacroActionKind,
  MacroCondition,
  MacroLogLevel,
  MacroTrigger,
  MacroVariableContext,
  ShowStep,
} from '../shared/types';
import { buildVariableMap, evaluateComparison, expandAction } from '../shared/macro-resolve';
import { templateFor } from '../shared/macro-templates';
import type { Logger } from './logger';
import type { SettingsStore } from './settings';

/** Ce que l'executeur de macros peut declencher sur le poste. */
export interface AutomationTargets {
  /** Change la scene OBS (programme). */
  setScene: (sceneName: string) => Promise<void>;
  /** Prepare une scene en previsualisation (mode studio). */
  setPreviewScene: (sceneName: string) => Promise<void>;
  /** Lance la transition en mode studio. */
  transition: () => Promise<void>;
  /** Choisit la transition utilisee. */
  setTransition: (name: string) => Promise<void>;
  /** Regle la duree de la transition, en millisecondes. */
  setTransitionDuration: (ms: number) => Promise<void>;
  /** Active ou desactive le mode studio. */
  setStudioMode: (enabled: boolean) => Promise<void>;
  /** Cree une scene OBS. */
  createScene: (name: string) => Promise<void>;
  /** Supprime une scene OBS. */
  deleteScene: (name: string) => Promise<void>;
  /** Renomme une scene OBS. */
  renameScene: (from: string, to: string) => Promise<void>;
  /** Affiche ou masque une source dans la scene courante. */
  setSourceVisible: (source: string, visible: boolean) => Promise<void>;
  /** Active ou coupe le son d'une source. */
  setSourceMuted: (source: string, muted: boolean) => Promise<void>;
  /** Regle le volume d'une source, de 0 a 100. */
  setSourceVolume: (source: string, volume: number) => Promise<void>;
  /** Noms des sources disponibles, pour l'editeur. */
  listSources?: () => string[];
  /** Demarre ou arrete la diffusion. */
  toggleStreaming: (start: boolean) => Promise<void>;
  /** Bascule la diffusion (demarre si arretee, arrete sinon). */
  toggleStreamingAuto: () => Promise<void>;
  /** Demarre ou arrete l'enregistrement OBS. */
  toggleObsRecording: (start: boolean) => Promise<void>;
  /** Bascule l'enregistrement OBS. */
  toggleObsRecordingAuto: () => Promise<void>;
  /** Met l'enregistrement OBS en pause. */
  pauseObsRecording: () => Promise<void>;
  /** Reprend l'enregistrement OBS. */
  resumeObsRecording: () => Promise<void>;
  /** Decoupe l'enregistrement OBS (nouveau fichier). */
  splitObsRecording: () => Promise<void>;
  /** Active ou arrete l'enregistrement d'un flux (MediaMTX). */
  setStreamRecording: (streamId: string, record: boolean) => Promise<void>;
  /** Sauvegarde le tampon de replay d'un flux. */
  saveReplay: (streamId: string) => Promise<void>;
  /** Sauvegarde le replay de tous les flux en direct. */
  saveReplayAll: () => Promise<number>;
  /** Active ou desactive une adresse de diffusion. */
  setStreamEnabled: (streamId: string, enabled: boolean) => Promise<void>;
  /** Cree une adresse de diffusion. */
  createStream: (name: string, path: string) => Promise<{ ok: boolean; message?: string }>;
  /** Supprime une adresse de diffusion. */
  deleteStream: (streamId: string) => Promise<{ ok: boolean; message?: string }>;
  /** Verrouille le poste. */
  lock: () => Promise<void>;
  /** Redemarre MediaMTX. */
  restartMediamtx: () => Promise<void>;
  /** Demarre MediaMTX. */
  startMediamtx: () => Promise<void>;
  /** Arrete MediaMTX. */
  stopMediamtx: () => Promise<void>;
  /**
   * Vrai quand OBS est connecte.
   *
   * Les actions qui passent par OBS (scene, transition, diffusion,
   * enregistrement) ne peuvent rien faire sans lui : on le dit clairement
   * plutot que de laisser la macro se derouler sans effet.
   */
  isObsConnected: () => boolean;
  /** Vrai quand MediaMTX tourne. */
  isMediamtxRunning: () => boolean;
  /** Vrai quand un flux publie en ce moment. */
  isStreamLive: (streamId: string) => boolean;
  /** Vrai quand OBS enregistre. */
  isRecording: () => boolean;
  /** Vrai quand OBS diffuse. */
  isStreaming: () => boolean;
  /** Verifie le mot de passe du poste (pour l'action `lock`). */
  checkPassword: (password: string) => boolean;
  /** Ecrit une ligne dans le journal de l'application. */
  log: (level: MacroLogLevel, text: string) => void;
  /**
   * Ajoute une notification.
   *
   * @param text message a afficher.
   * @param toast vrai pour l'afficher aussi dans l'interface (bulle en bas a
   *   gauche). Faux : le message ne va que dans le journal.
   */
  notify: (text: string, toast?: boolean) => void;
  /**
   * Affiche une pop-up sur le poste.
   *
   * @returns true si l'operateur confirme, false s'il refuse. Une pop-up sans
   *   confirmation se contente d'informer et retourne toujours true.
   */
  popup: (text: string, confirmLabel: string, requireConfirmation: boolean) => Promise<boolean>;
  /** Joue un son d'alerte. Un chemin vide joue le son systeme. */
  playSound: (filePath: string, volume?: number) => Promise<void>;
  /** Ouvre un dossier dans l'explorateur de fichiers. */
  openFolder: (target: string) => Promise<void>;
  /** Ouvre une adresse dans le navigateur par defaut. */
  openUrl: (url: string) => Promise<void>;
  /** Envoie une requete HTTP (GET), pour piloter un service externe. */
  httpGet: (url: string) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Contexte des variables, lu au moment ou la macro s'execute.
   *
   * C'est ce qui permet a `{flux_nom}` ou `{obs_scene}` de valoir la valeur du
   * moment plutot qu'une valeur figee a l'ecriture. Le contexte est relu pour
   * chaque action : une scene changee par le bloc precedent est donc visible.
   */
  variables?: () => MacroVariableContext;
  /** Noms des scenes OBS, pour construire un modele de macro. */
  obsScenes?: () => string[];
}

/** Une macro en cours d'execution. */
interface RunningMacro {
  macroId: string;
  /** Index de l'action en cours. */
  index: number;
  cancelled: boolean;
  /**
   * Contexte du declencheur, transmis aux variables.
   *
   * Une macro lancee par la connexion d'un flux connait ainsi ce flux :
   * `{flux_nom}` y repond, alors qu'une macro lancee a la main n'a pas de flux
   * designe et laisse la variable vide.
   */
  trigger?: MacroVariableContext['trigger'];
  /** Nombre d'actions prevues, pour `{macro_nombre_actions}`. */
  total?: number;
  /** Nom de la macro, pour `{macro_nom}`. */
  name?: string;
  /** Comment la macro a ete lancee, pour `{macro_origine}`. */
  origin?: string;
}

/** Resultat de l'execution d'une macro. */
export interface MacroRunResult {
  ok: boolean;
  /** Nombre d'actions executees. */
  executed: number;
  message?: string;
}

/** Genere un identifiant court. */
export function macroId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Actions qui passent par OBS : elles exigent une connexion active. */
const OBS_ACTIONS = new Set<MacroActionKind>([
  'scene',
  'preview-scene',
  'transition',
  'set-transition',
  'transition-duration',
  'studio-mode',
  'create-scene',
  'delete-scene',
  'rename-scene',
  'start-stream',
  'stop-stream',
  'toggle-stream',
  'start-record',
  'stop-record',
  'toggle-record',
  'pause-record',
  'resume-record',
  'split-record',
  'show-source',
  'hide-source',
  'toggle-source',
  'mute-source',
  'unmute-source',
  'set-volume',
]);

/**
 * Remplace les variables d'une action par leur valeur du moment.
 *
 * Le remplacement se fait **juste avant l'execution**, action par action : une
 * scene changee par le bloc precedent est donc visible par le suivant. Un bloc
 * dont un champ contient `{flux_nom}` ecrit le nom reel du flux au moment du
 * declenchement, pas celui connu a l'ecriture de la macro.
 */
export function expandActionVariables(
  action: MacroAction,
  context: MacroVariableContext,
): MacroAction {
  return expandAction(action, buildVariableMap(context));
}

/** Une entree du journal d'execution. */
export interface MacroRunEntry {
  id: string;
  /** Nom de la macro au moment de l'execution. */
  macroName: string;
  /** Identifiant de la macro, pour relancer. */
  macroId: string;
  /** Date de debut. */
  at: number;
  /** Duree, en millisecondes. */
  durationMs: number;
  /** Nombre d'actions executees. */
  executed: number;
  /** Nombre total d'actions prevues. */
  total: number;
  ok: boolean;
  /** Message d'erreur, si l'execution a echoue. */
  message?: string;
  /** Comment la macro a ete lancee. */
  origin: 'manual' | 'trigger' | 'remote' | 'step';
}

/** Nombre maximal d'entrees conservees. */
const MAX_LOG = 100;

export class Automation extends EventEmitter {
  /** Macros en cours, pour pouvoir les arreter. */
  private readonly running = new Map<string, RunningMacro>();
  /** Etape courante du conducteur, index dans `showRunner`. */
  private showIndex = -1;
  /** Journal d'execution, les plus recentes en tete. */
  private log: MacroRunEntry[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly settings: SettingsStore,
    private readonly targets: AutomationTargets,
  ) {
    super();
  }

  // --- Macros ------------------------------------------------------------

  /** Cree une macro vide. */
  async createMacro(name: string): Promise<Macro> {
    const macro: Macro = {
      id: macroId(),
      name: name.trim() || 'Nouvelle macro',
      actions: [],
      triggers: [],
      createdAt: Date.now(),
    };
    const macros = [...this.settings.get().macros, macro];
    await this.settings.save({ macros });
    this.logger.info('macro', `Macro "${macro.name}" creee.`);
    this.emit('changed');
    return macro;
  }

  /** Met a jour une macro (nom, actions, declencheur). */
  async updateMacro(id: string, patch: Partial<Macro>): Promise<Macro | null> {
    const macros = this.settings.get().macros;
    const index = macros.findIndex((macro) => macro.id === id);
    if (index === -1) return null;
    const next = { ...macros[index], ...patch, id };
    const updated = [...macros];
    updated[index] = next;
    await this.settings.save({ macros: updated });
    this.emit('changed');
    return next;
  }

  /**
   * Cree une macro a partir d'un modele pret a l'emploi.
   *
   * Le modele est construit avec les adresses et les scenes du poste : le
   * resultat est utilisable tel quel, puis modifiable comme une autre macro.
   */
  async createFromTemplate(id: string, name: string): Promise<Macro | null> {
    const template = templateFor(String(id));
    if (!template) return null;
    const actions = template.build({
      streams: this.settings
        .get()
        .streams.map((stream) => ({ id: stream.id, name: stream.name, path: stream.path })),
      // Les scenes viennent d'OBS : sans OBS connecte, le modele retombe sur
      // ses propres noms par defaut plutot que de rester vide.
      scenes: this.targets.obsScenes ? this.targets.obsScenes() : [],
    });
    const macro: Macro = {
      id: macroId(),
      name: name.trim() || `Modele : ${template.id}`,
      actions,
      triggers: template.triggers ? [...template.triggers] : [],
      createdAt: Date.now(),
    };
    await this.settings.save({ macros: [...this.settings.get().macros, macro] });
    this.logger.info('macro', `Macro creee depuis le modele "${template.id}".`);
    this.emit('changed');
    return macro;
  }

  /** Supprime une macro. */
  async removeMacro(id: string): Promise<void> {
    const macros = this.settings.get().macros.filter((macro) => macro.id !== id);
    await this.settings.save({ macros });
    this.emit('changed');
  }

  /** Vrai si cette macro tourne en ce moment. */
  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Execute les actions d'une macro, dans l'ordre.
   *
   * Les attentes sont interruptibles : arreter la macro pendant un `wait`
   * l'arrete a la seconde, sans laisser l'action suivante partir.
   */
  async runMacro(
    id: string,
    origin: MacroRunEntry['origin'] = 'manual',
    trigger?: MacroVariableContext['trigger'],
  ): Promise<MacroRunResult> {
    const macro = this.settings.get().macros.find((entry) => entry.id === id);
    if (!macro) return { ok: false, executed: 0, message: 'Macro inconnue.' };
    return this.runActions(macro.actions, macro.name, id, origin, macro.name, trigger);
  }

  /** Arrete une macro en cours. */
  stopMacro(id: string): void {
    const running = this.running.get(id);
    if (running) {
      running.cancelled = true;
      this.logger.info('macro', 'Arret demande.');
    }
  }

  /** Execute une liste d'actions (macro ou etape de conducteur). */
  async runActions(
    actions: MacroAction[],
    label: string,
    runId = macroId(),
    origin: MacroRunEntry['origin'] = 'manual',
    macroName = label,
    trigger?: MacroVariableContext['trigger'],
  ): Promise<MacroRunResult> {
    if (this.running.has(runId)) return { ok: false, executed: 0, message: 'Deja en cours.' };
    const running: RunningMacro = {
      macroId: runId,
      index: 0,
      cancelled: false,
      trigger,
      total: actions.length,
      name: macroName,
      origin,
    };
    this.running.set(runId, running);
    this.emit('changed');

    const startedAt = Date.now();
    let executed = 0;
    let result: MacroRunResult;
    try {
      for (let index = 0; index < actions.length; index += 1) {
        if (running.cancelled) break;
        running.index = index;
        await this.runAction(actions[index], running);
        if (running.cancelled) break;
        executed += 1;
      }
      this.logger.info('macro', `${label} : ${executed}/${actions.length} action(s) executee(s).`);
      result = { ok: !running.cancelled, executed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.errorFrom('macro', error, `${label} interrompue`);
      result = { ok: false, executed, message };
    } finally {
      this.running.delete(runId);
      this.emit('changed');
    }

    this.record({
      macroId: runId,
      macroName,
      at: startedAt,
      durationMs: Date.now() - startedAt,
      executed,
      total: actions.length,
      ok: result.ok,
      message: result.message,
      origin,
    });
    return result;
  }

  /** Ajoute une entree au journal d'execution. */
  private record(entry: Omit<MacroRunEntry, 'id'>): void {
    const full: MacroRunEntry = { ...entry, id: macroId() };
    this.log = [full, ...this.log].slice(0, MAX_LOG);
    this.emit('log', full);
    this.emit('changed');
  }

  /** Journal d'execution, les plus recentes en tete. */
  history(): MacroRunEntry[] {
    return [...this.log];
  }

  /** Vide le journal d'execution. */
  clearHistory(): void {
    this.log = [];
    this.emit('changed');
  }

  /** Duplique une macro, avec un nouveau nom et de nouveaux identifiants. */
  async duplicateMacro(id: string): Promise<Macro | null> {
    const macro = this.settings.get().macros.find((entry) => entry.id === id);
    if (!macro) return null;
    const copy: Macro = {
      ...JSON.parse(JSON.stringify(macro)) as Macro,
      id: macroId(),
      name: `${macro.name} (copie)`,
      createdAt: Date.now(),
    };
    await this.settings.save({ macros: [...this.settings.get().macros, copy] });
    this.emit('changed');
    return copy;
  }

  /**
   * Exporte toutes les macros, pour les partager entre postes.
   *
   * Le format est un JSON lisible : on peut le relire, le corriger a la main,
   * ou le versionner.
   */
  exportMacros(): string {
    return JSON.stringify({ version: 1, macros: this.settings.get().macros }, null, 2);
  }

  /**
   * Importe des macros depuis un JSON exporte.
   *
   * Les identifiants sont regeneres : importer deux fois ne cree pas de
   * collision, et n'ecrase jamais une macro existante.
   *
   * @returns le nombre de macros importees.
   */
  async importMacros(raw: string): Promise<number> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Fichier illisible : ce n'est pas du JSON.");
    }
    const list = (parsed as { macros?: unknown })?.macros;
    if (!Array.isArray(list)) throw new Error('Aucune macro trouvee dans ce fichier.');

    const imported: Macro[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const macro = entry as Partial<Macro>;
      if (!Array.isArray(macro.actions)) continue;
      imported.push({
        id: macroId(),
        name: String(macro.name ?? 'Macro importee'),
        actions: macro.actions,
        triggers: Array.isArray(macro.triggers) ? macro.triggers : [],
        disabled: Boolean(macro.disabled),
        createdAt: Date.now(),
      });
    }
    if (imported.length === 0) throw new Error('Aucune macro valide dans ce fichier.');

    await this.settings.save({ macros: [...this.settings.get().macros, ...imported] });
    this.logger.info('macro', `${imported.length} macro(s) importee(s).`);
    this.emit('changed');
    return imported.length;
  }

  /**
   * Execute une action, puis observe son delai.
   *
   * Le delai est applique **ici**, apres coup, et non a la fin du corps de
   * l'action : les actions qui terminent par `return` (journal, notification,
   * pop-up, son, attente...) ne l'auraient sinon jamais observe. C'etait le
   * defaut : « le temps avant la suite » ne servait a rien sur ces blocs.
   */
  private async runAction(rawAction: MacroAction, running: RunningMacro): Promise<void> {
    await this.runActionOnce(rawAction, running);

    // Delai entre deux evenements : apres l'action, avant la suivante.
    // C'est ce qui espace une sequence (laisser une scene s'afficher, attendre
    // qu'un enregistrement demarre, etc.). Une macro arretee n'attend pas.
    const delay = rawAction.delaySeconds ?? 0;
    if (delay > 0 && !running.cancelled) {
      await this.wait(delay * 1000, running);
    }
  }

  /**
   * Contexte des variables, complete avec ce que le moteur sait de l'execution.
   *
   * Le contexte vient des cibles (etat reel du poste) ; on y ajoute la macro en
   * cours et son declencheur, que seul le moteur connait.
   */
  private variableContext(running: RunningMacro): MacroVariableContext {
    return {
      ...(this.targets.variables?.() ?? {}),
      macro: {
        id: running.macroId,
        name: running.name,
        index: running.index + 1,
        actionCount: running.total,
        origin: running.origin,
      },
      trigger: running.trigger,
    };
  }

  /** Execute une action, sans gerer son delai. */
  private async runActionOnce(rawAction: MacroAction, running: RunningMacro): Promise<void> {
    // Les variables sont resolues ici, action par action : la valeur est celle
    // du moment (scene courante, heure, etat du flux), pas celle de l'ecriture.
    const action = this.targets.variables
      ? expandActionVariables(rawAction, this.variableContext(running))
      : rawAction;

    // Les actions OBS exigent une connexion : sans elle, la macro s'arrete
    // avec un message exploitable, au lieu de se derouler sans aucun effet.
    if (OBS_ACTIONS.has(action.kind) && !this.targets.isObsConnected()) {
      throw new Error(
        `Action « ${action.kind} » impossible : OBS n'est pas connecte. ` +
          "Connectez-vous a OBS depuis l'onglet OBS Studio, puis relancez la macro.",
      );
    }

    // --- Controle du deroulement (peut contenir d'autres actions) ----------
    switch (action.kind) {
      case 'wait':
        await this.wait((action.seconds ?? 1) * 1000, running);
        return;
      case 'repeat': {
        // On repete la sequence imbriquee, en respectant une annulation.
        const times = Math.max(1, Math.min(50, action.repeat ?? 1));
        const inner = action.actions ?? [];
        for (let index = 0; index < times && !running.cancelled; index += 1) {
          for (const child of inner) {
            if (running.cancelled) break;
            await this.runAction(child, running);
          }
        }
        return;
      }
      case 'condition': {
        // Deux formes : la comparaison libre (« si {flux_debit} est plus petit
        // que 900 »), et l'ancien test par etat predefini.
        const values = this.targets.variables ? buildVariableMap(this.variableContext(running)) : {};
        const satisfied = evaluateComparison(action, values, (state) => this.evaluate(state as never));

        if (satisfied) {
          for (const child of action.actions ?? []) {
            if (running.cancelled) break;
            await this.runAction(child, running);
          }
          // Le bloc peut etre un terminus : une fois ses sous-actions finies, la
          // macro s'arrete la. C'est le « si ... alors ... fin » d'une sequence.
          if (action.conditionContinue === false) {
            running.cancelled = true;
            this.logger.info('macro', 'Condition vraie : la macro s arrete apres le bloc.');
          }
        } else if (action.conditionOnFalse === 'stop') {
          // La branche « sinon » peut arreter la macro, au lieu de la sauter.
          running.cancelled = true;
          this.logger.info('macro', 'Condition fausse : la macro s arrete.');
        } else {
          this.logger.info('macro', 'Condition fausse : bloc ignore, la macro continue.');
        }
        return;
      }
      case 'wait-until': {
        // On attend que la condition devienne vraie, avec une echeance.
        // Sans echeance, une condition qui ne vient jamais bloquerait la macro.
        const timeout = (action.timeoutSeconds ?? 30) * 1000;
        const deadline = Date.now() + timeout;
        while (!running.cancelled && !this.evaluate(action.condition)) {
          if (timeout > 0 && Date.now() > deadline) {
            this.logger.warn('macro', `Attente « ${action.condition} » abandonnee (delai depasse).`);
            break;
          }
          await this.wait(250, running);
        }
        return;
      }
      case 'log':
        this.targets.log(action.level ?? 'info', action.text ?? '');
        return;
      case 'notify':
        if (action.text) {
          // La coche decide si le message remonte dans l'interface ou reste
          // dans le journal. Absent = affiche (comportement historique).
          this.targets.notify(action.text, action.notifyToast !== false);
        }
        return;
      case 'popup': {
        // Une pop-up avec confirmation met la macro en pause tant que
        // l'operateur n'a pas repondu : c'est une validation humaine.
        const accepted = await this.targets.popup(
          action.text ?? '',
          action.confirmLabel ?? 'Continuer',
          action.requireConfirmation !== false,
        );
        if (!accepted) {
          running.cancelled = true;
          this.logger.info('macro', "Macro arretee par l'operateur (pop-up refusee).");
        }
        return;
      }
      case 'sound':
        await this.targets.playSound(action.soundPath ?? '', action.soundVolume);
        return;
      case 'stop-macro':
        // Arret volontaire : c'est la fin normale d'une macro conditionnelle.
        running.cancelled = true;
        return;
      default:
        break;
    }

    // --- Actions simples --------------------------------------------------
    switch (action.kind) {
      // OBS : scenes et transitions
      case 'scene':
        if (action.scene) await this.targets.setScene(action.scene);
        break;
      case 'preview-scene':
        if (action.scene) await this.targets.setPreviewScene(action.scene);
        break;
      case 'transition':
        await this.targets.transition();
        break;
      case 'set-transition':
        if (action.scene) await this.targets.setTransition(action.scene);
        break;
      case 'transition-duration':
        if (action.seconds) await this.targets.setTransitionDuration(action.seconds * 1000);
        break;
      case 'studio-mode':
        await this.targets.setStudioMode(action.enabled !== false);
        break;
      case 'create-scene':
        if (action.text) await this.targets.createScene(action.text);
        break;
      case 'delete-scene':
        if (action.scene) await this.targets.deleteScene(action.scene);
        break;
      case 'rename-scene':
        if (action.scene && action.text) await this.targets.renameScene(action.scene, action.text);
        break;

      // OBS : sources
      case 'show-source':
        if (action.source) await this.targets.setSourceVisible(action.source, true);
        break;
      case 'hide-source':
        if (action.source) await this.targets.setSourceVisible(action.source, false);
        break;
      case 'toggle-source':
        // Sans etat connu, on bascule : c'est ce qu'attend l'operateur.
        if (action.source) {
          await this.targets.setSourceVisible(action.source, action.enabled !== false);
        }
        break;

      // OBS : audio
      case 'mute-source':
        if (action.source) await this.targets.setSourceMuted(action.source, true);
        break;
      case 'unmute-source':
        if (action.source) await this.targets.setSourceMuted(action.source, false);
        break;
      case 'set-volume':
        if (action.source) await this.targets.setSourceVolume(action.source, action.volume ?? 50);
        break;

      // OBS : diffusion et enregistrement
      case 'start-stream':
        await this.targets.toggleStreaming(true);
        break;
      case 'stop-stream':
        await this.targets.toggleStreaming(false);
        break;
      case 'start-record':
        await this.targets.toggleObsRecording(true);
        break;
      case 'stop-record':
        await this.targets.toggleObsRecording(false);
        break;
      case 'toggle-stream':
        await this.targets.toggleStreamingAuto();
        break;
      case 'toggle-record':
        await this.targets.toggleObsRecordingAuto();
        break;
      case 'pause-record':
        await this.targets.pauseObsRecording();
        break;
      case 'resume-record':
        await this.targets.resumeObsRecording();
        break;
      case 'split-record':
        await this.targets.splitObsRecording();
        break;

      // Flux
      case 'record-stream':
        if (action.streamId) {
          await this.targets.setStreamRecording(action.streamId, action.enabled !== false);
        }
        break;
      case 'replay':
        if (action.streamId) await this.targets.saveReplay(action.streamId);
        break;
      case 'replay-all':
        await this.targets.saveReplayAll();
        break;
      case 'enable-stream':
        if (action.streamId) await this.targets.setStreamEnabled(action.streamId, true);
        break;
      case 'disable-stream':
        if (action.streamId) await this.targets.setStreamEnabled(action.streamId, false);
        break;
      case 'create-stream': {
        const result = await this.targets.createStream(
          action.text ?? action.path ?? 'Adresse',
          action.path ?? '',
        );
        if (!result.ok) throw new Error(result.message ?? "Creation d'adresse refusee.");
        break;
      }
      case 'delete-stream': {
        if (action.streamId) {
          const result = await this.targets.deleteStream(action.streamId);
          if (!result.ok) throw new Error(result.message ?? 'Suppression refusee.');
        }
        break;
      }

      // Poste
      case 'lock':
        // Le mot de passe, s'il est renseigne, est verifie avant de verrouiller :
        // une macro ne doit pas enfermer l'operateur par erreur.
        if (action.password && !this.targets.checkPassword(action.password)) {
          throw new Error('Mot de passe incorrect : verrouillage annule.');
        }
        await this.targets.lock();
        break;
      case 'restart-mediamtx':
        await this.targets.restartMediamtx();
        break;
      case 'start-mediamtx':
        await this.targets.startMediamtx();
        break;
      case 'stop-mediamtx':
        await this.targets.stopMediamtx();
        break;
      case 'open-folder':
        await this.targets.openFolder(action.text ?? '');
        break;
      case 'open-url':
        if (action.url) await this.targets.openUrl(action.url);
        break;
      case 'http-request': {
        if (action.url) {
          const result = await this.targets.httpGet(action.url);
          if (!result.ok) throw new Error(result.message ?? 'Requete HTTP refusee.');
        }
        break;
      }

      default:
        break;
    }
  }

  /** Evalue une condition de macro. */
  private evaluate(condition: MacroCondition | undefined): boolean {
    switch (condition) {
      case 'obs-connected':
        return this.targets.isObsConnected();
      case 'mediamtx-running':
        return this.targets.isMediamtxRunning();
      case 'recording':
        return this.targets.isRecording();
      case 'streaming':
        return this.targets.isStreaming();
      case 'macro-running':
        return this.running.size > 0;
      case 'stream-live':
        // Sans flux precise, on considere « au moins un flux en direct ».
        return this.targets.isStreamLive('');
      default:
        return true;
    }
  }

  /**
   * Attente interruptible.
   *
   * Le minuteur est volontairement « ref' » (pas `unref`) : une macro en cours
   * d'attente doit maintenir l'application eveillee, sinon l'action suivante
   * ne partirait jamais.
   */
  private wait(ms: number, running: RunningMacro): Promise<void> {
    return new Promise((resolve) => {
      const step = 200;
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += step;
        if (running.cancelled || elapsed >= ms) {
          clearInterval(timer);
          resolve();
        }
      }, step);
    });
  }

  /** Declenche les macros liees a la connexion d'un flux. */
  async onStreamConnected(path: string): Promise<void> {
    await this.fire('stream-connect', { path });
  }

  /** Declenche les macros liees a la deconnexion d'un flux. */
  async onStreamDisconnected(path: string): Promise<void> {
    await this.fire('stream-disconnect', { path });
  }

  /** Declenche les macros liees a une alerte de surveillance. */
  async onAlert(kind: string, path: string): Promise<void> {
    await this.fire('alert', { alertKind: kind, path });
  }
  /** Declenche les macros horaires (appelee chaque minute). */
  async onSchedule(now = new Date()): Promise<void> {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    await this.fire('schedule', { at: hhmm });
  }

  /** Declenche les macros de demarrage. */
  async onStartup(): Promise<void> {
    await this.fire('startup', {});
  }

  /**
   * Lance les macros dont un declencheur correspond.
   *
   * Une macro desactivee ne part jamais : c'est ce qui permet de la garder
   * sans qu'elle se declenche pendant un evenement.
   */
  private async fire(kind: MacroTrigger['kind'], context: Partial<MacroTrigger>): Promise<void> {
    const matches = this.settings.get().macros.filter(
      (macro) =>
        !macro.disabled &&
        macro.triggers.some((trigger) => {
          if (trigger.kind !== kind) return false;
          if (kind === 'stream-connect' || kind === 'stream-disconnect') {
            // Sans chemin precise, le declencheur vaut pour tous les flux.
            return !trigger.path || trigger.path === context.path;
          }
          if (kind === 'alert') {
            return !trigger.alertKind || trigger.alertKind === context.alertKind;
          }
          if (kind === 'schedule') {
            return trigger.at === context.at;
          }
          return true;
        }),
    );
    for (const macro of matches) {
      this.logger.info('macro', `Declenchement de "${macro.name}" (${kind}).`);
      void this.runMacro(macro.id, 'trigger', {
        kind,
        path: context.path,
        alertKind: context.alertKind,
      });
    }
  }

  // --- Conducteur de spectacle -------------------------------------------

  /** Etapes du conducteur, dans l'ordre. */
  listShow(): ShowStep[] {
    return this.settings.get().showRunner;
  }

  /** Index de l'etape courante (-1 si le conducteur n'a pas commence). */
  get currentStep(): number {
    return this.showIndex;
  }

  /** Ajoute une etape. */
  async addShowStep(name: string, at: string, notes = ''): Promise<ShowStep> {
    const step: ShowStep = {
      id: macroId(),
      name: name.trim() || 'Nouvelle etape',
      at: at.trim(),
      notes: notes.trim(),
      done: false,
      actions: [],
    };
    await this.settings.save({ showRunner: [...this.listShow(), step] });
    this.emit('changed');
    return step;
  }

  /** Met a jour une etape. */
  async updateShowStep(id: string, patch: Partial<ShowStep>): Promise<void> {
    const steps = this.listShow().map((step) => (step.id === id ? { ...step, ...patch, id } : step));
    await this.settings.save({ showRunner: steps });
    this.emit('changed');
  }

  /** Supprime une etape. */
  async removeShowStep(id: string): Promise<void> {
    await this.settings.save({ showRunner: this.listShow().filter((step) => step.id !== id) });
    this.emit('changed');
  }

  /** Remet le conducteur a zero. */
  async resetShow(): Promise<void> {
    this.showIndex = -1;
    await this.settings.save({
      showRunner: this.listShow().map((step) => ({ ...step, done: false })),
    });
    this.emit('changed');
  }

  /**
   * Passe a l'etape suivante.
   *
   * C'est l'etape PRECEDENTE qui est marquee terminee, pas celle ou l'on
   * arrive : une etape qui se marque « faite » des qu'on y entre est grisee
   * aussitot, et le conducteur semble sauter la premiere. L'etape courante
   * reste donc active tant que l'operateur n'a pas avance.
   *
   * L'operateur garde le controle : c'est toujours lui qui declenche le
   * passage, aucune etape ne part toute seule.
   */
  async nextShowStep(): Promise<{ ok: boolean; step?: ShowStep; message?: string }> {
    const steps = this.listShow();
    const nextIndex = this.showIndex + 1;
    if (nextIndex >= steps.length) {
      return { ok: false, message: 'Le conducteur est termine.' };
    }

    // L'etape quittee est celle qui se termine.
    const previous = this.showIndex >= 0 ? steps[this.showIndex] : null;
    if (previous && !previous.done) {
      await this.updateShowStep(previous.id, { done: true });
    }

    const step = steps[nextIndex];
    this.showIndex = nextIndex;

    this.logger.info('show', `Etape ${nextIndex + 1}/${steps.length} : ${step.name}.`);
    this.emit('step', { index: nextIndex, step });

    // Les actions de l'etape partent en tache de fond : l'operateur ne doit
    // pas attendre une attente de 10 s avant de voir l'etape avancer.
    if (step.actions.length > 0) {
      void this.runActions(step.actions, `Etape "${step.name}"`);
    }
    return { ok: true, step };
  }
}
