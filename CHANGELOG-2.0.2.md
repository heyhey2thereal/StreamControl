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

## 6. Duree reelle des segments de replay (bug majeur)
- **Symptome** : « un replay de 100 s donne 3 s ». La duree annoncee et le
  fichier produit etaient tres en dessous de la plage demandee.
- **Cause** : le replay comptait les segments et multipliait par la duree
  demandee a MediaMTX (2 s). Or MediaMTX **aligne ses segments sur le GOP de la
  source** : un segment ne dure donc presque jamais 2 s. Compter les segments
  donnait une duree fausse — et un replay bien plus court que voulu.
- **Correction** : `fmp4SegmentSeconds()` lit la **duree reelle** portee par le
  `mdhd` (base de temps) et les `trun` (duree de chaque image). Deux pieges
  traites : un segment MediaMTX contient **plusieurs fragments** (`moof`), qu'il
  faut tous additionner ; et chaque piste a **sa propre base de temps** (90000
  en video, souvent 48000 en audio), mise en correspondance par identifiant.
  `segmentDurations` / `selectSegments` / `saveReplay` s'appuient dessus.
- Verifie sur de vrais segments MediaMTX : 8 segments de 2 s -> 16 s lues.
- Fichiers : `src/main/fmp4.ts`, `src/main/replay.ts`.

## 7. Replay range par flux, et replay depuis un appareil
- **Sous-dossier par flux** : les replays du poste sont ecrits dans
  `<dossier replay>/<Nom-du-flux>/<horodatage>.mp4`, comme les enregistrements.
- **Replay a la demande depuis le panneau distant** : un appareil du reseau peut
  extraire un extrait des dernieres secondes. L'extrait est assemble **sur le
  poste** dans un dossier temporaire, **telecharge par l'appareil**, puis
  **supprime** : rien ne s'ecrit dans le dossier des replays du poste. Une
  modale propose le debut et la fin de l'extrait, en secondes en arriere.
- Routes `GET /remote/replay/<jeton>` et `POST /remote/replay` ; autorisation
  « Enregistrer la lecture dans le navigateur » exigee (403 sinon). Un jeton de
  telechargement est a usage unique et expire au bout de 10 minutes.
- Fichiers : `src/main/replay.ts` (`planReplay`, `buildReplay`),
  `src/main/stream-controller.ts`, `src/main/web-pages.ts`,
  `src/main/main.ts`, `src/main/remote-desktop-page.ts`, `src/shared/i18n.ts`.

## 8. Plein ecran du panneau distant qui « sortait tout seul »
- **Cause** : la grille etait reconciliee a chaque rafraichissement (2 s) par un
  `appendChild` de la carte. Or **deplacer un element en plein ecran** fait
  sortir le navigateur du plein ecran : la carte plein ecran en sortait donc au
  bout de deux secondes.
- **Correction** : la grille ne deplace plus une carte dont la position n'a pas
  change (`node.nextElementSibling !== reference`). Le plein ecran tient.
- Fichiers : `src/main/remote-desktop-page.ts`.

## 9. Replay : duree « 0:00 » dans le lecteur
- **Symptome** : le fichier de replay se lit, mais le lecteur affiche **0:00**
  comme duree, alors que la lecture continue.
- **Cause** : chaque segment de MediaMTX porte un en-tete dont les durees
  decrivent **ce seul segment** (`mvhd` = quelques secondes, `tkhd` et `mdhd` a
  **zero**). La mise bout a bout conservait cet en-tete : la duree totale du
  fichier etait donc celle d'un segment, et la piste annoncait zero.
- **Correction** : a la finalisation, `fmp4.ts` reecrit les durees de l'en-tete
  (`mvhd`, `tkhd`, `mdhd`) pour qu'elles decrivent le fichier **entier**,
  cumulees par piste. La capture fait de meme a l'arret.
- Fichiers : `src/main/fmp4.ts`, `src/main/capture.ts`.

## 10. Replay : vider la memoire d'un flux
- Nouveau bouton **« Vider la memoire »** dans l'onglet Replay : il efface les
  segments du tampon d'un flux, apres confirmation. Utile apres une
  reinstallation, quand des segments d'une session precedente subsistent et
  gonflent la duree annoncee (une valeur comme `962.999... s`).
- La duree disponible est desormais **arrondie** (plus de `962.9999999 s`), et
  l'interface la **borne a la memoire configuree** : la barre ne peut plus
  depasser 100 %.
