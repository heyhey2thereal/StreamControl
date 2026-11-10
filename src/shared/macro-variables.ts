/**
 * Catalogue des variables de macro.
 *
 * Une variable s'ecrit `{jeton}` dans n'importe quel champ d'un bloc, et est
 * remplacee par sa valeur **au moment ou la macro s'execute** : le nom du flux
 * en direct, la scene OBS courante, l'heure, l'adresse IP du poste, etc.
 *
 * Ce fichier est la seule source de verite, comme `macro-blocks.ts` : ajouter
 * une variable ici la rend disponible partout (aide, recherche, insertion,
 * remplacement, conditions). L'interface ne doit JAMAIS reecrire une liste a la
 * main.
 *
 * Trois principes :
 *
 * 1. **Les jetons sont neutres.** `{flux_nom}` fonctionne que l'interface soit
 *    en francais ou en anglais : une macro ecrite dans une langue continue de
 *    marcher dans l'autre. Chaque variable accepte aussi ses `aliases`, dans les
 *    deux langues (`{stream_name}`, `{nombre_de_flux}`...).
 *
 * 2. **Chaque variable declare sa portee** (`scopes`) : celles qui n'ont de sens
 *    qu'a la connexion d'un flux sont marquees `stream`, celles liees a une
 *    alerte `alert`, etc. La pop-up ne propose donc jamais une variable qui
 *    resterait vide.
 *
 * 3. **Les variables de flux existent en deux formes** : `{flux_nom}` parle du
 *    flux courant, et `{flux_nom_<identifiant>}` d'un flux precis. On peut donc
 *    ecrire « la camera 1 est en ligne, mais la 2 non » dans un seul message.
 */

/** Famille d'une variable, pour le regroupement dans la liste. */
export type VariableGroup =
  | 'flux'
  | 'liste'
  | 'obs'
  | 'mediamtx'
  | 'poste'
  | 'temps'
  | 'app'
  | 'declencheur';

/**
 * Portee d'une variable : quand elle a une valeur.
 *
 * La pop-up d'insertion filtre sur la portee pour ne proposer que des variables
 * utilisables. `always` convient partout ; les autres n'ont de sens que dans le
 * contexte indique.
 */
export type VariableScope = 'always' | 'stream' | 'alert' | 'obs' | 'mediamtx' | 'schedule' | 'startup';

/** Une variable disponible dans les champs de macro. */
export interface MacroVariable {
  /** Jeton a ecrire entre accolades, sans les accolades. */
  token: string;
  group: VariableGroup;
  /**
   * Jetons supplementaires acceptes, dans les deux langues.
   *
   * Ils evitent de casser une macro ecrite avec d'autres mots
   * (`{current_flux_name}` ou `{nombre_de_flux}`), sans dupliquer la variable
   * dans la liste.
   */
  aliases?: string[];
  /** Exemple de valeur, affiche dans la liste : montre le resultat attendu. */
  sample: string;
  /**
   * Portees ou la variable a une valeur. Absent = `['always']`.
   *
   * Une variable de flux dans une macro lancee a la main n'a pas de flux
   * designe : elle vaut alors la chaine vide.
   */
  scopes?: VariableScope[];
  /**
   * Vrai pour une variable repetee par flux (`{flux_nom_<id>}`).
   *
   * La pop-up propose alors un selecteur d'adresse, et fabrique le jeton
   * correspondant.
   */
  perStream?: boolean;
  /** Vrai si la valeur est un booleen, rendu `True` ou `False`. */
  boolean?: boolean;
  /** Vrai si la valeur est numerique : sert aux comparaisons de nombre. */
  numeric?: boolean;
}

/** Familles de variables, dans l'ordre d'affichage. */
export const VARIABLE_GROUPS: Array<{ id: VariableGroup; label: string; icon: string }> = [
  { id: 'flux', label: 'var.group.flux', icon: 'streams' },
  { id: 'liste', label: 'var.group.liste', icon: 'dashboard' },
  { id: 'obs', label: 'var.group.obs', icon: 'obs' },
  { id: 'mediamtx', label: 'var.group.mediamtx', icon: 'services' },
  { id: 'poste', label: 'var.group.poste', icon: 'network' },
  { id: 'temps', label: 'var.group.temps', icon: 'updates' },
  { id: 'app', label: 'var.group.app', icon: 'settings' },
  { id: 'declencheur', label: 'var.group.declencheur', icon: 'analysis' },
];

/**
 * Toutes les variables disponibles.
 *
 * Le jeton decrit ce qu'il contient : le prefixe donne la famille
 * (`flux_`, `obs_`, `poste_`...), ce qui rend la liste lisible et la recherche
 * efficace.
 */
