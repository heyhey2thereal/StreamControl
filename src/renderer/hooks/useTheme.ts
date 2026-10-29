/**
 * Application du theme a la racine du document.
 *
 * Le theme vit dans les parametres ; le CSS se contente de lire l'attribut
 * `data-theme` pose ici. Aucun composant n'a donc besoin de connaitre le
 * theme pour rester lisible.
 */
import { useEffect } from 'react';
import type { Theme } from '../../shared/types';

/** Pose l'attribut de theme sur <html>, et met a jour la barre de titre. */
export function useTheme(theme: Theme | undefined): void {
  useEffect(() => {
    const resolved: Theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
  }, [theme]);
}
