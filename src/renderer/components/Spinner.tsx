/**
 * Indicateur de chargement.
 *
 * Un anneau qui tourne, dessine en CSS : aucune dependance, aucune image a
 * charger. Il sert partout ou une action prend du temps (demarrage, connexion,
 * ouverture d'une fenetre), pour que l'interface ne paraisse jamais figee.
 */
interface Props {
  /** Taille en pixels. Par defaut 32. */
  size?: number;
  /** Texte affiche a droite de l'anneau, si fourni. */
  label?: string;
  /** Variante lente, pour une attente longue (flux absent, par exemple). */
  slow?: boolean;
}

export function Spinner({ size = 32, label, slow = false }: Props) {
  return (
    <span className="spinner-line">
      <span
        className={`spinner${slow ? ' slow' : ''}`}
        style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 12)) }}
        role="progressbar"
        aria-label={label ?? 'Chargement'}
      />
      {label ? <span className="spinner-label">{label}</span> : null}
    </span>
  );
}
