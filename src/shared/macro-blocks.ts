/**
 * Catalogue des blocs d'automatisation.
 *
 * Chaque bloc decrit une action de macro : son domaine, son libelle, ses
 * parametres et sa couleur. L'editeur visuel s'en sert pour construire la
 * palette et le formulaire de chaque bloc, et le processus principal pour
 * l'executer.
 *
 * Ce fichier est la seule source de verite : ajouter une action ici la rend
 * disponible partout (palette, formulaire, validation, execution).
 */
import type {
  MacroAction,
  MacroActionGroup,
  MacroActionKind,
  MacroCompareOperator,
  MacroCondition,
} from './types';

/** Nature d'un parametre de bloc. */
export type BlockFieldKind =
  | 'scene'
  | 'source'
  | 'stream'
  | 'text'
  | 'path'
  | 'file'
  | 'folder'
  | 'url'
  | 'number'
  | 'password'
  | 'toggle'
  | 'condition'
  | 'operator'
  | 'choice'
  | 'level';

/** Un choix propose par un champ de type `choice`. */
export interface BlockFieldChoice {
  value: string;
  /** Cle i18n du libelle. */
  label: string;
}

/** Un parametre editable d'un bloc. */
export interface BlockField {
  /** Cle dans `MacroAction`. */
  key: keyof MacroAction;
  label: string;
  kind: BlockFieldKind;
  /** Valeur par defaut a la creation. */
  default?: string | number | boolean;
  /** Aide affichee sous le champ. */
  hint?: string;
  /** Valeur minimale, pour un nombre. */
  min?: number;
  /** Valeur maximale, pour un nombre. */
  max?: number;
  /**
   * Nombre maximal de caracteres, pour un texte.
   *
   * La limite depend de la fonction : un message de journal peut etre long, un
   * nom de scene beaucoup moins. Le champ l'annonce et l'applique, ce qui evite
   * une saisie qui serait refusee plus tard par OBS ou par le systeme.
   */
  maxLength?: number;
  /**
   * Vrai pour un texte sur plusieurs lignes.
   *
   * Un message long tient mal sur une seule ligne : il defile et on ne voit
   * qu'un fragment. Les champs multilignes s'affichent en zone de texte, ce qui
   * laisse tout le message visible.
   */
  multiline?: boolean;
  /** Choix proposes, pour un champ de type `choice`. */
  choices?: BlockFieldChoice[];
}

/** Definition d'un bloc. */
export interface BlockDefinition {
  kind: MacroActionKind;
  group: MacroActionGroup;
  /** Cle i18n du libelle. */
  label: string;
  /** Parametres affiches dans le formulaire du bloc. */
  fields: BlockField[];
  /** Vrai si le bloc contient une sequence imbriquee (`repeat`, `condition`). */
  nested?: boolean;
}

/** Conditions proposees par le bloc « condition ». */
export const MACRO_CONDITIONS: Array<{ id: MacroCondition; label: string }> = [
  { id: 'obs-connected', label: 'macro.cond.obsConnected' },
  { id: 'mediamtx-running', label: 'macro.cond.mediamtxRunning' },
  { id: 'stream-live', label: 'macro.cond.streamLive' },
  { id: 'recording', label: 'macro.cond.recording' },
  { id: 'streaming', label: 'macro.cond.streaming' },
  { id: 'macro-running', label: 'macro.cond.macroRunning' },
];

/** Comparaisons proposees par le bloc « condition ». */
export const MACRO_OPERATORS: Array<{ id: MacroCompareOperator; label: string }> = [
  { id: 'equal', label: 'macro.op.equal' },
  { id: 'not-equal', label: 'macro.op.notEqual' },
  { id: 'contains', label: 'macro.op.contains' },
  { id: 'not-contains', label: 'macro.op.notContains' },
  { id: 'starts-with', label: 'macro.op.startsWith' },
  { id: 'ends-with', label: 'macro.op.endsWith' },
  { id: 'less-than', label: 'macro.op.lessThan' },
  { id: 'more-than', label: 'macro.op.moreThan' },
  { id: 'is-empty', label: 'macro.op.isEmpty' },
  { id: 'is-not-empty', label: 'macro.op.isNotEmpty' },
];

/** Choix du bloc « condition » quand le test est faux. */
export const CONDITION_ELSE_CHOICES: BlockFieldChoice[] = [
  { value: 'skip', label: 'macro.else.skip' },
  { value: 'stop', label: 'macro.else.stop' },
];