export const MACRO_VARIABLES: MacroVariable[] = [
  // --- Le flux concerne -----------------------------------------------------
  {
    token: 'flux_nom',
    group: 'flux',
    aliases: ['current_flux_name', 'stream_name', 'nom_du_flux'],
    sample: 'Camera scene',
    scopes: ['always', 'stream', 'alert'],
    perStream: true,
  },
  {
    token: 'flux_chemin',
    group: 'flux',
    aliases: ['stream_path', 'chemin_du_flux'],
    sample: 'studio/cam1',
    scopes: ['always', 'stream', 'alert'],
    perStream: true,
  },
  {
    token: 'flux_id',
    group: 'flux',
    aliases: ['stream_id', 'identifiant_du_flux'],
    sample: 'a1b2c3d4',
    scopes: ['always', 'stream', 'alert'],
    perStream: true,
  },
  { token: 'flux_etat', group: 'flux', aliases: ['stream_state'], sample: 'En direct', scopes: ['always', 'stream', 'alert'], perStream: true },
  {
    token: 'flux_live',
    group: 'flux',
    aliases: ['stream_live'],
    sample: 'True',
    scopes: ['always', 'stream', 'alert'],
    perStream: true,
    boolean: true,
  },
  { token: 'flux_largeur', group: 'flux', sample: '1920', scopes: ['stream', 'alert'], perStream: true, numeric: true },
  { token: 'flux_hauteur', group: 'flux', sample: '1080', scopes: ['stream', 'alert'], perStream: true, numeric: true },
  { token: 'flux_resolution', group: 'flux', sample: '1920x1080', scopes: ['stream', 'alert'], perStream: true },
  {
    token: 'flux_audio',
    group: 'flux',
    sample: 'True',
    scopes: ['stream', 'alert'],
    perStream: true,
    boolean: true,
  },
  { token: 'flux_debit', group: 'flux', sample: '3000', scopes: ['stream', 'alert'], perStream: true, numeric: true },
  { token: 'flux_debit_mbps', group: 'flux', sample: '3.0', scopes: ['stream', 'alert'], perStream: true, numeric: true },
  { token: 'flux_spectateurs', group: 'flux', sample: '2', scopes: ['stream', 'alert'], perStream: true, numeric: true },
  { token: 'flux_duree', group: 'flux', sample: '00:42:17', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_depuis', group: 'flux', sample: '2026-10-29 14:05:02', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_publicateur', group: 'flux', sample: '192.168.1.57', scopes: ['stream', 'alert'], perStream: true },
  {
    token: 'flux_enregistrement',
    group: 'flux',
    sample: 'True',
    scopes: ['stream', 'alert'],
    perStream: true,
    boolean: true,
  },
  { token: 'flux_dossier_enregistrement', group: 'flux', sample: 'C:\\StreamControl\\recordings\\cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_rtmp', group: 'flux', sample: 'rtmp://192.168.1.20:1935/studio/cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_srt', group: 'flux', sample: 'srt://192.168.1.20:8890?streamid=publish:studio/cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_rtsp', group: 'flux', sample: 'rtsp://192.168.1.20:8554/studio/cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_hls', group: 'flux', sample: 'http://127.0.0.1:8888/studio/cam1/index.m3u8', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_webrtc', group: 'flux', sample: 'http://127.0.0.1:8889/studio/cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_lecture', group: 'flux', sample: 'http://127.0.0.1:8888/studio/cam1/', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_apercu', group: 'flux', sample: 'http://127.0.0.1:8888/embed/studio/cam1', scopes: ['stream', 'alert'], perStream: true },
  { token: 'flux_url_api', group: 'flux', sample: 'http://127.0.0.1:8888/api/streams', scopes: ['always', 'stream', 'alert'] },

  // --- L'ensemble des flux --------------------------------------------------
  { token: 'nombre_flux', group: 'liste', aliases: ['stream_count', 'nombre_de_flux'], sample: '3', numeric: true },
  { token: 'nombre_flux_live', group: 'liste', aliases: ['live_stream_count'], sample: '2', numeric: true },
  { token: 'liste_flux', group: 'liste', aliases: ['stream_list'], sample: 'Camera scene, Camera salle, Retour' },
  { token: 'liste_flux_live', group: 'liste', sample: 'Camera scene, Camera salle' },
  { token: 'liste_flux_hors_ligne', group: 'liste', sample: 'Retour' },

  // --- OBS Studio -----------------------------------------------------------
  {
    token: 'obs_connecte',
    group: 'obs',
    sample: 'True',
    scopes: ['always', 'stream', 'alert'],
    boolean: true,
  },
  { token: 'obs_version', group: 'obs', sample: '30.1.2', scopes: ['always', 'stream', 'alert'] },
  { token: 'obs_hote', group: 'obs', aliases: ['obs_host'], sample: '127.0.0.1' },
  { token: 'obs_port', group: 'obs', sample: '4455', numeric: true },
  { token: 'obs_scene', group: 'obs', sample: 'Programme' },
  { token: 'obs_scene_previsualisation', group: 'obs', aliases: ['obs_preview_scene'], sample: 'Camera salle' },
  { token: 'obs_mode_studio', group: 'obs', aliases: ['obs_studio_mode'], sample: 'True', boolean: true },
  { token: 'obs_transition', group: 'obs', sample: 'Fondu' },
  { token: 'obs_duree_transition', group: 'obs', aliases: ['obs_transition_duration'], sample: '500', numeric: true },
  { token: 'obs_diffusion', group: 'obs', aliases: ['obs_streaming'], sample: 'True', boolean: true },
  { token: 'obs_enregistrement', group: 'obs', aliases: ['obs_recording'], sample: 'False', boolean: true },
  { token: 'nombre_scenes', group: 'obs', aliases: ['scene_count'], sample: '4', numeric: true },
  { token: 'liste_scenes', group: 'obs', aliases: ['scene_list'], sample: 'Generique, Programme, Camera salle, Fin' },
  { token: 'nombre_sources', group: 'obs', aliases: ['source_count'], sample: '7', numeric: true },
  { token: 'liste_sources', group: 'obs', aliases: ['source_list'], sample: 'Camera 1, Micro, Logo' },

  // --- MediaMTX -------------------------------------------------------------
  { token: 'mediamtx_etat', group: 'mediamtx', sample: 'Actif' },
  { token: 'mediamtx_actif', group: 'mediamtx', sample: 'True', boolean: true },
  { token: 'mediamtx_port_rtmp', group: 'mediamtx', sample: '1935', numeric: true },
  { token: 'mediamtx_port_hls', group: 'mediamtx', sample: '8888', numeric: true },
  { token: 'mediamtx_port_webrtc', group: 'mediamtx', sample: '8889', numeric: true },
  { token: 'mediamtx_port_rtsp', group: 'mediamtx', sample: '8554', numeric: true },
  { token: 'mediamtx_port_api', group: 'mediamtx', sample: '9997', numeric: true },
  { token: 'mediamtx_port_pages', group: 'mediamtx', sample: '8080', numeric: true },
  { token: 'mediamtx_chemin', group: 'mediamtx', sample: 'studio' },

  // --- Le poste -------------------------------------------------------------
  { token: 'poste_nom', group: 'poste', aliases: ['hostname', 'nom_du_poste'], sample: 'REGIE-PC' },
  { token: 'poste_ip', group: 'poste', sample: '192.168.1.20' },
  { token: 'poste_ip_locale', group: 'poste', sample: '127.0.0.1' },
  { token: 'poste_systeme', group: 'poste', sample: 'Windows' },
  { token: 'poste_plateforme', group: 'poste', sample: 'win32' },
  { token: 'poste_utilisateur', group: 'poste', sample: 'regie' },
  { token: 'poste_verrouille', group: 'poste', sample: 'False', boolean: true },
  { token: 'poste_dossier_profil', group: 'poste', sample: 'C:\\Users\\regie\\AppData\\Roaming\\StreamControl' },
  { token: 'poste_dossier_rangement', group: 'poste', sample: 'C:\\StreamControl' },
  { token: 'poste_dossier_enregistrements', group: 'poste', sample: 'C:\\StreamControl\\recordings' },
  { token: 'poste_dossier_replay', group: 'poste', sample: 'C:\\StreamControl\\replay' },

  // --- Le temps -------------------------------------------------------------
  { token: 'date', group: 'temps', sample: '2026-10-29' },
  { token: 'date_fr', group: 'temps', sample: '29/10/2026' },
  { token: 'heure', group: 'temps', sample: '14-05-33' },
  { token: 'heure_courte', group: 'temps', sample: '14:05' },
  { token: 'horodatage', group: 'temps', sample: '2026-10-29_14-05-33' },
  { token: 'annee', group: 'temps', sample: '2026', numeric: true },
  { token: 'mois', group: 'temps', sample: '10', numeric: true },
  { token: 'jour', group: 'temps', sample: '29', numeric: true },
  { token: 'nom_mois', group: 'temps', sample: 'octobre' },
  { token: 'jour_semaine', group: 'temps', sample: 'jeudi' },
  { token: 'horodatage_ms', group: 'temps', sample: '1793286333000', numeric: true },

  // --- L'application et la macro -------------------------------------------
  { token: 'app_nom', group: 'app', aliases: ['app_name'], sample: 'StreamControl' },
  { token: 'app_version', group: 'app', sample: '2.0.0' },
  { token: 'app_langue', group: 'app', aliases: ['app_language'], sample: 'fr' },
  { token: 'app_theme', group: 'app', sample: 'dark' },
  { token: 'macro_nom', group: 'app', aliases: ['macro_name'], sample: 'Ouverture du direct' },
  { token: 'macro_id', group: 'app', sample: 'a1b2c3d4' },
  { token: 'macro_nombre_actions', group: 'app', aliases: ['macro_action_count'], sample: '6', numeric: true },
  { token: 'macro_index', group: 'app', aliases: ['macro_action_index'], sample: '3', numeric: true },
  { token: 'macro_origine', group: 'app', aliases: ['macro_origin'], sample: 'manual' },

  // --- Le declencheur -------------------------------------------------------
  {
    token: 'declencheur',
    group: 'declencheur',
    aliases: ['trigger'],
    sample: 'stream-connect',
    scopes: ['stream', 'alert', 'schedule', 'startup'],
  },
  {
    token: 'declencheur_libelle',
    group: 'declencheur',
    aliases: ['trigger_label'],
    sample: 'Connexion d un flux',
    scopes: ['stream', 'alert', 'schedule', 'startup'],
  },
  {
    token: 'declencheur_flux',
    group: 'declencheur',
    aliases: ['trigger_stream'],
    sample: 'studio/cam1',
    scopes: ['stream', 'alert'],
  },
  { token: 'alerte_type', group: 'declencheur', aliases: ['alert_type'], sample: 'low-bitrate', scopes: ['alert'] },
  { token: 'alerte_libelle', group: 'declencheur', aliases: ['alert_label'], sample: 'Debit bas', scopes: ['alert'] },
];

/** Vrai si le texte contient au moins une variable connue. */
export const VARIABLE_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/** Separateur entre le jeton de base et l'identifiant de flux designe. */
export const PER_STREAM_SEPARATOR = '_';

/**
 * Table de correspondance jeton -> variable.
 *
 * Inclut les alias : `{stream_name}` et `{flux_nom}` designent la meme valeur,
 * pour ne pas casser une macro ecrite avec d'autres mots.
 */
export const VARIABLE_INDEX: Map<string, MacroVariable> = (() => {
  const index = new Map<string, MacroVariable>();
  for (const variable of MACRO_VARIABLES) {
    index.set(variable.token.toLowerCase(), variable);
    for (const alias of variable.aliases ?? []) index.set(alias.toLowerCase(), variable);
  }
  return index;
})();

/**
 * Retrouve une variable par son jeton, ou par un de ses alias.
 *
 * Reconnait aussi la forme designee `flux_nom_<identifiant>` : on identifie
 * alors la variable de base, et `streamIdFromToken` rend l'identifiant.
 */
export function variableFor(token: string): MacroVariable | undefined {
  const direct = VARIABLE_INDEX.get(token.toLowerCase());
  if (direct) return direct;

  const cut = token.lastIndexOf(PER_STREAM_SEPARATOR);
  if (cut > 0) {
    const base = VARIABLE_INDEX.get(token.slice(0, cut).toLowerCase());
    if (base?.perStream) return base;
  }
  return undefined;
}

/** Identifiant de flux designe par un jeton, s'il y en a un. */
export function streamIdFromToken(token: string): string | null {
  if (VARIABLE_INDEX.has(token.toLowerCase())) return null;
  const cut = token.lastIndexOf(PER_STREAM_SEPARATOR);
  if (cut <= 0) return null;
  const base = VARIABLE_INDEX.get(token.slice(0, cut).toLowerCase());
  return base?.perStream ? token.slice(cut + 1) : null;
}

/**
 * Jetons inconnus presents dans un texte.
 *
 * L'editeur s'en sert pour signaler une faute de frappe (`{flux_nomm}`) plutot
 * que de laisser la variable telle quelle sans rien dire.
 */
export function unknownVariables(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const token = match[1];
    if (!variableFor(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

/** Vrai si le texte contient au moins une variable connue. */
export function hasVariables(text: string): boolean {
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (variableFor(match[1])) return true;
  }
  return false;
}

/**
 * Vrai si une variable convient a la portee courante.
 *
 * Sans portee declaree, la variable convient partout. Une variable de flux dans
 * une macro lancee a la main n'a pas de flux designe : on la garde malgre tout,
 * car elle vaut la chaine vide et ne casse rien.
 */
export function variableMatchesScope(variable: MacroVariable, scope: VariableScope): boolean {
  const scopes = variable.scopes ?? ['always'];
  if (scopes.includes('always')) return true;
  return scopes.includes(scope);
}

/** Cle i18n du libelle d'une variable. */
export function variableLabelKey(variable: MacroVariable): string {
  return `var.${variable.token}`;
}

/** Cle i18n de la description d'une variable. */
export function variableDescriptionKey(variable: MacroVariable): string {
  return `var.${variable.token}.desc`;
}