- Fichiers : `src/main/replay.ts`, `src/main/stream-controller.ts`,
  `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/channels.ts`,
  `src/shared/types.ts`, `src/renderer/hooks/useStreamControl.ts`,
  `src/renderer/views/ReplayView.tsx`, `src/renderer/components/Icon.tsx`,
  `src/shared/i18n.ts`.

## 11. Replay : barre de lecture sur toute la largeur
- La barre de lecture n'est plus dans une colonne : elle occupe **toute la
  largeur**, sous la liste des flux. C'est elle qui donne la duree de l'extrait,
  elle doit rester lisible meme avec une memoire de 500 s.
- Fichiers : `src/renderer/views/ReplayView.tsx`,
  `src/renderer/styles/global.css`.

## 12. Replay depuis un appareil : meme barre de lecture que le poste
- Le panneau distant (vue ordinateur) utilise desormais la **meme barre de
  lecture** que le poste : la memoire a gauche, le direct a droite, et deux
  **poignees deplacables** (debut et fin) au lieu de deux champs numeriques.
- **Telechargement corrige** : la balise `download` d'un navigateur ne peut pas
  envoyer d'en-tete d'autorisation ; le fichier est desormais servi sur le jeton
  d'URL (a usage unique), sans en-tete. Le fichier porte le **nom du flux** au
  lieu d'un « replay.mp4 » anonyme.
- Fichiers : `src/main/remote-desktop-page.ts`, `src/main/web-pages.ts`,
  `src/shared/i18n.ts`.

## 13. Enregistrement : demarrage et coupure instantanes, sans perte
- **Demarrage immediat** : la capture assemble les fragments **au fur et a
  mesure** (`moof`+`mdat` complets), sans attendre la fin du segment. Un
  enregistrement demarre en moins d'une seconde, et non 2 a 3 s plus tard.
- **Coupure immediate** : l'arret ecrit tout ce qui est complet et s'arrete la,
  sans attendre le segment en cours.
- **Aucune perte** : la duree du fichier correspond au temps d'enregistrement.
  Verifie : 8 s enregistrees -> 8,4 s de fichier.
- Le fragment (`recordPartDuration`) passe a **200 ms** : la granularite du
  demarrage et de l'arret, et ce qui serait perdu en cas de panne.
- Fichiers : `src/main/capture.ts`, `src/main/fmp4.ts`, `src/main/recording.ts`,
  `src/main/replay.ts`.

## 14. « 00:00 » sur les lecteurs Windows : enregistrements et replays
- **Cause** : MediaMTX ecrit ses enregistrements (et ses segments de replay)
  avec un en-tete dont `tkhd` et `mdhd` annoncent **zero** ; seul `mvhd` est
  renseigne. Les lecteurs de Windows affichent alors « 00:00 » comme duree,
  alors que la lecture continue.
- **Correction** : l'en-tete est reecrit avec la duree totale, lue dans les
  fragments — pour les replays assembles (`fmp4.ts`), et pour les
  enregistrements directs de MediaMTX, reparés peu apres leur fermeture
  (`recording-repair.ts`).
- Fichiers : `src/main/fmp4.ts`, `src/main/recording-repair.ts`,
  `src/main/main.ts`.

## 15. Divers
- **Enregistrer un flux qui ne recoit rien** est desormais impossible : le
  bouton est desactive tant que le flux ne publie pas.
- **« Replay instantane » retire de l'onglet Analyse** : l'onglet Replay le
  remplace.
- **Son de l'apercu** : la page de lecture n'est plus `muted` ; le son du flux
  s'entend donc dans l'apercu du tableau de bord (et dans la fenetre de lecture).
- Fichiers : `src/renderer/views/StreamsView.tsx`,
  `src/renderer/views/AnalysisView.tsx`, `src/main/player-page.ts`,
  `src/shared/i18n.ts`.

## 17. Replay : plage bornee, apercu et tete de lecture
- **On ne peut plus demander un replay plus long que ce qui est memorise** : un
  extrait de 300 s alors que le flux n'a que 32 s est refuse, avec un message
  clair. Les poignees sont ramenees dans la plage reellement disponible.
- **Apercu du direct** sous la barre : on voit l'image que l'on va recuperer.
- **Tete de lecture** rouge qui **avance de gauche a droite** sur la barre, au
  rythme du direct : la progression du tampon est visible en un coup d'oeil.
