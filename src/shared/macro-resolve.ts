/**
 * Remplacement des variables d'une macro, et comparaisons du bloc « condition ».
 *
 * Chaque action est relue juste avant d'etre executee : `{flux_nom}` donne le
 * nom du flux concerne par cette execution, `{obs_scene}` la scene OBS de cet
 * instant. Une macro enregistree ne fige donc aucune valeur.
 *
 * Les fonctions sont pures : elles recoivent un contexte et rendent une table
 * jeton -> valeur, ou un resultat de comparaison. C'est ce qui les rend
 * testables sans Electron.
 */
import type {
  MacroAction,
  MacroCompareOperator,
  MacroVariableContext,
  MacroVariableStream,
} from './types';
import { variableFor } from './macro-variables';

/** Noms de mois et de jours, en francais : les libelles restent lisibles. */
const MOIS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Booleen rendu en `True` / `False`.
 *
 * C'est la convention des variables de programmation : l'operateur peut
 * comparer directement `{flux_live}` a `True` dans un bloc condition.
 */
const bool = (value: boolean | undefined): string => (value ? 'True' : 'False');

/** Duree lisible, ex. « 00:42:17 ». */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Date lisible, ex. « 2026-10-29 14:05:02 ». */
export function formatDateTime(at: number): string {
  const d = new Date(at);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Toutes les valeurs d'un flux, sous leur jeton de base. */
function streamValues(stream: MacroVariableStream | undefined): Record<string, string> {
  if (!stream) return {};
  return {
    flux_nom: stream.name ?? '',
    flux_chemin: stream.path ?? '',
    flux_id: stream.id ?? '',
    flux_etat: stream.live ? 'En direct' : 'Hors ligne',
    flux_live: bool(stream.live),
    flux_largeur: stream.width === undefined ? '' : String(stream.width),
    flux_hauteur: stream.height === undefined ? '' : String(stream.height),
    flux_resolution: stream.width && stream.height ? `${stream.width}x${stream.height}` : '',
    flux_audio: bool(stream.hasAudio),
    flux_debit: stream.bitrateKbps === undefined ? '' : String(stream.bitrateKbps),
    flux_debit_mbps: stream.bitrateKbps ? (stream.bitrateKbps / 1000).toFixed(1) : '',
    flux_spectateurs: stream.viewers === undefined ? '' : String(stream.viewers),
    flux_duree: stream.startedAt ? formatDuration(Date.now() - stream.startedAt) : '',
    flux_depuis: stream.startedAt ? formatDateTime(stream.startedAt) : '',
    flux_publicateur: stream.publisher ?? '',
    flux_enregistrement: bool(stream.recording),
    flux_dossier_enregistrement: stream.recordingPath ?? '',
    flux_url_rtmp: stream.urls?.rtmpIngest ?? '',
    flux_url_srt: stream.urls?.srtIngest ?? '',
    flux_url_rtsp: stream.urls?.rtspIngest ?? '',
    flux_url_hls: stream.urls?.hls ?? '',
    flux_url_webrtc: stream.urls?.mediamtxWatch ?? '',
    flux_url_lecture: stream.urls?.watch ?? '',
    flux_url_apercu: stream.urls?.embed ?? '',
    flux_url_api: stream.urls?.api ?? '',
  };
}

/**
 * Construit la table jeton -> valeur pour un contexte donne.
 *
 * Inclut les alias et les formes designees par flux :
 * `{flux_nom}`, `{stream_name}` et `{flux_nom_ab12}` sont toutes resolues.
 */
export function buildVariableMap(context: MacroVariableContext): Record<string, string> {
  const now = context.now ?? new Date();
  const values: Record<string, string> = {};

  /** Enregistre une valeur sous son jeton, ses alias et ses formes designees. */
  const set = (token: string, value: string | number | undefined): void => {
    const text = value === undefined || value === null ? '' : String(value);
    values[token] = text;
    const variable = variableFor(token);
    for (const alias of variable?.aliases ?? []) values[alias] = text;
  };

  /** Enregistre les valeurs d'un flux, sous leurs jetons de base. */
  const setStream = (prefix: string, stream: MacroVariableStream | undefined): void => {
    const base = streamValues(stream);
    for (const [token, value] of Object.entries(base)) {
      const key = prefix ? `${token}${prefix}` : token;
      values[key] = value;
      // Les alias suivent aussi la forme designee.
      const variable = variableFor(token);
      for (const alias of variable?.aliases ?? []) values[`${alias}${prefix}`] = value;
    }
  };

  // --- Le flux concerne ----------------------------------------------------
  setStream('', context.flux);

  // --- Les flux designes : {flux_nom_<identifiant>} ------------------------
  for (const stream of context.streams ?? []) {
    if (stream.id) setStream(`_${stream.id}`, stream);
  }

  // --- L'ensemble des flux -------------------------------------------------
  const streams = context.streams ?? [];
  const live = streams.filter((stream) => stream.live);
  set('nombre_flux', streams.length);
  set('nombre_flux_live', live.length);
  set('liste_flux', streams.map((stream) => stream.name).join(', '));
  set('liste_flux_live', live.map((stream) => stream.name).join(', '));
  set('liste_flux_hors_ligne', streams.filter((s) => !s.live).map((s) => s.name).join(', '));

  // --- OBS Studio ----------------------------------------------------------
  const obs = context.obs;
  set('obs_connecte', bool(obs?.connected));
  set('obs_version', obs?.version ?? '');
  set('obs_hote', obs?.host ?? '');
  set('obs_port', obs?.port ?? '');
  set('obs_scene', obs?.currentScene ?? '');
  set('obs_scene_previsualisation', obs?.previewScene ?? '');
  set('obs_mode_studio', bool(obs?.studioMode));
  set('obs_transition', obs?.currentTransition ?? '');
  set('obs_duree_transition', obs?.transitionDurationMs ?? '');
  set('obs_diffusion', bool(obs?.streaming));
  set('obs_enregistrement', bool(obs?.recording));
  set('nombre_scenes', (obs?.scenes ?? []).length);
  set('liste_scenes', (obs?.scenes ?? []).join(', '));
  set('nombre_sources', (obs?.sources ?? []).length);
  set('liste_sources', (obs?.sources ?? []).join(', '));

  // --- MediaMTX ------------------------------------------------------------
  const mediamtx = context.mediamtx;
  set('mediamtx_etat', mediamtx?.state ?? '');
  set('mediamtx_actif', bool(mediamtx?.running));
  set('mediamtx_port_rtmp', mediamtx?.rtmpPort ?? '');
  set('mediamtx_port_hls', mediamtx?.hlsPort ?? '');
  set('mediamtx_port_webrtc', mediamtx?.webrtcPort ?? '');
  set('mediamtx_port_rtsp', mediamtx?.rtspPort ?? '');
  set('mediamtx_port_api', mediamtx?.apiPort ?? '');
  set('mediamtx_port_pages', mediamtx?.webPagesPort ?? '');
  set('mediamtx_chemin', mediamtx?.streamPath ?? '');

  // --- Le poste ------------------------------------------------------------
  const poste = context.poste;
  set('poste_nom', poste?.hostname ?? '');
  set('poste_ip', poste?.ip ?? '');
  set('poste_ip_locale', poste?.ipLocal ?? '127.0.0.1');
  set('poste_systeme', poste?.system ?? '');
  set('poste_plateforme', poste?.platform ?? '');
  set('poste_utilisateur', poste?.user ?? '');
  set('poste_verrouille', bool(poste?.locked));
  set('poste_dossier_profil', poste?.userDataDir ?? '');
  set('poste_dossier_rangement', poste?.storageDir ?? '');
  set('poste_dossier_enregistrements', poste?.recordingsDir ?? '');
  set('poste_dossier_replay', poste?.replayDir ?? '');

  // --- Le temps ------------------------------------------------------------
  set('date', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  set('date_fr', `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`);
  set('heure', `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`);
  set('heure_courte', `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  set(
    'horodatage',
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  );
  set('annee', now.getFullYear());
  set('mois', pad(now.getMonth() + 1));
  set('jour', pad(now.getDate()));
  set('nom_mois', MOIS[now.getMonth()] ?? '');
  set('jour_semaine', JOURS[now.getDay()] ?? '');
  set('horodatage_ms', now.getTime());

  // --- L'application et la macro -------------------------------------------
  const app = context.app;
  set('app_nom', app?.name ?? 'StreamControl');
  set('app_version', app?.version ?? '');
  set('app_langue', app?.language ?? '');
  set('app_theme', app?.theme ?? '');
  const macro = context.macro;
  set('macro_nom', macro?.name ?? '');
  set('macro_id', macro?.id ?? '');
  set('macro_nombre_actions', macro?.actionCount ?? '');
  set('macro_index', macro?.index ?? '');
  set('macro_origine', macro?.origin ?? '');

  // --- Le declencheur ------------------------------------------------------
  const trigger = context.trigger;
  set('declencheur', trigger?.kind ?? '');
  set('declencheur_libelle', trigger?.label ?? '');
  set('declencheur_flux', trigger?.path ?? '');
  set('alerte_type', trigger?.alertKind ?? '');
  set('alerte_libelle', trigger?.alertLabel ?? '');

  return values;
}

/**
 * Remplace les variables d'un texte.
 *
 * Un jeton inconnu est laisse tel quel : l'operateur voit ce qui n'a pas ete
 * remplace, plutot que de perdre silencieusement une partie de son message.
 */
export function expandText(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
    const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === token.toLowerCase());
    return key ? values[key] : match;
  });
}

/**
 * Remplace les variables dans toutes les chaines d'une action, recursivement.
 *
 * On parcourt **tous** les champs texte au lieu d'en tenir une liste : c'est la
 * meme regle que la validation des champs. Une liste ecrite a la main finit
 * toujours par oublier un champ, et la variable resterait alors visible telle
 * quelle dans le journal.
 */
export function expandAction(action: MacroAction, values: Record<string, string>): MacroAction {
  const expanded: Record<string, unknown> = { ...action };
  for (const [key, value] of Object.entries(expanded)) {
    if (typeof value === 'string') expanded[key] = expandText(value, values);
  }
  if (Array.isArray(action.actions)) {
    expanded.actions = action.actions.map((child) => expandAction(child, values));
  }
  return expanded as unknown as MacroAction;
}

/**
 * Compare deux valeurs selon l'operateur choisi.
 *
 * Les comparaisons de nombre (`less-than`, `more-than`) convertissent les deux
 * operandes : « 900 » est bien plus petit que « 1200 », ce qu'une comparaison de
 * texte ne dirait pas. La comparaison de texte ignore la casse, pour que
 * `True` et `true` se valent.
 *
 * @returns vrai si la comparaison est satisfaite.
 */
export function compareValues(
  left: string,
  operator: MacroCompareOperator | undefined,
  right: string,
): boolean {
  const a = String(left ?? '');
  const b = String(right ?? '');
  const lowerA = a.trim().toLowerCase();
  const lowerB = b.trim().toLowerCase();

  switch (operator ?? 'equal') {
    case 'equal':
      return lowerA === lowerB;
    case 'not-equal':
      return lowerA !== lowerB;
    case 'contains':
      return lowerA.includes(lowerB);
    case 'not-contains':
      return !lowerA.includes(lowerB);
    case 'starts-with':
      return lowerA.startsWith(lowerB);
    case 'ends-with':
      return lowerA.endsWith(lowerB);
    case 'is-empty':
      return lowerA.length === 0;
    case 'is-not-empty':
      return lowerA.length > 0;
    case 'less-than':
    case 'more-than': {
      const numberA = Number.parseFloat(lowerA);
      const numberB = Number.parseFloat(lowerB);
      // Deux valeurs non numeriques ne se comparent pas en taille : on le dit
      // en refusant la comparaison, plutot qu'en la faisant sur du texte.
      if (!Number.isFinite(numberA) || !Number.isFinite(numberB)) return false;
      return operator === 'less-than' ? numberA < numberB : numberA > numberB;
    }
    default:
      return false;
  }
}

/**
 * Evalue le test d'un bloc « condition ».
 *
 * Deux formes sont acceptees : la comparaison libre (`conditionLeft` /
 * `conditionRight`), et l'etat predefini (`condition`, plus ancien). La
 * comparaison libre a la priorite quand elle est renseignee.
 *
 * @returns vrai si la condition est satisfaite.
 */
export function evaluateComparison(
  action: MacroAction,
  values: Record<string, string>,
  evaluateState: (state: string) => boolean,
): boolean {
  const left = expandText(action.conditionLeft ?? '', values);
  const right = expandText(action.conditionRight ?? '', values);

  if ((action.conditionLeft ?? '').length > 0) {
    return compareValues(left, action.conditionOperator, right);
  }

  // Repli : l'ancien test par etat predefini.
  return evaluateState(action.condition ?? '');
}
