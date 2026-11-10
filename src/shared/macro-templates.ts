/**
 * Modeles de macro.
 *
 * Un modele est un exemple complet, pret a l'emploi : il montre ce qu'on peut
 * faire avec les blocs ET les variables, et sert de point de depart que
 * l'operateur modifie ensuite. Les modeles sont volontairement ambitieux
 * (« gros exemples ») : ils couvrent un vrai cas de regie, pas une demo.
 *
 * Chaque `build` recoit les adresses et les scenes reellement presentes sur le
 * poste : un modele qui designe une adresse precise reste donc utilisable tel
 * quel, et retombe proprement sur un choix generique si rien n'existe encore.
 */
import type { MacroAction, MacroTemplate, MacroTemplateContext } from './types';

/** Premiere adresse disponible, ou undefined. */
const firstStream = (context: MacroTemplateContext) => context.streams[0];

/** Premiere scene disponible, ou undefined. */
const firstScene = (context: MacroTemplateContext) => context.scenes[0];

/** Construit une action, avec ses valeurs par defaut. */
function action(kind: MacroAction['kind'], values: Partial<MacroAction> = {}): MacroAction {
  return { kind, ...values } as MacroAction;
}

/** Adresse de secours d'une scene : la premiere connue, sinon rien. */
function sceneOr(name: string | undefined, fallback: string | undefined): string {
  return name ?? fallback ?? '';
}

