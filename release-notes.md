# The Macro Update

**StreamControl 2.0.0** — la mise à jour qui transforme la régie en automate.

Écrivez une fois ce que vous faites tous les soirs. StreamControl le rejoue.

Disponible sur **Windows**, **macOS** et **Linux**.

---

## Les macros

Enchaînez des actions en un clic : changer de scène OBS, attendre, enregistrer,
lancer une transition, verrouiller le poste, sauvegarder un replay.

**47 blocs**, rangés en cinq familles : OBS, flux, poste, alertes et déroulement.

## Les variables

Écrivez `{flux_nom}` dans un champ : il est remplacé par le nom réel du flux au
moment où la macro se lance. Pas une valeur figée — celle du direct.

**90 variables** au choix. Un bouton « {x} » à droite de chaque champ ouvre une
liste cherchable. Elle sait aussi viser un flux précis : `{flux_nom_cam1}`.

Un exemple, écrit tel quel dans un bloc « journal » :

> Direct de {flux_nom} à {heure_courte} — {flux_resolution}, {flux_debit} kbit/s.

Ce qui donne, en vrai :

> Direct de Caméra scène à 21:04 — 1920x1080, 3000 kbit/s.

## Les conditions

Le bloc « condition » compare deux valeurs, avec dix comparaisons : égal,
différent, contient, ne contient pas, commence par, se termine par, plus petit
que, plus grand que, vide, non vide.

> Si `{flux_debit}` est plus petit que `900` → prévenir, puis basculer sur la
> scène de secours.

Et vous décidez de la suite : ignorer le bloc, arrêter la macro, ou continuer
après lui.

## Les modèles

Dix exemples complets, prêts à l'emploi, construits avec vos propres adresses et
scènes :

ouverture du direct · enregistrement automatique · alerte de coupure ·
générique et lancement · conducteur prêt à l'emploi · fin de direct ·
supervision du débit · rapport technique · ouverture des portes ·
verrouillage de fin de soirée.

Prenez-en un, modifiez-le, gardez-le.

---

## Le reste de la 2.0.0

- **Enregistrement indépendant par flux** — chaque caméra s'enregistre de son
  côté, sans passer par OBS.
- **StreamControl Remote** — pilotez la régie depuis un téléphone du même
  réseau, avec appairage validé sur le poste.
- **Replay instantané** — gardez les dernières secondes de chaque flux et
  sauvegardez-les en un clic.
- **Surveillance** — déconnexion, retour, débit bas : les alertes arrivent dans
  le bandeau, avec historique.
- **Analyse technique** — débit moyen, minimal et maximal, stabilité,
  résolution réelle, coupures.
- **Conducteur de spectacle** — des étapes horodatées, que l'opérateur fait
  avancer à son rythme.
- **Notification de macro** — une bulle en bas à gauche, ou le journal
  seulement : c'est vous qui choisissez.
- **Verrouillage par mot de passe**, déclenchable par une macro.
- **Visite guidée en 14 étapes** au premier lancement.
- Réglages refondus, en 11 catégories, avec recherche.

---

## Installation

1. Téléchargez l'installeur de votre système ci-dessous.
2. Lancez-le — aucun droit administrateur n'est demandé sous Windows.
3. Au premier démarrage, autorisez l'accès réseau pour les réseaux privés,
   sinon la caméra ne pourra pas publier.

Les binaires ne sont pas signés numériquement : Windows SmartScreen affiche un
avertissement (*Informations complémentaires*, puis *Exécuter quand même*), et
macOS Gatekeeper demande un clic droit > *Ouvrir* au premier lancement.

Vous partez de la 1.0.0 ? StreamControl vous proposera cette mise à jour
lui-même, au prochain démarrage.

---

## Composants tiers

- **MediaMTX** (bluenviron) — licence MIT, embarqué dans chaque installateur.
  https://github.com/bluenviron/mediamtx
- **OBS Studio** — logiciel libre (GPLv2), non embarqué : StreamControl s'y
  connecte s'il est installé sur le poste. https://obsproject.com