- Fichiers : `src/renderer/views/ReplayView.tsx`,
  `src/renderer/components/StreamPreview.tsx` (nouveau), `src/main/replay.ts`,
  `src/renderer/index.html` (hls.js), `src/shared/i18n.ts`.

## 18. Mise a jour : plus de retour en arriere, plus de boucle
- **Une version plus ancienne n'est jamais proposee** : le depot renvoyait
  parfois une version plus basse que celle installee (brouillon publie par
  erreur), et l'application la proposait — elle aurait « recule ». La comparaison
  est desormais semantique (`2.0.3 > 2.0.2`), et une version plus basse est
  ignoree.
- **Plus de boucle** : la fenetre ne se rouvre plus a chaque demarrage pour une
  version **deja vue** (meme version ET memes notes). Un nouvel envoi de notes
  change la signature et la fenetre revient — c'est ainsi qu'une meme version
  reconstruite avec des correctifs reste proposee.
- Fichiers : `src/main/app-updater.ts`, `src/shared/types.ts`,
  `src/main/settings.ts`, `src/renderer/hooks/useStreamControl.ts`.

## 19. Enregistrement : le bon fichier est affiche
- Avec le replay actif, l'interface n'avait aucun chemin a montrer (MediaMTX ne
  connait que le tampon) : elle semblait afficher un ancien enregistrement.
  Elle montre desormais le **fichier reellement en cours d'ecriture** (celui de
  la capture).
- Fichiers : `src/main/capture.ts`, `src/main/stream-controller.ts`.

## 20. Pop-up de verrouillage : l'indice est saisissable
- **Cause** : le champ mot de passe reprenait le focus a chaque redessin de
  l'application (l'effet dependait de `onClose`, une fonction recreee a chaque
  rendu). Impossible de remplir l'indice.
- **Correction** : le focus n'est donne qu'une fois, a l'ouverture.
- Fichiers : `src/renderer/components/LockDialog.tsx`.

## 21. Desinstallation : nettoyage propose
- L'installeur NSIS demande, a la desinstallation, si les **donnees** doivent
  aussi etre supprimees : parametres, journaux, enregistrements, tampon de
  replay. Par defaut, la reponse est **Non** (un clic trop rapide ne doit pas
  effacer des enregistrements).
- Fichiers : `build/uninstall-cleanup.nsh` (nouveau), `package.json`.

## 22. Ecran « pas de flux » : activation explicite
- **Cause** : l'ecran « pas de flux » etait applique des qu'un texte avait ete
  saisi, meme si l'operateur ne l'avait jamais demande. Les cellules OBS
  affichaient donc ce message au lieu du lecteur normal.
- **Correction** : une case **« Afficher un ecran “pas de flux” dans les
  cellules OBS »**, **desactivee par defaut**, dans Parametres > OBS Studio.
  Tant qu'elle est decochee, la cellule se comporte comme une page de lecture
  ordinaire.
- Fichiers : `src/shared/types.ts`, `src/main/settings.ts`, `src/main/main.ts`,
  `src/renderer/views/SettingsView.tsx`, `src/shared/i18n.ts`.

## 23. Replay : timeline inversee, apercu de la selection et pellicule
- **Le plus ancien a DROITE, le plus recent (le direct) a GAUCHE.** La memoire
  s'etend du direct (a gauche) vers la droite : la tete de lecture avance vers
  la droite a mesure que le temps passe. La poignee de droite fixe le debut de
  l'extrait, celle de gauche la fin.
- **Apercu de la selection** : l'apercu lit un **clip du tampon** (une video
  deplacable dans le temps) et ne montre **que la plage choisie** : la lecture
  part du debut de l'extrait, s'arrete a la fin, puis repart au debut. C'est
  exactement ce que produira « Sauvegarder ».
- **Clip fige par jeton** : l'apercu et la pellicule lisent un fichier
  **immuable** (`GET /clip/<flux>/new` renvoie un jeton). Auparavant, le clip
  etait remplace toutes les 4 s : le lecteur se faisait couper le fichier sous
  les pieds, et l'apercu ne « marchait » qu'apres avoir arrete le flux et
  rafraichi la page.
- **Pellicule** : une **vignette par seconde** sous la barre, le direct a
  gauche. **Au survol**, la vignette visee est **agrandie** au-dessus de la
  pellicule avec l'instant qu'elle represente (« il y a N s »).
