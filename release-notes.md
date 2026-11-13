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

- **Replay : la durée annoncée est enfin juste.** La durée d'un segment était
  calculée sur ses seuls 256 premiers Ko : un segment de 2 s n'était compté que
  pour 1,2 s. La mémoire annoncée était donc très en dessous de la réalité, et
  le lecteur d'aperçu affichait une durée sans rapport (« 0:00 / 0:59 » pour un
  flux de 31 s). La durée est désormais lue dans l'en-tête du fichier, qui donne
  la valeur exacte.

- **Replay : l'aperçu et la pellicule s'affichent.** Une autorisation manquante
  empêchait l'application de lire le clip du tampon : l'aperçu restait vide et
  la pellicule ne se dessinait pas. C'est corrigé.

- **Replay : la poignée de début n'est plus bloquée.** La poignée ne pouvait pas
  descendre sous la durée minimale configurée dès que le flux avait moins de
  mémoire que ce minimum (« en dessous de 12, il me remet sur 12 »). La borne
  est désormais la durée réellement mémorisée.

- **Replay : plus de durée fantôme après un redémarrage.** Après un arrêt puis
  une reprise, les segments de la publication précédente gonflaient la durée
  annoncée (un flux publié depuis 31 s annonçait 59 s). Ils sont maintenant
  écartés à la reprise, et le tampon repart vide au démarrage de l'application.

- **Replay : l'apercu ne se coupe plus au milieu.** Sur une selection de 10 s,
  le lecteur allait jusqu'a environ 7 s puis repartait en arriere. La duree
  annoncee comptait le segment en cours d'ecriture, que le clip ne contenait pas
  encore. La duree disponible et le clip se construisent desormais sur les
  **memes segments**, et le clip se recharge tout seul quand la selection
  reclame plus de video qu'il n'en contient.

- **Macros : nouveau groupe Replay et neuf nouveaux blocs.** Replay d'une plage
  precise, vider la memoire du replay, ouvrir le dossier des replays, ouvrir le
  dossier des enregistrements, ouvrir / fermer la fenetre de lecture, afficher
  un flux dans la scene OBS, lancer une autre macro, requete HTTP POST. Quatre
  nouveaux modeles : *Replay instantane*, *Replay de tous les angles*, *Replay :
  plage et nettoyage*, *Enchainement de macros*. Nouvelle variable
  `{flux_memoire_replay}`.

