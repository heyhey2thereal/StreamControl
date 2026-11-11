import { useEffect, useRef } from 'react';

/**
 * Apercu de la plage selectionnee, pour l'onglet Replay.
 *
 * On lit un **clip du tampon** (une video deplacable dans le temps), et on ne
 * montre QUE la plage choisie : la lecture demarre au debut de l'extrait,
 * s'arrete a la fin, puis repart au debut. C'est exactement ce que produira le
 * bouton « Sauvegarder ».
 *
 * Le clip est designe par un **jeton** : son fichier n'est jamais remplace, donc
 * la lecture fonctionne **pendant** le direct, sans devoir l'arreter.
 *
 * L'apercu est **muet** : c'est une image de controle, pas une ecoute.
 *
 * @param src adresse du clip (avec son jeton).
 * @param fromSeconds debut de la plage, en secondes depuis le debut du clip.
 * @param toSeconds fin de la plage, en secondes depuis le debut du clip.
 */
export function StreamPreview({
  src,
  fromSeconds,
  toSeconds,
}: {
  src: string;
  fromSeconds: number;
  toSeconds: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Bornes de la plage dans des references : le minuteur les relit sans
  // relancer la lecture a chaque deplacement de poignee.
  const from = Math.max(0, fromSeconds);
  const to = Math.max(from, toSeconds);
  const bounds = useRef({ from, to });
  bounds.current = { from, to };

  // La source change : on (re)charge et on se place au debut de la plage.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const seekToStart = () => {
      try {
        video.currentTime = bounds.current.from;
      } catch {
        // La duree n'est pas encore connue.
      }
      void video.play().catch(() => undefined);
    };
    // `load()` remet le lecteur a zero : on l'appelle AVANT de se placer, sinon
    // le deplacement serait aussitot annule.
    video.load();
    if (video.readyState >= 1) seekToStart();
    else video.addEventListener('loadedmetadata', seekToStart, { once: true });
  }, [src]);

  // Boucle sur la plage : on revient au debut des qu'on atteint la fin.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onTime = () => {
      const { from: start, to: end } = bounds.current;
      if (end > start && video.currentTime >= end) {
        try {
          video.currentTime = start;
        } catch {
          // Ignore : on retente au prochain cycle.
        }
      } else if (video.currentTime < start - 0.5) {
        // Replace avant le debut (fin de clip, par exemple).
        try {
          video.currentTime = start;
        } catch {
          // Ignore.
        }
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [src]);

  // Les bornes changent : on se replace si la lecture est sortie de la plage.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 1) return;
    if (video.currentTime < from || video.currentTime > to) {
      try {
        video.currentTime = from;
      } catch {
        // Ignore.
      }
    }
    void video.play().catch(() => undefined);
  }, [from, to]);

  return (
    <video
      ref={videoRef}
      className="replay-preview-video"
      src={src}
      muted
      playsInline
      controls
      preload="auto"
    />
  );
}