- Le tout est aussi disponible sur le **panneau distant PC**, a l'identique.
- Nouvelle route `GET /clip/<flux>` (dernier clip) et `GET /clip/<flux>/<jeton>`
  (clip precis), avec support des requetes partielles (`Range`).
- Fichiers : `src/renderer/views/ReplayView.tsx`,
  `src/renderer/components/ReplayFilmstrip.tsx` (nouveau),
  `src/renderer/components/StreamPreview.tsx`, `src/main/replay.ts`,
  `src/main/stream-controller.ts`, `src/main/web-pages.ts`,
  `src/main/remote-desktop-page.ts`, `src/shared/types.ts`,
  `src/renderer/styles/global.css`, `src/shared/i18n.ts`.

## 23bis. Enregistrement : un seul dossier, et plus d'ecrasement
- **Cause 1** : selon que le replay etait actif ou non, l'enregistrement partait
  dans **deux dossiers differents** — `captures/` pour la capture, `<chemin du
  flux>/` pour MediaMTX. L'operateur ouvrait le sous-dossier du flux et n'y
  voyait qu'une **ancienne video**, pendant que le nouvel enregistrement etait
  ailleurs. La capture ecrit desormais dans le **meme sous-dossier que
  MediaMTX**.
- **Cause 2** : le nom du fichier portait la seconde. Deux enregistrements
  lances dans la meme seconde ecrivaient le **meme** fichier, et le second
  ecrasait le premier. Les **millisecondes** sont desormais conservees.
- Fichiers : `src/main/capture.ts`.

## 23ter. Ecran « pas de flux » : un vrai ecran plein cadre
- En mode « message », la cellule OBS n'affiche **plus le lecteur** : un **logo**,
  le **texte en grand** et un **anneau de chargement** remplissent la cellule.
- Enregistrer un reglage de cet ecran **recharge aussitot** les sources
  navigateur d'OBS (`refreshnocache`) : plus besoin de reconfigurer la scene a
  la main.
- Fichiers : `src/main/player-page.ts`, `src/main/obs-controller.ts`,
  `src/main/ipc.ts`.

## 24. Tests
- `tests/e2e/replay.mjs` : plage choisie, refus d'une plage trop courte, MP4
  lisible, duree reelle (6 s -> `duration=6`), sous-dossier par flux, **pellicule
  et apercu presents**, **clip du tampon servi en 206 (requetes partielles)**,
  **direct a gauche et graduation « Direct » en tete**, **survol d'une vignette
  (apercu agrandi + « il y a N s »)**, replay demande depuis un appareil
  (preparation, telechargement MP4 **sans en-tete d'autorisation**, nom de
  fichier, suppression, 403 sans autorisation), vidage de la memoire.
- `tests/e2e/recording.mjs` : demarrage de l'enregistrement en moins de 3 s,
  duree du fichier conforme au temps enregistre (sans perte), duree non nulle,
  **fichier range dans le sous-dossier du flux**, **un second enregistrement
  n'ecrase pas le premier**.
- `tests/e2e/update.mjs` : fenetre au lancement, notes, trois reponses,
  **version plus ancienne ignoree**, version ecartee, verification sans jeton,
  pas de retour de la fenetre apres un changement de reglage.
- `tests/e2e/player.mjs` : son de l'apercu (video non `muted`), ecran « pas de
  flux » **desactive par defaut puis active** (message avec variable resolue,
  fond personnalise, mode noir, **lecteur masque, logo et anneau presents**).
- `tests/e2e/remote.mjs` : deux interfaces, 403 sans autorisation,
  autorisation prise en compte a chaud, 401 sans jeton, reconciliation de la
  grille, barre de lecture du replay a deux poignees, **pellicule et apercu**.
- `tests/e2e/obs.mjs` : parametre unique par source, resolution par cellule,
  flux desactive masque dans OBS, **rechargement des sources apres un reglage de
  l'ecran « pas de flux »**.
- `tests/logic.test.mjs` : duree d'un segment fMP4 (plusieurs fragments, bases
  de temps par piste), **duree totale annoncee par l'en-tete assemble**,
  **lecture d'un segment en plusieurs fois sans perte**, **reparation de la
  duree d'un enregistrement direct**, **comparaison de versions**, selection
  d'une plage de replay, reglages de replay bornes.
- Tests rendus agnostiques a la version (mise a jour, macro-variables,
  navigation).

Chiffres : **47 tests unitaires · 522 verifications e2e · 0 echec.**

