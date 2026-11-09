# StreamControl 2.0.1 — journal des modifications

Version de correctifs, par-dessus la 2.0.0. Branche de travail : `v2.0.0`
(le tag `v2.0.1` pointe dessus). Ce fichier detaille chaque changement et les
fichiers concernes.

## 1. Panneau distant : vue ordinateur et autorisations
- Vue ordinateur distincte de la vue mobile : un appareil du reseau qui n'est
  pas un telephone recoit une grille de tous les flux (debit, resolution, vues)
  et l'enregistrement dans le navigateur.
- Choix telephone / ordinateur cote serveur, sur l'en-tete `User-Agent`
  (`describeDeviceKind`). Une tablette et un PC recoivent la vue ordinateur.
- Autorisations par type d'appareil : cinq droits (scenes, enregistrement
  serveur, enregistrement navigateur, macros, commandes du poste), refuses par
  defaut. L'action refusee l'est cote serveur (403), pas seulement masquee.
- Tableau de cases a cocher dans l'onglet Remote du poste.
- `src/main/remote-desktop-page.ts` (nouveau), `src/main/remote.ts`,
  `src/main/web-pages.ts`, `src/main/settings.ts`, `src/shared/types.ts`,
  `src/renderer/views/RemoteView.tsx`,
  `src/renderer/components/RemoteApprovalDialog.tsx`,
  `src/renderer/styles/global.css`.

## 2. Enregistrement depuis le telephone
- Le panneau mobile dispose du bouton « Enregistrer la lecture » : capture
  dans le navigateur du telephone, telechargement dans son dossier
  Telechargements, rien sur le poste central.
- `src/main/remote-page.ts`.

## 3. Fichiers de sortie en MP4
- Nouvel assembleur de segments MP4 fragmentes (`src/main/fmp4.ts`) : temps de
  decodage cumule et numero de sequence reecrits. Sans lui, la mise bout a bout
  brute des segments MediaMTX ne joue qu'en partie (chaque fragment redemarre
  son temps a zero).
- Tampon de replay en fMP4, sauvegarde en `.mp4` ; capture assemblee en `.mp4` ;
  l'enregistrement direct (MediaMTX) produit deja des `.mp4`.
- Libelles du format d'enregistrement explicites sur l'extension ecrite.
- `src/main/fmp4.ts` (nouveau), `src/main/replay.ts`, `src/main/capture.ts`,
  `src/renderer/views/SettingsView.tsx`, `src/shared/i18n.ts`.

## 4. Correctifs d'interface
- **Fausse alerte de mise a jour** : la verification ne depend plus des
  reglages, donc elle ne se relance plus a chaque changement. « Plus tard »
  ferme la fenetre mais garde le badge ; seul « Ne plus me rappeler » le retire.
  `src/renderer/hooks/useStreamControl.ts`, `src/renderer/App.tsx`,
  `src/renderer/components/UpdateDialog.tsx`.
- **Format d'image ecrase** : `object-fit: contain` sur le lecteur, le rapport
  de l'image n'est plus deforme. `src/main/player-page.ts`.
- **Grille de scene OBS** : chaque source recoit la resolution de sa cellule
  (960x1080 pour deux flux cote a cote), et non celle du canevas.
  `src/main/obs-controller.ts`.
- **« Appliquer et diffuser » ne coupe plus le direct** : nouvelle methode
  `obsStartStreaming` qui demarre seulement si besoin.
  `src/renderer/hooks/useStreamControl.ts`, `src/renderer/views/ObsView.tsx`.
- **« Enregistrer la lecture » (Remote PC)** demarre la lecture si besoin, sinon
  la capture etait vide. `src/main/remote-desktop-page.ts`.
- **Panneau mobile** : rafraichissement qui re-rend la liste au changement de
  flux sans couper la lecture, badges d'etat fiabilises, bouton « Retour au
  direct ». `src/main/remote-page.ts`.
- **CI** : une seule plateforme joint `release-notes.md` a la Release (course
  entre les trois jobs). `.github/workflows/build-installers.yml`.

## 5. Tests
- `tests/logic.test.mjs` : assembleur fMP4 (temps cumules, un seul en-tete),
  autorisations du Remote, format de la page de lecture, resolution des cellules.
- `tests/e2e/remote.mjs` (nouveau) : interfaces, autorisations (403), jeton.
- `tests/e2e/update.mjs`, `obs.mjs`, `player.mjs`, `replay.mjs` : couverture des
  correctifs.

Chiffres : **40 tests unitaires · 469 verifications e2e · 0 echec.**
