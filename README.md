# StreamControl

Regie video Windows, macOS et Linux : transformez un PC en serveur de flux pret
a l'emploi pour toute source **RTMP** (camera, telephone, logiciel de
diffusion), et pilotez **OBS Studio** par
WebSocket.

Le serveur de flux est **MediaMTX** : il recoit la publication de la camera et
la redistribue en RTMP, HLS, WebRTC, RTSP et SRT. StreamControl le pilote, sert
ses propres pages de lecture et relaie le HLS et le WebRTC depuis la boucle
locale. Les serveurs HTTP de MediaMTX n'ecoutent donc que sur `127.0.0.1` :
seuls le RTMP et le port des pages sont exposes au reseau.

---

## Telecharger et installer

Choisissez l'installeur de votre systeme dans la page **Releases** :

| Systeme | Fichier |
|---|---|
| **Windows** | `StreamControl-Setup-1.0.0.exe` |
| **macOS** | `StreamControl-1.0.0-arm64.dmg` (Apple Silicon) ou `-x64.dmg` (Intel) |
| **Linux** | `StreamControl-1.0.0.AppImage` ou `.deb` |

Puis :

1. Lancez l'installeur (aucun droit administrateur n'est exige sur Windows).
2. Au premier demarrage, autorisez l'acces reseau : **reseaux prives** sur
   Windows, ou l'autorisation de pare-feu demandee par macOS. Sans cela, la
   camera ne pourra pas publier.

Les binaires ne sont pas signes numeriquement. Windows SmartScreen affiche un
avertissement (*Informations complementaires* puis *Executer quand meme*) et
macOS Gatekeeper demande un clic droit > **Ouvrir** au premier lancement. Le code
source complet est dans ce depot si vous preferez compiler vous-meme.

### Ce dont l'application a besoin

| Composant | Obligatoire | Comment l'obtenir |
|---|---|---|
| **MediaMTX** | Oui | Fourni dans l'installeur de chaque systeme |
| **OBS Studio** | Non | Installeur officiel sur obsproject.com |

Aucun compte, aucun abonnement, aucun service cloud, **aucun Docker**.

---

## Installation detaillee

L'onglet **Installation** de l'application reprend ces etapes avec l'etat reel
de votre machine (chemins detectes, composants presents ou manquants).

### 1. Le serveur de flux

**Rien a installer.** MediaMTX est fourni avec l'application et demarre avec
elle. Depuis l'onglet **Flux**, creez une adresse : vous obtenez immediatement
l'URL RTMP a saisir dans votre appareil, l'URL HLS de lecture, et une page web
ouvrable dans un navigateur.

### 2. OBS Studio (optionnel)

1. Installez OBS Studio.
2. Dans OBS : **Outils > WebSocket Server Settings**, cochez *Enable WebSocket
   server*. Notez le port (4455 par defaut) et le mot de passe si
   l'authentification est activee.
3. Dans StreamControl, onglet **Parametres > OBS Studio**, saisissez ces valeurs.
4. Cliquez sur **Connecter** dans l'onglet OBS Studio.

### 3. Camera ou source RTMP

StreamControl accepte toute source qui publie en RTMP : camera, telephone,
logiciel de diffusion, encodeur. L'exemple ci-dessous utilise une **DJI Osmo
Pocket 3**, dont l'application **DJI Mimo** publie en RTMP.

1. Placez la source et le PC sur le meme reseau local (un partage de
   connexion mobile fonctionne tres bien).
2. Dans l'application de la source (par exemple **DJI Mimo** pour l'Osmo
   Pocket 3), choisissez la diffusion en direct avec une plateforme
   **RTMP personnalise**.
3. Collez l'URL RTMP affichee dans l'onglet **URL de diffusion** de
   StreamControl, au format `rtmp://VOTRE_IP:1935/live`.
4. Verifiez dans l'onglet **Journaux** qu'une publication apparait, puis lancez
   l'apercu depuis le tableau de bord.

---

## Fonctionnalites

- **Flux** : creation d'adresses avec protocole, chemin et cle d'acces. Chaque
  adresse affiche son etat en direct (debit, definition, duree, octets recus,
  spectateurs) et toutes ses URL, copiables en un clic. Une fenetre de lecture
  integree affiche le flux dans l'application.
- **Tableau de bord** : etat des services, adresse IPv4, apercu du flux, ports
  en conflit, controle rapide.
- **Services** : demarrer, arreter et redemarrer MediaMTX, avec redemarrage
  automatique limite apres un arret inattendu et affichage du PID.
- **URL de diffusion** : RTMP, SRT, RTSP, HLS, WebRTC et API, copiables en un
  clic, plus le bloc de configuration a coller dans OBS.
- **OBS Studio** : connexion WebSocket v5, liste des scenes, changement de
  scene, demarrage et arret de la diffusion et de l'enregistrement.
- **Journaux** : sortie de MediaMTX et de l'application, filtres par niveau,
  recherche, export vers le presse-papiers.
- **Parametres** : ports, chemins des binaires, mot de passe OBS, intervalle de
  rafraichissement, adresse IPv4 forcee. Sauvegardes dans
  `%APPDATA%\StreamControl\settings.json`.

### Apercu video

Le lecteur essaie d'abord le **WebRTC (WHEP)**, qui maintient l'image sous la
seconde sans tampon. Si le WebRTC n'aboutit pas (source H.264 avec images B,
rendu logiciel, reseau qui bloque l'UDP), le **HLS faible latence** prend le
relais automatiquement : parties de 200 ms et correction de latence, soit
environ une seconde de retard.

