/**
 * Icones de l'interface.
 *
 * Un jeu unique de traces SVG, en contour, sur une grille de 24. Elles
 * remplacent les anciens symboles Unicode (▣ ▶ ⚙ …), dont le rendu dependait
 * de la police du poste et ne s'accordait pas d'une icone a l'autre.
 *
 * Chaque icone herite de la couleur du texte (`currentColor`) et de sa taille,
 * pour rester lisible dans la barre laterale comme dans les categories.
 */
import type { SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'streams'
  | 'services'
  | 'urls'
  | 'obs'
  | 'logs'
  | 'settings'
  | 'guide'
  | 'faq'
  | 'general'
  | 'network'
  | 'recording'
  | 'remote'
  | 'files'
  | 'security'
  | 'updates'
  | 'macros'
  | 'replay'
  | 'monitor'
  | 'show'
  | 'analysis'
  | 'lock'
  | 'lockOpen'
  | 'search'
  | 'check'
  | 'close';

/** Trace de chaque icone, sans l'enveloppe SVG. */
const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  streams: 'M4 6h16M4 12h16M4 18h10M2 6h.01M2 12h.01M2 18h.01',
  services: 'M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2M12 9a3 3 0 100 6 3 3 0 000-6z',
  urls: 'M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1',
  obs: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 10a2 2 0 100 4 2 2 0 000-4z',
  logs: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h5',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  guide: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 11v5M12 8h.01',
  faq: 'M9 9a3 3 0 116 0c0 2-3 2-3 4M12 17h.01',
  general: 'M4 7h16M4 12h16M4 17h10',
  network: 'M12 4v4M12 16v4M6 8h12v8H6zM9 12h.01M15 12h.01',
  recording: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 10a2 2 0 100 4 2 2 0 000-4z',
  remote: 'M8 3h8v18H8zM11 18h2',
  files: 'M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2z',
  security: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  updates: 'M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4',
  macros: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM16 13v6M13 16h6',
  replay: 'M12 5a7 7 0 107 7M12 5V2M12 5l3 3M9 12l2-3 2 3-2 3z',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4M7 10l2 2-2 2M12 14h4',
  show: 'M4 6h16M4 12h10M4 18h7M17 13v6M14 16h6',
  analysis: 'M4 20V4M4 20h16M8 17V9M12 17v-5M16 17v-8',
  lock: 'M6 11V8a6 6 0 0112 0v3M5 11h14v9H5zM12 15v2',
  lockOpen: 'M6 11V8a6 6 0 0112 0M5 11h14v9H5zM12 15v2',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Taille en pixels ; 18 par defaut, la taille des libelles. */
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
