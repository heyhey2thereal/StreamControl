import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

/**
 * Apercu d'un flux en direct, pour l'onglet Replay.
 *
 * Chromium (donc Electron) ne lit pas le HLS nativement : on passe par hls.js.
 * L'apercu est **muet** : c'est une image de controle, pas une ecoute, et un
 * flux sonore qui demarre tout seul serait desagreable.
 *
 * Le lecteur est reutilise : changer de flux detruit proprement l'instance
 * precedente, sinon les sessions s'accumuleraient cote MediaMTX.
 */
export function StreamPreview({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 1, backBufferLength: 0 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
      return () => hls.destroy();
    }

    // Safari lit le HLS nativement.
    video.src = src;
    void video.play().catch(() => undefined);
    return undefined;
  }, [src]);

  return <video ref={videoRef} className="replay-preview-video" muted autoPlay playsInline controls />;
}
