# StreamControl 2.0.2 — More fixes

Correctifs et nouveautés, par-dessus la 2.0.1.
Disponible sur **Windows**, **macOS** et **Linux**.

---

## Nouveautés

- **Nouvel onglet Replay, avec barre de lecture.** Un espace dédié pour
  récupérer un extrait du direct. Une **barre de lecture** montre la mémoire
  disponible et **avance toute seule** au rythme du direct. Deux **poignées**
  s'y déplacent : celle de **gauche** fixe le **début** de l'extrait, celle de
  **droite** la **fin**. La durée choisie s'affiche en clair, et un fichier
  **MP4** est créé dans le dossier des replays.

- **Mémoire et minimum configurables.** Dans Paramètres > Replay, vous réglez
  combien de secondes de chaque flux sont mémorisées (60 s par défaut), la durée
  minimale d'un replay (30 s par défaut) et le **dossier de sortie**. Un replay
  plus long que la mémoire, ou plus court que le minimum, est refusé avec un
  message clair.

- **Écran « pas de flux » personnalisable.** Chaque cellule de scène OBS peut
  afficher, quand son flux ne publie pas, soit un **écran noir**, soit un
  **message que vous écrivez**, avec variables. Par exemple :

  > Nous avons perdu le retour vidéo de {flux_nom}. Il revient dans quelques
  > secondes.

  Couleur du texte, couleur du fond et indicateur de chargement réglables.

- **Activer / désactiver chaque flux d'une scène.** Dans la configuration d'une
  scène, chaque flux a un bouton **Affiché / Noir** : un flux désactivé reste
  dans la scène, mais sa cellule devient **noire**.

---

## Corrections

- **Une cellule de scène montrait la vidéo d'un autre flux.** Deux sources de
  même origine pouvaient partager le cache du navigateur d'OBS. Chaque source
  porte désormais un paramètre unique, et la page est rechargée quand la scène
  devient active.

- **Débit trop élevé à l'enregistrement dans le navigateur.** Le navigateur
  ré-encodait au-delà de la source. Le débit de la source est maintenant
  transmis : l'enregistrement se fait au même débit.

- **Décalage du panneau distant (PC et mobile).** Le panneau distant ne lisait
  qu'en HLS, d'où le retard. Il essaie désormais le **WebRTC d'abord** (image
  sous la seconde, comme la page de lecture du poste), et ne retombe sur le HLS
  qu'en secours. Le bouton « Retour au direct » rattrape réellement le retard.

- **Plein écran du panneau distant.** Nouveau bouton par flux : l'image passe
  en plein écran, avec ses commandes.

---

## Fichiers concernés (journal complet)

### Ajoutés
| Fichier | Rôle |
|---|---|
| `src/renderer/views/ReplayView.tsx` | Onglet Replay : barre de lecture à deux poignées, choix du flux |
| `CHANGELOG-2.0.2.md` | Journal détaillé de cette version |

### Modifiés
| Fichier | Changement |
|---|---|
| `src/main/replay.ts` | Plage de replay, dossier de sortie, minimum, mémoire, MP4 |
| `src/main/stream-controller.ts` | `saveReplay` avec plage, `replayState` |
| `src/main/ipc.ts` | Canaux replay (plage, état, dossier), autorisations de scène |
| `src/main/settings.ts` | Réglages replay (mémoire, minimum, dossier), scène (écran « pas de flux ») |
| `src/main/obs-controller.ts` | Paramètre unique par source, rechargement, résolution par cellule, activation par flux |
| `src/main/player-page.ts` | Écran « pas de flux » (noir / message personnalisé) |
| `src/main/web-pages.ts` | Écran « pas de flux » ; URL WebRTC/WHEP dans l'état distant |
| `src/main/main.ts` | Résolution des variables du message |
| `src/main/remote-desktop-page.ts` | Lecture WebRTC d'abord, correction de latence, retour au direct, plein écran, débit d'enregistrement |
| `src/main/remote-page.ts` | Retour au direct, débit d'enregistrement |
| `src/shared/types.ts` | `SceneDisplaySettings`, `ReplayResult`, `ReplayState` |
| `src/shared/channels.ts` | Canaux replay |
| `src/shared/i18n.ts` | Libellés replay, scène, écran « pas de flux » (fr + en) |
| `src/preload/index.ts` | API replay et scène |
| `src/renderer/App.tsx` | Onglet Replay dans la navigation |
| `src/renderer/views/SettingsView.tsx` | Réglages replay et écran « pas de flux » |
| `src/renderer/views/ObsView.tsx` | Boutons Affiché / Noir, aperçu des cellules noires |
| `src/renderer/styles/global.css` | Styles replay, boutons Affiché / Noir |
| `tests/e2e/replay.mjs`, `obs.mjs`, `player.mjs`, `app-smoke.mjs` | Couverture |
| `tests/obs-ws-server.mjs` | Suivi de `SetSceneItemEnabled` |
| `tests/logic.test.mjs` | Réglages de replay bornés |
| `package.json` | Version 2.0.2 |

---

## Installation

Choisissez l'installeur de votre système dans les fichiers ci-dessous. Les
binaires ne sont pas signés numériquement : Windows SmartScreen affiche un
avertissement (*Informations complémentaires* puis *Exécuter quand même*) et
macOS Gatekeeper demande un clic droit > **Ouvrir** au premier lancement.

| Système | Fichier |
|---|---|
| **Windows** | `StreamControl-Setup-2.0.2.exe` |
| **macOS (Apple Silicon)** | `StreamControl-2.0.2-arm64.dmg` |
| **macOS (Intel)** | `StreamControl-2.0.2-x64.dmg` |
| **Linux** | `StreamControl-2.0.2.AppImage` ou `StreamControl-2.0.2.deb` |

---

## Notes

- MediaMTX est fourni avec l'application : rien à installer.
- OBS Studio est optionnel (piloté par WebSocket v5).
- Aucun compte, aucun abonnement, aucun service cloud.

## Composants tiers

- **MediaMTX** (RTSP/RTMP/HLS/WebRTC/SRT server) — licence MIT.
- **OBS Studio** — GPL-2.0, logiciel tiers séparé, non inclus.
- **FFmpeg** — optionnel, pour certaines fonctions.
