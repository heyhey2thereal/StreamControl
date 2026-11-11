import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';

/** Largeur d'une vignette dans le canevas (haute definition pour le survol). */
const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 135;
/** Taille de l'apercu agrandi, au survol. */
const POP_WIDTH = 480;
const POP_HEIGHT = 270;
/**
 * Duree representee par une vignette, en secondes.
 *
 * Cinq secondes : des vignettes plus grandes et plus lisibles qu'une image par
 * seconde, et beaucoup moins de travail au dessin (une capture toutes les 5 s
 * au lieu d'une par seconde). La pellicule reste alignee sur la barre.
 */
const THUMB_SECONDS = 5;

/**
 * Pellicule de la timeline : une vignette toutes les 5 secondes, comme dans un
 * logiciel de montage video.
 *
 * On lit le **clip du tampon** (fichier fige, designe par un jeton) dans un
 * element video hors ecran, et on dessine une image toutes les 5 s sur un
 * canevas. L'ordre suit celui de la barre : la vignette la plus a gauche est la
 * plus recente (le direct), la plus a droite la plus ancienne.
 *
 * Au **survol**, la vignette visee est agrandie au-dessus de la pellicule, avec
 * l'instant qu'elle represente (« il y a N s »).
 */
export function ReplayFilmstrip({
  src,
  seconds,
  memory,
}: {
  /** Adresse du clip du tampon (avec son jeton). */
  src: string;
  /** Duree du clip, en secondes. */
  seconds: number;
  /** Memoire configuree : largeur totale de la pellicule. */
  memory: number;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Une vignette toutes les 5 s. `count` reste borne pour ne pas dessiner des
  // centaines d'images sur une tres longue memoire.
  const count = Math.max(1, Math.min(Math.ceil(seconds / THUMB_SECONDS), 120));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src || seconds < 1) return undefined;

    canvas.width = count * THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    // Fond neutre : une vignette pas encore capturee ne doit pas etre blanche.
    context.fillStyle = '#0f1216';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let cancelled = false;
    let index = 0;

    // Une vignette par seconde. Le clip va du plus ancien (debut) au plus recent
    // (fin) ; sur la pellicule, le plus RECENT (le direct) est a GAUCHE et le
    // plus ANCIEN a DROITE. On dessine donc l'image d'index `index` a la
    // position `count - 1 - index`.
    const capture = () => {
      if (cancelled) return;
      const column = count - 1 - index;
      context.drawImage(video, column * THUMB_WIDTH, 0, THUMB_WIDTH, THUMB_HEIGHT);
      index += 1;
      if (index >= count) return;
      // Instant represente par la vignette suivante, en secondes depuis le
      // debut du clip.
      const at = Math.min(
        index * THUMB_SECONDS,
        Math.max(0, (video.duration || count * THUMB_SECONDS) - 0.05),
      );
      try {
        video.currentTime = at;
      } catch {
        // Ignore : on retente au prochain evenement.
      }
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

    return () => {
      cancelled = true;
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Ignore.
      }
    };
  }, [src, seconds, count]);

  // L'apercu agrandi recopie la vignette visee depuis le canevas : pas besoin
  // d'un second lecteur, et l'image est deja en memoire.
  useEffect(() => {
    const canvas = canvasRef.current;
    const pop = popRef.current;
    if (!canvas || !pop || hover === null) return;
    pop.width = POP_WIDTH;
    pop.height = POP_HEIGHT;
    const context = pop.getContext('2d');
    if (!context) return;
    context.drawImage(
      canvas,
      hover * THUMB_WIDTH,
      0,
      THUMB_WIDTH,
      THUMB_HEIGHT,
      0,
      0,
      POP_WIDTH,
      POP_HEIGHT,
    );
  }, [hover, count, src]);

  // La pellicule occupe la largeur de la memoire configuree : elle est alignee
  // sur la barre, et les vignettes restent a la bonne place meme quand la
  // memoire n'est pas encore pleine.
  const widthPercent = `${Math.min(100, Math.max(0, (seconds / Math.max(1, memory)) * 100))}%`;

  // La colonne `hover` est celle du survol, dans l'ordre affiche : la colonne 0
  // (a gauche) est le direct (0 s en arriere), la derniere (a droite) est la
  // plus ancienne.
  const hoverSecondsAgo = hover === null ? null : Math.round(hover * (seconds / count));

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(Math.min(count - 1, Math.floor(ratio * count)));
  };

  return (
    <div className="replay-filmstrip" style={{ width: widthPercent }}>
      <canvas
        ref={canvasRef}
        className="replay-filmstrip-canvas"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover !== null && hoverSecondsAgo !== null ? (
        <div className="replay-thumb-pop" style={{ left: `${((hover + 0.5) / count) * 100}%` }}>
          <canvas ref={popRef} className="replay-thumb-pop-image" />
          <div className="replay-thumb-pop-time">
            {t('replay.thumbAgo', { seconds: hoverSecondsAgo })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
