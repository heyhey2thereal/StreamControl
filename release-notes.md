# StreamControl v1.0.0

Regie video pour la **DJI Osmo Pocket 3**, **MediaMTX** et **OBS Studio**.
Disponible sur **Windows**, **macOS** et **Linux**.

## Nouveautes

- **Un seul point d'entree.** MediaMTX est le seul serveur de flux : il recoit
  la publication et la redistribue. StreamControl le pilote, relaie le HLS et le
  WebRTC, et sert ses propres pages. Les serveurs HTTP de MediaMTX n'ecoutent
  que sur la boucle locale ; seuls le RTMP et le port des pages sont exposes au
  reseau.

- **Adresses de diffusion.** Creation d'adresses avec protocole, chemin et cle
  d'acces. Chaque adresse affiche son etat en direct (debit, definition, duree,
  octets recus, spectateurs) et toutes ses URL, copiables en un clic.

- **Lecture sous la seconde.** Le lecteur essaie d'abord le **WebRTC (WHEP)**,
  qui maintient l'image sous la seconde sans tampon ; le **HLS faible latence**
  (parties de 200 ms) prend le relais si le WebRTC n'aboutit pas, et une
  correction automatique empeche le flux de deriver.

- **Pages web.** Une page de lecture reduite sert d'apercu au tableau de bord et
  une page complete est ouvrable depuis un navigateur. Les adresses inconnues
  sont refusees avant meme de contacter MediaMTX.

- **OBS Studio.** Connexion WebSocket v5, liste des scenes, changement de scene,
  demarrage et arret de la diffusion et de l'enregistrement.

- **Scenes OBS.** Creez une scene, cliquez dessus, et choisissez de 1 a 4
  adresses : OBS les repartit en grille (plein ecran, cote a cote, 2x2). Un
  apercu montre la disposition avant de valider.

- **Mode studio.** Previsualisation et programme cote a cote, transition d'une
  adresse a l'autre en un clic, choix de la transition et de sa duree : tout se
  pilote depuis StreamControl, sans toucher a OBS.

- **Verrouillage.** Un mot de passe masque l'interface : utile quand le poste
  sert de serveur en regie. Le mot de passe n'est jamais stocke en clair.

- **Visite guidee** au premier lancement, **FAQ** et **tutoriel OBS** integres.

- **Interface.** Sombre, dense et sobre. Langue (francais, anglais), theme,
  journaux en direct, parametres sauvegardes localement.

- **Trois systemes.** Installeurs Windows (NSIS), macOS (dmg, Apple Silicon et
  Intel) et Linux (AppImage, deb), chacun avec son binaire MediaMTX.

## Notes de version

- Les URL de lecture (HLS, page web, WebRTC, API) pointent sur `127.0.0.1` :
  elles sont servies par StreamControl sur ce poste, et Windows bloque une
  requete d'un poste vers sa propre adresse de reseau. Les URL d'ingestion
  (RTMP, SRT, RTSP) restent sur l'IPv4 du LAN, c'est la camera qui publie.

---

## Installation

1. Telechargez l'installeur de votre systeme ci-dessous.
2. Lancez-le (aucun droit administrateur n'est exige sur Windows).
3. Au premier demarrage, autorisez l'acces reseau pour les reseaux prives,
   sinon la camera ne pourra pas publier.

Les binaires ne sont pas signes numeriquement : Windows SmartScreen affiche un
avertissement (*Informations complementaires*, puis *Executer quand meme*) et
macOS Gatekeeper demande un clic droit > *Ouvrir* au premier lancement.

Le fichier `build-log.txt` joint a cette version contient le journal de
compilation complet : versions des outils, sortie de chaque etape, empreintes
SHA-256 des fichiers produits.
