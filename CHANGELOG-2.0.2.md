# StreamControl 2.0.2 — journal des modifications

Correctifs et nouveautés, par-dessus la 2.0.1. Branche de travail : `v2.0.0`
(le tag `v2.0.2` pointe dessus).

## 1. Refonte complete du replay
- **Nouvelle categorie « Replay »** dans la barre laterale, a part entiere.
- **Barre de lecture intuitive** : une barre montre la memoire disponible (les
  dernieres secondes) et **avance toute seule** au rythme du direct. Deux
  **poignees deplacables** a la souris :
  - celle de **gauche** fixe le **debut** de l'extrait ;
  - celle de **droite** fixe la **fin**.
  La duree choisie s'affiche en clair, et la barre se remplit au fur et a
  mesure que le flux continue.
- On y choisit le **flux**, puis la **plage** a recuperer. Le
  fichier MP4 est ecrit dans le **dossier des replays**.
- **Memoire configurable** (Parametres > Replay) : combien de secondes de chaque
  flux sont conservees. Un replay plus long que cette memoire est refuse, avec
  un message clair.
- **Duree minimale** configurable : un replay plus court est refuse. Par defaut
  30 s, et la memoire par defaut passe a 60 s.
- **Dossier de sortie configurable** (Parametres > Replay), avec ouverture du
  dossier en un clic.
- La sauvegarde indique la duree reelle produite.
- Fichiers : `src/main/replay.ts`, `src/main/stream-controller.ts`,
  `src/main/ipc.ts`, `src/shared/channels.ts`, `src/shared/types.ts`,
  `src/preload/index.ts`, `src/main/settings.ts`,
  `src/renderer/views/ReplayView.tsx` (nouveau), `src/renderer/App.tsx`,
  `src/renderer/views/SettingsView.tsx`, `src/shared/i18n.ts`,
  `src/renderer/styles/global.css`.

## 2. Debit et decalage du panneau distant (PC et mobile)
- **Lecture WebRTC (WHEP) en priorite.** La page du poste qui « fonctionne
  bien » lit en WebRTC (image sous la seconde) et ne retombe sur le HLS qu'en
  secours ; le panneau distant, lui, ne faisait que du HLS, d'ou le retard. Il
  essaie desormais le **WebRTC d'abord**, puis bascule sur le HLS si besoin.
- **Debit trop eleve** : l'enregistrement dans le navigateur re-encodait au
  debit par defaut du navigateur, souvent bien au-dela de la source. Le debit
  de la source est desormais transmis au `MediaRecorder`, qui enregistre au
  meme debit.
- **Decalage et retour au direct inefficace** : les lecteurs du panneau distant
  n'avaient pas les reglages HLS de la page de lecture du poste. Ils les ont
  maintenant : faible latence, un seul segment d'avance, aucun tampon arriere,
  et une **correction de latence** qui replace l'image au plus pres du direct
  des qu'elle prend du retard.
- Le bouton **« Retour au direct »** vise d'abord la fin du tampon deja charge
  (le plus proche du direct), puis la position de direct de hls.js, puis un
  rechargement en dernier recours. Il rattrape donc vraiment le retard.
- **Plein ecran** : nouveau bouton par flux. Il passe par l'API Fullscreen du
  navigateur (sur la carte entiere, commandes comprises), avec la variante
  `webkit` pour Safari.
- Fichiers : `src/main/remote-desktop-page.ts`, `src/main/remote-page.ts`,
  `src/main/web-pages.ts` (URL WebRTC/WHEP dans l'etat distant).

## 3. Bug : une cellule de scene affichait la video d'une autre
- **Cause** : deux sources navigateur de meme origine (`/embed/live` et
  `/embed/cam2`) peuvent partager le cache du moteur embarque d'OBS, et OBS ne
  rechargeait pas la page (`restart_when_active: false`).
- **Correction** : chaque source porte un **parametre unique** (`?src=<nom>`),
  et `restart_when_active: true` recharge la page quand la scene devient active.
- Fichiers : `src/main/obs-controller.ts`.

## 4. Ecran « pas de flux » personnalisable (cellules de scene OBS)
- On choisit ce qu'affiche une cellule quand son flux ne publie pas :
  - **ecran noir** : rien du tout, image propre ;
  - **message personnalise** : texte libre, avec variables (`{flux_nom}`,
    etc.), couleur de texte, couleur de fond et indicateur de chargement
    optionnel. Exemple : « Nous avons perdu le retour video de {flux_nom}. Il
    revient dans quelques secondes. »
- Reglages dans **Parametres > OBS Studio**, avec apercu. Le texte est resolu
  cote serveur (variables remplacees) avant d'etre servi.
- Fichiers : `src/shared/types.ts` (`SceneDisplaySettings`),
  `src/main/settings.ts`, `src/main/player-page.ts` (`showOffline`),
  `src/main/web-pages.ts` (`getSceneOffline`), `src/main/main.ts`,
  `src/renderer/views/SettingsView.tsx`, `src/shared/i18n.ts`.

## 5. Activer / desactiver chaque flux d'une scene
- Dans la configuration d'une scene (onglet OBS), chaque flux choisi a un
  bouton **Affiche / Noir** : un flux desactive reste dans la scene, mais sa
  source est **masquee dans OBS** -> la cellule est **noire**.
- L'apercu de la grille montre l'etat (cellule noire pour un flux desactive).
- Fichiers : `src/main/obs-controller.ts` (`SetSceneItemEnabled`),
  `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `src/renderer/views/ObsView.tsx`, `src/renderer/styles/global.css`,
  `src/shared/i18n.ts`.

## 6. Tests
- `tests/e2e/replay.mjs` : plage choisie, refus d'une plage trop courte, MP4
  lisible.
- `tests/e2e/obs.mjs` : parametre unique par source, resolution par cellule,
  flux desactive masque dans OBS.
- `tests/e2e/player.mjs` : ecran « pas de flux » (message avec variable
  resolue, fond personnalise, mode noir).
- `tests/logic.test.mjs` : reglages de replay bornes.
- Tests rendus agnostiques a la version (mise a jour, macro-variables,
  navigation).

Chiffres : **41 tests unitaires · 482 verifications e2e · 0 echec.**

