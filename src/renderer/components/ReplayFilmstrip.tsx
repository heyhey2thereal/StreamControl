import { useEffect, useRef } from 'react';

/**
 * Pellicule de la timeline : une vignette par seconde, comme dans un logiciel
 * de montage video.
 *
 * On lit le **clip du tampon** dans un element video hors ecran, et on dessine
 * une image par seconde sur un canevas. L'ordre suit celui de la barre : la
 * vignette la plus a gauche est la plus ancienne, la plus a droite le direct.
 *
 * Le clip a une duree finie : contrairement au direct HLS, on peut s'y deplacer
 * librement, ce qui est indispensable pour extraire une image a un instant
 * precis.
 */
export function ReplayFilmstrip({
  src,
  seconds,
  memory,
  thumbWidth = 160,
  thumbHeight = 90,
}: {
  /** Adresse du clip du tampon. */
  src: string;
  /** Duree reellement disponible dans le clip, en secondes. */
  seconds: number;
  /** Memoire configuree : largeur totale de la pellicule. */
  memory: number;
  thumbWidth?: number;
  thumbHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src || seconds < 1) return undefined;

    const count = Math.max(1, Math.min(Math.floor(seconds), 120));
    canvas.width = count * thumbWidth;
    canvas.height = thumbHeight;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const video = document.createElement('video');
    videoRef.current = video;
    video.src = src;
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let cancelled = false;
    let index = 0;

    // Une vignette par seconde, de la plus ancienne (a gauche) au direct (a droite).
    const capture = () => {
      if (cancelled) return;
      context.drawImage(video, index * thumbWidth, 0, thumbWidth, thumbHeight);
      index += 1;
      if (index >= count) return;
      // On vise le debut de chaque seconde, au centre de l'intervalle.
      video.currentTime = Math.min(index, Math.max(0, video.duration - 0.05));
    };

    video.addEventListener('loadedmetadata', () => {
      try {
        video.currentTime = 0;
      } catch {
        // Ignore : on retente au premier evenement de donnees.
      }
    });
    video.addEventListener('seeked', capture);
    video.addEventListener('loadeddata', () => {
      if (index === 0) capture();
    });
    video.addEventListener('error', () => {
      // Clip illisible : la pellicule reste vide, ce n'est pas bloquant.
    });

    return () => {
      cancelled = true;
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Ignore.
      }
      videoRef.current = null;
    };
  }, [src, seconds, thumbWidth, thumbHeight]);

  // La pellicule occupe la largeur de la memoire configuree : elle est donc
  // alignee sur la barre, et les vignettes restent a la bonne place meme quand
  // la memoire n'est pas encore pleine.
  const widthPercent = `${Math.min(100, Math.max(0, (seconds / Math.max(1, memory)) * 100))}%`;

  return (
    <div className="replay-filmstrip" style={{ width: widthPercent }}>
      <canvas ref={canvasRef} className="replay-filmstrip-canvas" />
    </div>
  );
}