/**
 * Limites de saisie, par nature de champ.
 *
 * Elles suivent ce que la fonction accepte reellement : un nom de scene OBS
 * reste court, un message de journal peut etre long, une adresse URL a sa
 * propre limite. Un champ qui depasse est tronque a la saisie plutot que
 * refuse plus tard.
 */
export const FIELD_LIMITS = {
  /** Nom court : scene, source, adresse, bouton. */
  name: 120,
  /** Chemin de fichier ou dossier : les systemes acceptent plus. */
  path: 400,
  /** Message affiche a l'operateur : journal, notification, pop-up. */
  message: 1000,
  /** Adresse web. */
  url: 500,
  /** Mot de passe. */
  password: 200,
} as const;

/** Groupes de blocs, dans l'ordre d'affichage de la palette. */
export const BLOCK_GROUPS: Array<{ id: MacroActionGroup; label: string; icon: string }> = [
  { id: 'obs', label: 'macro.group.obs', icon: 'obs' },
  { id: 'flux', label: 'macro.group.flux', icon: 'streams' },
  { id: 'poste', label: 'macro.group.poste', icon: 'settings' },
  { id: 'alerte', label: 'macro.group.alerte', icon: 'analysis' },
  { id: 'controle', label: 'macro.group.controle', icon: 'macros' },
];