export const MACRO_TEMPLATES: MacroTemplate[] = [
  {
    id: 'ouverture-direct',
    label: 'tpl.ouverture.label',
    description: 'tpl.ouverture.desc',
    level: 'tpl.level.beginner',
    icon: 'streams',
    triggers: [{ kind: 'stream-connect' }],
    build: (context) => {
      const scene = sceneOr(firstScene(context), 'Programme');
      return [
        action('log', { level: 'info', text: 'Direct lance : {flux_nom} publie sur /{flux_chemin} ({flux_resolution}, {flux_debit} kbit/s).' }),
        action('notify', { text: 'Camera connectee : {flux_nom}' }),
        action('scene', { scene }),
        action('wait', { seconds: 2 }),
        action('set-volume', { source: 'Micro', volume: 80 }),
        action('log', { level: 'info', text: 'Scene « {obs_scene} » a l antenne a {heure_courte}.' }),
      ];
    },
  },
  {
    id: 'enregistrement-archive',
    label: 'tpl.enregistrement.label',
    description: 'tpl.enregistrement.desc',
    level: 'tpl.level.beginner',
    icon: 'recording',
    triggers: [{ kind: 'stream-connect' }],
    build: (context) => {
      const stream = firstStream(context);
      return [
        action('log', { level: 'info', text: 'Debut d enregistrement pour {flux_nom}.' }),
        action('record-stream', { streamId: stream?.id ?? '', enabled: true }),
        action('wait', { seconds: 1 }),
        action('notify', { text: 'Enregistrement de {flux_nom} en cours ({flux_dossier_enregistrement}).' }),
      ];
    },
  },
  {
    id: 'alerte-coupure',
    label: 'tpl.coupure.label',
    description: 'tpl.coupure.desc',
    level: 'tpl.level.intermediate',
    icon: 'analysis',
    triggers: [{ kind: 'stream-disconnect' }],
    build: (context) => {
      const backup = context.scenes[1] ?? firstScene(context) ?? '';
      return [
        action('log', { level: 'error', text: 'Perte de signal : {flux_nom} ({flux_chemin}) a decroche.' }),
        action('notify', { text: 'Signal perdu : {flux_nom} — bascule de secours.' }),
        action('scene', { scene: backup }),
        action('sound', { soundPath: '' }),
        action('popup', {
          text: 'Le flux {flux_nom} s est deconnecte a {heure_courte}. Scene de secours : {obs_scene}.',
          confirmLabel: 'J ai vu',
          requireConfirmation: false,
        }),
        action('log', { level: 'warn', text: 'Bascule vers la scene de secours effectuee.' }),
      ];
    },
  },
  {
    id: 'generique-complet',
    label: 'tpl.generique.label',
    description: 'tpl.generique.desc',
    level: 'tpl.level.advanced',
    icon: 'obs',
    build: (context) => {
      const scenes = context.scenes.length > 0 ? context.scenes : ['Generique', 'Programme', 'Fin'];
      return [
        action('log', { level: 'info', text: 'Ouverture du direct — {date_fr} a {heure_courte}, poste {poste_nom} ({poste_ip}).' }),
        action('studio-mode', { enabled: true }),
        action('set-transition', { scene: 'Fondu' }),
        action('transition-duration', { seconds: 1 }),
        action('preview-scene', { scene: scenes[0] }),
        action('wait', { seconds: 2 }),
        action('transition'),
        action('wait', { seconds: 5 }),
        action('preview-scene', { scene: scenes[1] ?? scenes[0] }),
        action('wait', { seconds: 2 }),
        action('transition'),
        action('start-stream'),
        action('wait', { seconds: 3 }),
        action('log', { level: 'info', text: 'Diffusion active : {obs_diffusion}. Scene a l antenne : {obs_scene}.' }),
        action('notify', { text: 'Generique termine, programme a l antenne.' }),
        // Une boucle de controle : on verifie que la diffusion tourne vraiment.
        action('repeat', {
          repeat: 3,
          actions: [
            action('wait', { seconds: 5 }),
            action('log', { level: 'info', text: 'Controle diffusion #{macro_index} : {obs_diffusion}, debit {flux_debit} kbit/s.' }),
          ],
        }),
      ];
    },
  },
  {
    id: 'conducteur-evenement',
    label: 'tpl.conducteur.label',
    description: 'tpl.conducteur.desc',
    level: 'tpl.level.advanced',
    icon: 'show',
    build: (context) => {
      const scenes = context.scenes.length > 0 ? context.scenes : ['Generique', 'Programme', 'Fin'];
      return [
        action('log', { level: 'info', text: 'Conducteur demarre par {macro_nom} (origine : {macro_origine}).' }),
        action('log', { level: 'info', text: 'Plan de la journee : {date_fr} — diffusion sur {nombre_flux} adresse(s).' }),
        action('condition', {
          condition: 'obs-connected',
          actions: [
            action('log', { level: 'info', text: 'OBS {obs_version} connecte, {nombre_scenes} scene(s) disponibles.' }),
            action('studio-mode', { enabled: true }),
            action('set-transition', { scene: 'Fondu' }),
          ],
        }),
        action('condition', {
          condition: 'stream-live',
          actions: [
            action('log', { level: 'info', text: 'Flux en direct : {liste_flux_live}.' }),
            action('scene', { scene: scenes[1] ?? scenes[0] }),
          ],
        }),
        action('wait-until', { condition: 'mediamtx-running', timeoutSeconds: 30 }),
        action('log', { level: 'info', text: 'MediaMTX {mediamtx_etat} sur le port RTMP {mediamtx_port_rtmp}.' }),
        action('notify', { text: 'Conducteur pret : {liste_flux}.' }),
      ];
    },
  },
  {
    id: 'fin-direct',
    label: 'tpl.fin.label',
    description: 'tpl.fin.desc',
    level: 'tpl.level.intermediate',
    icon: 'recording',
    build: (context) => {
      const stream = firstStream(context);
      const endScene = context.scenes[context.scenes.length - 1] ?? 'Fin';
      return [
        action('log', { level: 'info', text: 'Cloture du direct — {heure_courte}.' }),
        action('scene', { scene: endScene }),
        action('wait', { seconds: 3 }),
        action('stop-stream'),
        action('record-stream', { streamId: stream?.id ?? '', enabled: false }),
        action('wait', { seconds: 2 }),
        action('stop-record'),
        action('replay-all'),
        action('wait', { seconds: 2 }),
        action('log', { level: 'info', text: 'Replays sauvegardes dans {poste_dossier_replay}.' }),
        action('popup', {
          text: 'Direct termine a {heure_courte}. Replays : {poste_dossier_replay}. Diffusion : {obs_diffusion}.',
          confirmLabel: 'Terminer',
          requireConfirmation: false,
        }),
        action('notify', { text: 'Emission terminee. A demain !' }),
      ];
    },
  },
  {
    id: 'supervision-debit',
    label: 'tpl.supervision.label',
    description: 'tpl.supervision.desc',
    level: 'tpl.level.advanced',
    icon: 'analysis',
    triggers: [{ kind: 'alert', alertKind: 'low-bitrate' }],
    build: (context) => {
      const backup = context.scenes[1] ?? firstScene(context) ?? '';
      return [
        action('log', { level: 'warn', text: 'Debit faible sur {flux_nom} : {flux_debit} kbit/s ({flux_debit_mbps} Mbit/s).' }),
        action('notify', { text: 'Debit faible : {flux_nom} ({flux_debit} kbit/s).' }),
        action('condition', {
          condition: 'stream-live',
          actions: [
            action('log', { level: 'info', text: 'Le flux publie encore : on surveille avant de basculer.' }),
            action('wait', { seconds: 5 }),
          ],
        }),
        action('sound', { soundPath: '' }),
        action('popup', {
          text: 'Alerte : {flux_nom} tombe a {flux_debit} kbit/s. Scene de secours prete : {obs_scene}.',
          confirmLabel: 'Basculer',
          requireConfirmation: true,
        }),
        action('scene', { scene: backup }),
        action('log', { level: 'info', text: 'Bascule effectuee vers {obs_scene}.' }),
      ];
    },
  },
  {
    id: 'rapport-technique',
    label: 'tpl.rapport.label',
    description: 'tpl.rapport.desc',
    level: 'tpl.level.intermediate',
    icon: 'logs',
    build: () => {
      return [
        action('log', { level: 'info', text: '--- Rapport technique {horodatage} ---' }),
        action('log', { level: 'info', text: 'Application : {app_nom} {app_version} ({app_langue}).' }),
        action('log', { level: 'info', text: 'Poste : {poste_nom} / {poste_systeme} / {poste_ip}.' }),
        action('log', { level: 'info', text: 'MediaMTX : {mediamtx_etat} — RTMP {mediamtx_port_rtmp}, HLS {mediamtx_port_hls}, WebRTC {mediamtx_port_webrtc}, API {mediamtx_port_api}.' }),
        action('log', { level: 'info', text: 'OBS : connecte={obs_connecte} version={obs_version} scene={obs_scene} diffusion={obs_diffusion} enregistrement={obs_enregistrement}.' }),
        action('log', { level: 'info', text: 'Adresses : {nombre_flux} au total, {nombre_flux_live} en direct -> {liste_flux_live}.' }),
        action('log', { level: 'info', text: 'Flux courant : {flux_nom} ({flux_chemin}) {flux_resolution} {flux_debit} kbit/s, depuis {flux_depuis}.' }),
        action('log', { level: 'info', text: 'URL de lecture : {flux_url_lecture} — HLS : {flux_url_hls}.' }),
        action('notify', { text: 'Rapport technique ecrit dans le journal.' }),
        action('log', { level: 'info', text: 'Fin du rapport. Replays : {poste_dossier_replay}.' }),
      ];
    },
  },
  {
    id: 'ouverture-portes',
    label: 'tpl.portes.label',
    description: 'tpl.portes.desc',
    level: 'tpl.level.beginner',
    icon: 'settings',
    build: (context) => {
      const scene = sceneOr(firstScene(context), 'Accueil');
      return [
        action('log', { level: 'info', text: 'Ouverture des portes — {date_fr} {heure_courte}.' }),
        action('scene', { scene }),
        action('set-volume', { source: 'Musique', volume: 60 }),
        action('wait', { seconds: 30 }),
        action('notify', { text: 'Accueil en place. {nombre_flux_live} flux en direct.' }),
        action('log', { level: 'info', text: 'Ouverture terminee. Scene : {obs_scene}.' }),
      ];
    },
  },
  {
    id: 'verrouillage-soir',
    label: 'tpl.verrouillage.label',
    description: 'tpl.verrouillage.desc',
    level: 'tpl.level.beginner',
    icon: 'lock',
    build: () => [
      action('log', { level: 'info', text: 'Preparation du verrouillage de fin de soiree.' }),
      action('notify', { text: 'Extinction dans un instant.' }),
      action('wait', { seconds: 10 }),
      action('stop-record'),
      action('stop-stream'),
      action('replay-all'),
      action('wait', { seconds: 3 }),
      action('log', { level: 'info', text: 'Arrets effectues. Poste verrouille : {poste_verrouille}.' }),
      action('lock', { password: '' }),
    ],
  },
];

/** Retrouve un modele par son identifiant. */
export function templateFor(id: string): MacroTemplate | undefined {
  return MACRO_TEMPLATES.find((template) => template.id === id);
}
