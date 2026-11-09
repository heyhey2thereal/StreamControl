# StreamControl 2.0.1 — Bug Fixes

Correctifs et petites nouveautés, par-dessus la 2.0.0.
Disponible sur **Windows**, **macOS** et **Linux**.

---

## Nouveautés

- **Enregistrement depuis le téléphone.** Le panneau distant mobile dispose
  maintenant du bouton « Enregistrer la lecture » : le flux est capturé
  **dans le navigateur du téléphone** et telecharge dans son dossier
  Telechargements. Rien n'est ecrit sur le poste central. Cette fonction etait
  jusqu'ici reservee a la vue ordinateur.

- **Enregistrements en MP4 partout.** Tous les fichiers produits sont des
  `.mp4` lisibles par n'importe quel lecteur : enregistrement direct,
  enregistrement par capture (quand le replay est actif), et replay instantane.
  Le format se choisit dans Parametres > Enregistrement, avec la mention
  explicite de l'extension ecrite.

---

## Corrections

- **Fausse alerte de mise a jour.** La fenetre « mise a jour disponible »
  reapparaissait a chaque changement de parametre, meme apres « Plus tard ». La
  verification ne se relance plus a chaque reglage. « Plus tard » ferme la
  fenetre mais **garde le badge** dans la barre laterale, pour y revenir quand
  on veut ; seul « Ne plus me rappeler » la retire.

- **Format d'image ecrase.** L'image des cameras etait etiree pour remplir le
  cadre : une source 4/3 apparaissait deformee, surtout dans la grille de scene
  OBS. Le rapport de l'image est desormais preserve partout.

- **Grille de scene OBS.** Chaque flux de la grille est maintenant declare a
  OBS a la resolution de SA cellule (deux flux cote a cote = 960x1080 chacun),
  et non a la taille du canevas. OBS recoit donc le bon format pour chaque flux.

- **Concatenation MP4 corrigee.** Les segments MP4 fragmentes de MediaMTX
  redemarrent chacun leur temps de decodage a zero : leur mise bout a bout
  donnait un fichier que le lecteur ne jouait qu'en partie (un enregistrement de
  6 s annoncait 1 s). Un assembleur dedie reecrit le temps de decodage cumule et
  le numero de sequence : le fichier obtenu est un MP4 unique et complet.

- **« Appliquer et diffuser » ne coupe plus le direct.** Ce bouton basculait la
  diffusion : quand OBS diffusait deja, il l'arretait. Il demarre la diffusion
  seulement si elle n'est pas deja en cours.

- **« Enregistrer la lecture » (Remote PC).** Le bouton demarre desormais la
  lecture du flux si besoin : sans cela, l'enregistrement capturait une image
  figee, donc un fichier vide.

- **Panneau distant mobile.** La liste des flux se met a jour toute seule quand
  une camera se connecte ou se deconnecte, sans rafraichir la page et sans
  couper la lecture en cours. Les badges d'etat sont fiabilises, et un bouton
  « Retour au direct » recolle a la derniere seconde.

---

## Fichiers concernes (journal complet)

### Ajoutes
| Fichier | Role |
|---|---|
| `src/main/remote-desktop-page.ts` | Vue ordinateur du panneau distant : grille de tous les flux, enregistrement navigateur |
| `src/main/fmp4.ts` | Assembleur de segments MP4 fragmentes (temps de decodage cumule, numero de sequence) |
| `tests/e2e/remote.mjs` | Tests de bout en bout du panneau distant (interfaces, autorisations, enregistrement) |

### Modifies
| Fichier | Changement |
|---|---|
| `src/main/remote.ts` | Detection telephone/ordinateur (`describeDeviceKind`), autorisations par appareil, `kind` enregistre a l'appairage |
| `src/main/remote-page.ts` | Vue mobile : enregistrement navigateur, bouton retour au direct, rafraichissement qui n'interrompt pas la lecture |
| `src/main/web-pages.ts` | Choix de la page selon l'appareil, controle des autorisations (403), etat enrichi |
| `src/main/replay.ts` | Tampon en fMP4, sauvegarde en MP4 via l'assembleur |
| `src/main/capture.ts` | Capture assemblee en MP4 (writer fMP4 incremental) |
| `src/main/player-page.ts` | `object-fit: contain` : le format de l'image n'est plus deforme |
| `src/main/obs-controller.ts` | Chaque source de la grille recoit la resolution de sa cellule |
| `src/main/settings.ts` | Autorisations du Remote par type d'appareil (refusees par defaut) |
| `src/shared/types.ts` | Types `RemotePermissions`, `RemoteDeviceKind` |
| `src/shared/i18n.ts` | Libelles du panneau distant, du format d'enregistrement (fr + en) |
| `src/preload/index.ts` | Type de la demande d'appairage enrichi |
| `src/renderer/hooks/useStreamControl.ts` | Verification de mise a jour unique, badge persistant, `obsStartStreaming` |
| `src/renderer/App.tsx` | Le badge de mise a jour rouvre la fenetre ; Echap ne le retire que si elle est ouverte |
| `src/renderer/components/UpdateDialog.tsx` | Affichage pilote par `updateDialogOpen` |
| `src/renderer/components/RemoteApprovalDialog.tsx` | Affiche le type d'appareil (telephone / ordinateur) |
| `src/renderer/views/RemoteView.tsx` | Tableau des autorisations par type d'appareil |
| `src/renderer/views/ObsView.tsx` | « Appliquer et diffuser » ne bascule plus la diffusion |
| `src/renderer/views/SettingsView.tsx` | Libelles du format d'enregistrement |
| `src/renderer/styles/global.css` | Styles du tableau des autorisations |
| `.github/workflows/build-installers.yml` | Une seule plateforme joint `release-notes.md` (course entre jobs) |
| `tests/e2e/obs.mjs`, `player.mjs`, `update.mjs`, `replay.mjs` | Couverture des correctifs |
| `tests/logic.test.mjs` | Tests de l'assembleur fMP4, des autorisations et du format |
| `package.json` | Version 2.0.1 |

---

## Installation

Choisissez l'installeur de votre systeme dans les fichiers ci-dessous. Les
binaires ne sont pas signes numeriquement : Windows SmartScreen affiche un
avertissement (*Informations complementaires* puis *Executer quand meme*) et
macOS Gatekeeper demande un clic droit > **Ouvrir** au premier lancement.

| Systeme | Fichier |
|---|---|
| **Windows** | `StreamControl-Setup-2.0.1.exe` |
| **macOS (Apple Silicon)** | `StreamControl-2.0.1-arm64.dmg` |
| **macOS (Intel)** | `StreamControl-2.0.1-x64.dmg` |
| **Linux** | `StreamControl-2.0.1.AppImage` ou `StreamControl-2.0.1.deb` |

---

## Notes

- MediaMTX est fourni avec l'application : rien a installer.
- OBS Studio est optionnel (pilote par WebSocket v5).
- Aucun compte, aucun abonnement, aucun service cloud.

## Composants tiers

- **MediaMTX** (RTSP/RTMP/HLS/WebRTC/SRT server) — licence MIT.
- **OBS Studio** — GPL-2.0, logiciel tiers separe, non inclus.
- **FFmpeg** — optionnel, pour certaines fonctions.