- **Compatibilite MediaMTX.** Le demarrage echouait selon la version livree (le
  drapeau de validation interne n'existait pas sous cette forme). La validation
  se fait desormais en observant le demarrage reel, et le message d'erreur cite
  la sortie de MediaMTX. Le champ `hlsAllowOrigins` (dont le nom a change selon
  les versions) est retire : un nom inconnu faisait refuser toute la
  configuration.

- **OBS : « Appliquer et diffuser » ne lance plus rien tout seul.** Le bouton
  configure la scene et la met au **programme**, sans demarrer la diffusion ni
  l'enregistrement : ce sont deux actions distinctes.

- **OBS : supprimer une scene depuis StreamControl**, avec confirmation.

- **OBS : plus de sources qui s'accumulent.** Reconfigurer une scene laissait la
  source precedente dans la liste globale d'OBS (« deux mille sources web ») :
  les sources inutilisees sont desormais supprimees.

- **Replay : plus de rafraichissement aleatoire.** Le clip du tampon n'est plus
  remplace toutes les 20 s (ce qui relancait la lecture au milieu de l'extrait).
  Un bouton **Actualiser** recharge l'apercu et la pellicule a la demande.

- **Replay : deplacer toute la selection.** On peut saisir la selection et la
  faire glisser a gauche ou a droite, sans changer sa duree. Valable sur le
  poste et sur le panneau distant.

- **Pellicule : une vignette toutes les 5 secondes**, plus grandes et lisibles.
  L'apercu agrandi au survol n'est plus coupe par le cadre.

- **Statut des flux : plus de faux « ne recoit rien ».** Un hoquet de l'API
  MediaMTX ne faisait plus passer tous les flux hors ligne un instant.

- **Enregistrements dans un dossier `records`**, un sous-dossier par adresse de
  flux. Les tampons de replay des flux supprimes sont nettoyes au demarrage.

- **Moins de memoire et de disque.** L'assemblage des fichiers MP4 ecrit au fur
  et a mesure au lieu de charger tous les segments en memoire ; le HLS n'est plus
  remuxe en continu ; le journal par defaut passe a 500 lignes.

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
  en plein écran, avec ses commandes. Le plein écran ne « sortait » plus tout
  seul : la grille ne déplace plus une carte dont la position n'a pas changé.

- **Durée réelle des replays.** Un replay de 100 s n'en durait que 3 : le
  calcul comptait les segments en supposant qu'ils durent 2 s, alors que
  MediaMTX les aligne sur le GOP de la source. La durée est désormais lue dans
  les segments eux-mêmes. La durée annoncée correspond à la durée du fichier.

- **Durée « 0:00 » dans le lecteur.** Le fichier de replay se lisait, mais le
  lecteur affichait 0:00 comme durée. L'en-tête du fichier gardait la durée d'un
  seul segment (la piste annonçait zéro) : il est maintenant réécrit avec la
  durée totale. **Même correction pour les enregistrements** : MediaMTX les
  écrit aussi avec une durée de piste à zéro, ce qui donnait « 00:00 » sur les
  lecteurs de Windows.

- **Enregistrement instantané, et sans perte.** L'enregistrement démarre en
  moins d'une seconde (au lieu de 2 à 3 s) et s'arrête aussitôt : les fragments
  sont écrits au fur et à mesure, sans attendre la fin du segment. La durée du
  fichier correspond au temps enregistré — rien n'est perdu.

- **Enregistrer un flux qui ne reçoit rien n'est plus possible.** Le bouton est
  désactivé tant que le flux ne publie pas.

- **Son de l'aperçu.** La page de lecture n'était plus audible : elle est
  maintenant sonore, y compris dans l'aperçu du tableau de bord.

- **Mémoire du replay : vider et arrondir.** Un bouton **Vider la mémoire**
  efface le tampon d'un flux (utile après une réinstallation, où des segments
  anciens gonflent la durée annoncée, parfois au-delà de la mémoire réglée). La
  durée disponible est arrondie et bornée à la mémoire configurée : la barre ne
  dépasse plus 100 %.

- **Barre de lecture en pleine largeur.** La barre du replay occupe toute la
  largeur, sous la liste des flux : elle reste lisible même avec 500 s de
  mémoire.

- **Replay depuis un appareil.** La vue ordinateur du panneau distant utilise la
  même barre de lecture à deux poignées que le poste. Le téléchargement
  fonctionne désormais (il échouait avec « fichier non disponible »), et le
  fichier porte le nom du flux.

- **Replays rangés par flux.** Les replays sont écrits dans un sous-dossier
  portant le nom du flux, sous le dossier des replays.

- **Replay : plage bornée, aperçu et tête de lecture.** On ne peut plus
  demander un extrait plus long que ce qui est mémorisé (300 s alors que le flux
  n'a que 32 s). Un **aperçu du direct** montre l'image que l'on va récupérer, et
  une **tête de lecture** rouge avance de gauche à droite sur la barre.

- **Mise à jour : plus de retour en arrière ni de boucle.** Une version plus
  ancienne que celle installée n'est plus proposée. La fenêtre ne se rouvre plus
  à chaque démarrage pour une version déjà vue ; elle revient si les notes
  changent.

- **Enregistrement : le bon fichier est affiché.** Avec le replay actif,
  l'interface montrait un ancien enregistrement ; elle affiche le fichier
  réellement en cours d'écriture.

- **Verrouillage : l'indice est saisissable.** Le champ mot de passe reprenait
  le focus en boucle, empêchant de remplir l'indice.

- **Désinstallation : nettoyage proposé.** L'installeur demande si les données
  (paramètres, journaux, enregistrements, tampon de replay) doivent aussi être
  supprimées. Par défaut : non.

- **Écran « pas de flux » : activation explicite et vrai écran plein cadre.**
  Une case, désactivée par défaut, dans Paramètres > OBS Studio : tant qu'elle
  est décochée, la cellule OBS se comporte comme une page de lecture ordinaire.
  Une fois activée, la cellule n'affiche **plus le lecteur** : un logo, le texte
  en grand et un anneau de chargement remplissent l'écran. Modifier un réglage
  recharge aussitôt les sources dans OBS.

- **Replay : le plus ancien à droite, le direct à gauche.** La barre se remplit
  du direct (à gauche) vers la droite : la tête de lecture avance vers la
  droite. La poignée de droite fixe le début de l'extrait, celle de gauche la
  fin.

- **Replay : aperçu de la sélection et pellicule.** L'aperçu ne montre **que la
  plage choisie**, en boucle : c'est exactement ce que produira
  « Sauvegarder ». Une **pellicule** affiche **une vignette par seconde** sous la
  barre, comme dans un logiciel de montage ; **au survol**, la vignette est
  agrandie avec l'instant qu'elle représente (« il y a N s »). Le tout est aussi
  disponible sur le panneau distant PC.

- **Enregistrement : un seul dossier, et plus d'écrasement.** Selon que le
  replay était actif ou non, l'enregistrement partait dans deux dossiers
  différents : l'opérateur ouvrait le sous-dossier du flux et n'y voyait qu'une
  ancienne vidéo. La capture écrit désormais dans le même sous-dossier que
  MediaMTX. Les millisecondes sont conservées dans le nom : deux
  enregistrements lancés dans la même seconde ne s'écrasent plus.

---

## Replay depuis un appareil

Le panneau distant (vue ordinateur) permet désormais d'**extraire un replay** :
choisissez le début et la fin de l'extrait, en secondes en arrière, et le
fichier **MP4 est téléchargé sur l'appareil**. L'extrait est assemblé sur le
poste puis supprimé : rien ne s'écrit dans le dossier des replays du poste. Il
faut l'autorisation « Enregistrer la lecture dans le navigateur ».

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
| `src/main/replay.ts` | Durée réelle des segments, sous-dossier par flux, `planReplay`, `buildReplay` |
| `src/main/fmp4.ts` | `fmp4SegmentSeconds` : durée réelle d'un segment (mdhd + trun) |
| `src/main/stream-controller.ts` | `saveReplay` avec plage, `replayState`, `buildReplay` |
| `src/main/ipc.ts` | Canaux replay (plage, état, dossier), autorisations de scène |
| `src/main/settings.ts` | Réglages replay (mémoire, minimum, dossier), scène (écran « pas de flux ») |
| `src/main/obs-controller.ts` | Paramètre unique par source, rechargement, résolution par cellule, activation par flux |
| `src/main/player-page.ts` | Écran « pas de flux » (noir / message personnalisé) |
| `src/main/web-pages.ts` | Écran « pas de flux » ; URL WebRTC/WHEP ; routes replay du panneau distant |
| `src/main/main.ts` | Résolution des variables du message ; réglages et action replay du panneau distant |
| `src/main/remote-desktop-page.ts` | Lecture WebRTC d'abord, correction de latence, retour au direct, plein écran stable, réglage du débit, modale de replay |
| `src/main/remote-page.ts` | Retour au direct, débit d'enregistrement |
| `src/shared/types.ts` | `SceneDisplaySettings`, `ReplayResult`, `ReplayState` |
| `src/shared/channels.ts` | Canaux replay |
| `src/shared/i18n.ts` | Libellés replay, scène, écran « pas de flux » (fr + en) |
| `src/preload/index.ts` | API replay et scène |
| `src/renderer/App.tsx` | Onglet Replay dans la navigation |
| `src/renderer/views/SettingsView.tsx` | Réglages replay et écran « pas de flux » |
| `src/renderer/views/ObsView.tsx` | Boutons Affiché / Noir, aperçu des cellules noires |
| `src/renderer/styles/global.css` | Styles replay, boutons Affiché / Noir |
| `tests/e2e/replay.mjs`, `obs.mjs`, `player.mjs`, `remote.mjs`, `app-smoke.mjs` | Couverture |
| `tests/obs-ws-server.mjs` | Suivi de `SetSceneItemEnabled` |
| `tests/logic.test.mjs` | Durée réelle d'un segment fMP4, sélection d'une plage de replay, réglages bornés |
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