### Ou regarder le flux

Les URL de lecture (HLS, page web, WebRTC, API) pointent sur `127.0.0.1` :
elles sont servies par StreamControl sur ce poste, et Windows bloque une requete
d'un poste vers sa propre adresse de reseau. Les URL d'ingestion (RTMP, SRT,
RTSP) restent sur l'IPv4 du LAN : c'est la camera qui publie.

---

## Limites assumees

- **GoStream Deck** : cet appareil ne dispose d'aucune API publique documentee.
  StreamControl **ne le pilote pas** et ne pretend pas le faire. Configurez-le
  directement sur l'appareil.
- **SRT et RTSP** : l'interface les propose, mais seul RTMP est mis en avant
  pour l'ingestion. MediaMTX les accepte et les redistribue.
- **WebRTC et images B** : MediaMTX refuse un flux H.264 contenant des images B
  (« WebRTC doesn't support H264 streams with B-frames »). Le lecteur retombe
  alors sur le HLS.
- **Mot de passe OBS** : stocke en clair dans `settings.json`. N'utilisez pas ce
  poste comme machine partagee si cela vous concerne.
- **Signature du binaire** : l'installateur n'est pas signe, ce qui declenche
  SmartScreen au premier lancement.

---

## Architecture

```
src/
  shared/       types et noms de canaux IPC, partages entre les processus
  main/         processus principal Electron
    logger.ts            journal en memoire diffuse au rendu
    settings.ts          chargement, fusion et validation des parametres
    network.ts           detection IPv4, tests de ports et de connexion TCP
    urls.ts              construction des URL de diffusion
    detection.ts         recherche de mediamtx.exe et obs64.exe
    mediamtx-config.ts   generation de mediamtx.yml
    mediamtx-manager.ts  cycle de vie du processus MediaMTX
    mediamtx-updater.ts  telechargement de MediaMTX depuis GitHub
    obs-client.ts        implementation du protocole obs-websocket v5
    obs-controller.ts    logique metier OBS (scenes, diffusion)
    stream-registry.ts   registre des adresses de diffusion
    stream-controller.ts passerelle entre l'interface et MediaMTX
    web-pages.ts         serveur de pages, relais HLS et WebRTC
    player-page.ts       page de lecture web (WebRTC puis HLS)
    firewall.ts          diagnostic d'acces reseau (aucune modification)
    preflight.ts         rapport d'etat de la machine
    storage.ts           inventaire et ouverture des fichiers
    ipc.ts               gestionnaires IPC
    main.ts              demarrage, fenetre, arret propre
  preload/      pont contextBridge (API typee exposee au rendu)
  renderer/     interface React (vues, composants, styles)
tests/
  logic.test.mjs       URL, reseau, journal
  obs-client.test.mjs  protocole obs-websocket v5
  obs-ws-server.mjs    serveur obs-websocket v5 de test
  e2e/                 tests de bout en bout sur l'application reelle
    harness.mjs          harnais commun (serveur statique, Electron, CDP)
```

**Choix technique : Electron.** Il produit un veritable `.exe` via
electron-builder, permet de lire le flux HLS nativement dans le rendu, et
n'exige aucune chaine de compilation Rust sur les machines de developpement ou
d'integration continue.

---

## Developpement

```bash
npm install
npm run dev          # Vite + Electron avec rechargement
npm run typecheck    # verification TypeScript des deux projets
npm run build        # compilation du rendu et du processus principal
npm test             # tests unitaires (dont le protocole OBS)
npm run dist:win     # installateur Windows
npm run dist:mac     # installateur macOS (dmg + zip)
npm run dist:linux   # installateur Linux (AppImage + deb)
```

### Tests de bout en bout

Ils lancent l'application reelle et la pilotent via le Chrome DevTools Protocol.

```bash
npm run build
xvfb-run -a npm run test:e2e                        # Linux sans ecran
STREAMCONTROL_MEDIAMTX_BINARY=/chemin/mediamtx npm run test:e2e
```

Sous Windows, remplacez `xvfb-run -a` par rien du tout.

---

## Publication

Le workflow `.github/workflows/build-installers.yml` compile les trois
installateurs (Windows, macOS, Linux) :

- **push d'un tag `v*`** : construit l'installateur et cree une Release GitHub
  avec le `.exe` telechargeable ;
- **execution manuelle** (onglet Actions) : construit l'installateur et le
  depose comme artefact telechargeable ;
- **pull request** : verifie seulement que le projet compile et que les tests
  passent.

Pour publier une version :

```bash
git tag -f -a v1.0.0 -m "StreamControl 1.0.0"
git push origin -f v1.0.0
```

---

## Licence

MIT. MediaMTX et OBS Studio sont des projets tiers distribues sous leurs propres
licences.

### Composants tiers redistribues

- **MediaMTX** (bluenviron) — licence MIT. Le binaire est embarque dans chaque
  installateur (dossier `resources/mediamtx`) afin que l'application fonctionne
  hors ligne. Source : https://github.com/bluenviron/mediamtx

### Composants tiers non redistribues

- **OBS Studio** — logiciel libre (GPLv2). Il n'est pas embarque : StreamControl
  s'y connecte s'il est deja installe sur le poste.
