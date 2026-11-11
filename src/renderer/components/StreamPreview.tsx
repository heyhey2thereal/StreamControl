import { useEffect, useRef } from 'react';

/**
 * Apercu d'un extrait du tampon, pour l'onglet Replay.
 *
 * On lit le **clip du tampon** (et non le direct) : c'est une video deplacable
 * dans le temps, ce qui permet de montrer exactement l'image au debut de la
 * plage selectionnee. Le direct HLS, lui, ne se deplace pas.
 *
 * L'apercu est **muet** : c'est une image de controle, pas une ecoute.
 *
 * @param src adresse du clip.
 * @param seekSeconds position a montrer, en secondes depuis le debut du clip.
 *   `null` : lecture normale depuis le debut.
 */
export function StreamPreview({
  src,
  seekSeconds,
  onReady,
}: {
  src: string;
  seekSeconds?: number | null;
  onReady?: (video: HTMLVideoElement) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // La source change (nouveau flux, nouveau clip) : on recharge.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    video.load();
    void video.play().catch(() => undefined);
  }, [src]);

  // La position demandee change : on deplace la lecture.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || seekSeconds === undefined || seekSeconds === null) return;
    const apply = () => {
      try {
        video.currentTime = Math.max(0, seekSeconds);
      } catch {
        // La duree n'est pas encore connue : on retente a l'arrivee des donnees.
      }
      video.pause();
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
  }, [seekSeconds, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && onReady) onReady(video);
  }, [onReady, src]);

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
