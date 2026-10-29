/**
 * Acces reseau : diagnostic et consigne, sans jamais toucher au pare-feu.
 *
 * StreamControl n'ajoute ni ne supprime AUCUNE regle de pare-feu. Modifier le
 * pare-feu depuis un programme non signe est le comportement typique d'un
 * logiciel malveillant : les antivirus le bloquent, et l'application se fait
 * fermer. Le programme se contente donc de :
 *
 * 1. verifier si ses ports sont joignables depuis l'adresse du reseau ;
 * 2. expliquer a l'utilisateur, en clair, quoi faire si ce n'est pas le cas.
 *
 * L'autorisation elle-meme reste une action de l'utilisateur, faite dans
 * Windows. C'est aussi plus sur : personne d'autre ne modifie son pare-feu.
 */

/** Resultat du test d'accessibilite des ports. */
export interface ReachabilityResult {
  /** Tous les ports testes sont joignables depuis l'adresse du reseau. */
  ok: boolean;
  /** Ports injoignables, avec leur libelle. */
  blocked: Array<{ port: number; label: string }>;
  /** Message lisible, affiche dans l'interface et le journal. */
  message: string;
}

/** Teste une connexion TCP vers une adresse locale, avec un delai borne. */
function canConnect(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  // Import local : le module net n'est utile que pour ce test.
  const net = require('node:net') as typeof import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Verifie que les ports sont joignables depuis une autre machine du reseau.
 *
 * On se connecte a sa propre adresse de reseau : si Windows laisse passer, la
 * camera et les autres postes passeront aussi. Sinon, le pare-feu bloque, et
 * l'utilisateur doit autoriser l'application lui-meme.
 */
export async function checkReachability(
  address: string,
  ports: Array<{ port: number; label: string }>,
): Promise<ReachabilityResult> {
  const blocked: Array<{ port: number; label: string }> = [];

  for (const entry of ports) {
    if (!(await canConnect(address, entry.port))) blocked.push(entry);
  }

  if (blocked.length === 0) {
    return {
      ok: true,
      blocked,
      message: `Acces reseau : les ${ports.length} port(s) repondent depuis ${address}.`,
    };
  }

  const list = blocked.map((entry) => `${entry.label} (${entry.port})`).join(', ');
  return {
    ok: false,
    blocked,
    message:
      `Acces reseau : ${list} ne repond(pas) depuis ${address}. ` +
      "C'est presque toujours le pare-feu Windows ou l'antivirus qui bloque. " +
      'Autorisez StreamControl dans Windows Defender (Pare-feu et protection du reseau, ' +
      'Autoriser une application, reseaux prives), puis relancez le test.',
  };
}