/** Tous les blocs disponibles. */
export const BLOCKS: BlockDefinition[] = [
  // --- OBS : scenes et transitions ---
  {
    kind: 'scene',
    group: 'obs',
    label: 'macro.kind.scene',
    fields: [{ key: 'scene', label: 'macro.scene', kind: 'scene' }],
  },
  {
    kind: 'preview-scene',
    group: 'obs',
    label: 'macro.kind.previewScene',
    fields: [{ key: 'scene', label: 'macro.scene', kind: 'scene' }],
  },
  { kind: 'transition', group: 'obs', label: 'macro.kind.transition', fields: [] },
  {
    kind: 'set-transition',
    group: 'obs',
    label: 'macro.kind.setTransition',
    fields: [{ key: 'scene', label: 'macro.transitionName', kind: 'text', default: 'Cut', maxLength: FIELD_LIMITS.name }],
  },
  {
    kind: 'transition-duration',
    group: 'obs',
    label: 'macro.kind.transitionDuration',
    fields: [{ key: 'seconds', label: 'macro.seconds', kind: 'number', default: 1, min: 0, max: 60 }],
  },
  {
    kind: 'studio-mode',
    group: 'obs',
    label: 'macro.kind.studioMode',
    fields: [{ key: 'enabled', label: 'macro.enable', kind: 'toggle', default: true }],
  },
  {
    kind: 'create-scene',
    group: 'obs',
    label: 'macro.kind.createScene',
    fields: [{ key: 'text', label: 'macro.sceneName', kind: 'text', maxLength: FIELD_LIMITS.name }],
  },
  {
    kind: 'delete-scene',
    group: 'obs',
    label: 'macro.kind.deleteScene',
    fields: [{ key: 'scene', label: 'macro.scene', kind: 'scene' }],
  },
  {
    kind: 'rename-scene',
    group: 'obs',
    label: 'macro.kind.renameScene',
    fields: [
      { key: 'scene', label: 'macro.scene', kind: 'scene' },
      { key: 'text', label: 'macro.newNameField', kind: 'text', maxLength: FIELD_LIMITS.name },
    ],
  },

  // --- OBS : diffusion et enregistrement ---
  { kind: 'start-stream', group: 'obs', label: 'macro.kind.start-stream', fields: [] },
  { kind: 'stop-stream', group: 'obs', label: 'macro.kind.stop-stream', fields: [] },
  { kind: 'toggle-stream', group: 'obs', label: 'macro.kind.toggleStream', fields: [] },
  { kind: 'start-record', group: 'obs', label: 'macro.kind.start-record', fields: [] },
  { kind: 'stop-record', group: 'obs', label: 'macro.kind.stop-record', fields: [] },
  { kind: 'toggle-record', group: 'obs', label: 'macro.kind.toggleRecord', fields: [] },
  { kind: 'pause-record', group: 'obs', label: 'macro.kind.pauseRecord', fields: [] },
  { kind: 'resume-record', group: 'obs', label: 'macro.kind.resumeRecord', fields: [] },
  { kind: 'split-record', group: 'obs', label: 'macro.kind.splitRecord', fields: [] },

  // --- OBS : sources ---
  {
    kind: 'show-source',
    group: 'obs',
    label: 'macro.kind.showSource',
    fields: [{ key: 'source', label: 'macro.source', kind: 'source' }],
  },
  {
    kind: 'hide-source',
    group: 'obs',
    label: 'macro.kind.hideSource',
    fields: [{ key: 'source', label: 'macro.source', kind: 'source' }],
  },
  {
    kind: 'toggle-source',
    group: 'obs',
    label: 'macro.kind.toggleSource',
    fields: [{ key: 'source', label: 'macro.source', kind: 'source' }],
  },

  // --- OBS : audio ---
  {
    kind: 'mute-source',
    group: 'obs',
    label: 'macro.kind.muteSource',
    fields: [{ key: 'source', label: 'macro.source', kind: 'source' }],
  },
  {
    kind: 'unmute-source',
    group: 'obs',
    label: 'macro.kind.unmuteSource',
    fields: [{ key: 'source', label: 'macro.source', kind: 'source' }],
  },
  {
    kind: 'set-volume',
    group: 'obs',
    label: 'macro.kind.setVolume',
    fields: [
      { key: 'source', label: 'macro.source', kind: 'source' },
      { key: 'volume', label: 'macro.volume', kind: 'number', default: 50, min: 0, max: 100 },
    ],
  },

  // --- Flux ---
  {
    kind: 'record-stream',
    group: 'flux',
    label: 'macro.kind.record-stream',
    fields: [
      { key: 'streamId', label: 'macro.stream', kind: 'stream' },
      { key: 'enabled', label: 'macro.enable', kind: 'toggle', default: true },
    ],
  },
  {
    kind: 'replay',
    group: 'flux',
    label: 'macro.kind.replay',
    fields: [{ key: 'streamId', label: 'macro.stream', kind: 'stream' }],
  },
  { kind: 'replay-all', group: 'flux', label: 'macro.kind.replayAll', fields: [] },
  {
    kind: 'create-stream',
    group: 'flux',
    label: 'macro.kind.createStream',
    fields: [
      { key: 'text', label: 'macro.streamName', kind: 'text', maxLength: FIELD_LIMITS.name },
      { key: 'path', label: 'macro.streamPath', kind: 'path', maxLength: FIELD_LIMITS.path },
    ],
  },
  {
    kind: 'delete-stream',
    group: 'flux',
    label: 'macro.kind.deleteStream',
    fields: [{ key: 'streamId', label: 'macro.stream', kind: 'stream' }],
  },
  {
    kind: 'enable-stream',
    group: 'flux',
    label: 'macro.kind.enableStream',
    fields: [{ key: 'streamId', label: 'macro.stream', kind: 'stream' }],
  },
  {
    kind: 'disable-stream',
    group: 'flux',
    label: 'macro.kind.disableStream',
    fields: [{ key: 'streamId', label: 'macro.stream', kind: 'stream' }],
  },

  // --- Poste ---
  {
    kind: 'lock',
    group: 'poste',
    label: 'macro.kind.lock',
    fields: [
      {
        key: 'password',
        label: 'macro.lockPassword',
        kind: 'password',
        hint: 'macro.lockPasswordHint',
        maxLength: FIELD_LIMITS.password,
      },
    ],
  },
  { kind: 'restart-mediamtx', group: 'poste', label: 'macro.kind.restart-mediamtx', fields: [] },
  { kind: 'start-mediamtx', group: 'poste', label: 'macro.kind.startMediamtx', fields: [] },
  { kind: 'stop-mediamtx', group: 'poste', label: 'macro.kind.stopMediamtx', fields: [] },
  {
    kind: 'open-folder',
    group: 'poste',
    label: 'macro.kind.openFolder',
    fields: [
      {
        key: 'text',
        label: 'macro.folder',
        kind: 'folder',
        default: '',
        hint: 'macro.folderHint',
        maxLength: FIELD_LIMITS.path,
      },
    ],
  },
  {
    kind: 'open-url',
    group: 'poste',
    label: 'macro.kind.openUrl',
    fields: [{ key: 'url', label: 'macro.url', kind: 'url', maxLength: FIELD_LIMITS.url }],
  },

  // --- Alerte : journal, notification, pop-up, son ---
  {
    kind: 'log',
    group: 'alerte',
    label: 'macro.kind.log',
    fields: [
      { key: 'text', label: 'macro.message', kind: 'text', multiline: true, maxLength: FIELD_LIMITS.message, hint: 'macro.messageHint' },
      { key: 'level', label: 'macro.level', kind: 'level', default: 'info' },
    ],
  },
  {
    kind: 'notify',
    group: 'alerte',
    label: 'macro.kind.notify',
    fields: [
      { key: 'text', label: 'macro.message', kind: 'text', multiline: true, maxLength: FIELD_LIMITS.message, hint: 'macro.messageHint' },
      {
        key: 'notifyToast',
        label: 'macro.notifyToast',
        kind: 'toggle',
        default: true,
        hint: 'macro.notifyToastHint',
      },
    ],
  },
  {
    kind: 'popup',
    group: 'alerte',
    label: 'macro.kind.popup',
    fields: [
      { key: 'text', label: 'macro.message', kind: 'text', multiline: true, maxLength: FIELD_LIMITS.message, hint: 'macro.messageHint' },
      { key: 'confirmLabel', label: 'macro.confirmLabel', kind: 'text', default: 'Continuer', maxLength: FIELD_LIMITS.name },
      {
        key: 'requireConfirmation',
        label: 'macro.requireConfirmation',
        kind: 'toggle',
        default: true,
        hint: 'macro.requireConfirmationHint',
      },
    ],
  },
  {
    kind: 'sound',
    group: 'alerte',
    label: 'macro.kind.sound',
    fields: [
      {
        key: 'soundPath',
        label: 'macro.soundFile',
        kind: 'file',
        hint: 'macro.soundFileHint',
        maxLength: FIELD_LIMITS.path,
      },
      {
        key: 'soundVolume',
        label: 'macro.volume',
        kind: 'number',
        default: 100,
        min: 0,
        max: 100,
        hint: 'macro.soundVolumeHint',
      },
    ],
  },

  // --- Controle du deroulement ---
  {
    kind: 'wait',
    group: 'controle',
    label: 'macro.kind.wait',
    fields: [{ key: 'seconds', label: 'macro.seconds', kind: 'number', default: 3, min: 0, max: 3600 }],
  },
  {
    kind: 'wait-until',
    group: 'controle',
    label: 'macro.kind.waitUntil',
    fields: [
      { key: 'condition', label: 'macro.condition', kind: 'condition' },
      {
        key: 'timeoutSeconds',
        label: 'macro.timeout',
        kind: 'number',
        default: 30,
        min: 0,
        max: 3600,
        hint: 'macro.timeoutHint',
      },
    ],
  },
  {
    kind: 'condition',
    group: 'controle',
    label: 'macro.kind.condition',
    fields: [
      // Comparaison libre : « si {variable} est egal a {valeur} alors... ».
      { key: 'conditionLeft', label: 'macro.ifLeft', kind: 'text', default: '', hint: 'macro.ifLeftHint', maxLength: 400 },
      { key: 'conditionOperator', label: 'macro.ifOperator', kind: 'operator', default: 'equal' },
      { key: 'conditionRight', label: 'macro.ifRight', kind: 'text', default: '', hint: 'macro.ifRightHint', maxLength: 400 },
      // Repli : l'ancien test par etat predefini, conserve pour les macros
      // existantes et pour les verifications rapides.
      { key: 'condition', label: 'macro.ifState', kind: 'condition', hint: 'macro.ifStateHint' },
      { key: 'conditionOnFalse', label: 'macro.ifElse', kind: 'choice', default: 'skip', hint: 'macro.ifElseHint', choices: CONDITION_ELSE_CHOICES },
      { key: 'conditionContinue', label: 'macro.ifContinue', kind: 'toggle', default: true, hint: 'macro.ifContinueHint' },
    ],
    nested: true,
  },
  {
    kind: 'repeat',
    group: 'controle',
    label: 'macro.kind.repeat',
    fields: [{ key: 'repeat', label: 'macro.repeatCount', kind: 'number', default: 2, min: 1, max: 50 }],
    nested: true,
  },
  {
    kind: 'http-request',
    group: 'controle',
    label: 'macro.kind.httpRequest',
    fields: [{ key: 'url', label: 'macro.url', kind: 'url', hint: 'macro.httpHint', maxLength: FIELD_LIMITS.url }],
  },
  { kind: 'stop-macro', group: 'controle', label: 'macro.kind.stopMacro', fields: [] },
];
/** Retrouve la definition d'un bloc. */
export function blockFor(kind: MacroActionKind): BlockDefinition | undefined {
  return BLOCKS.find((block) => block.kind === kind);
}

/** Cree une action pre-remplie pour un type de bloc. */
export function makeAction(kind: MacroActionKind): MacroAction {
  const definition = blockFor(kind);
  const action: MacroAction = { kind };
  for (const field of definition?.fields ?? []) {
    if (field.default !== undefined) {
      (action as unknown as Record<string, unknown>)[field.key as string] = field.default;
    }
  }
  if (definition?.nested) action.actions = [];
  return action;
}

/** Vrai si l'action passe par OBS (donc exige une connexion). */
export function needsObs(kind: MacroActionKind): boolean {
  return blockFor(kind)?.group === 'obs';
}
