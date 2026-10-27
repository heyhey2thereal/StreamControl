import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import type { TranslationKey } from '../../shared/i18n';

/** Une etape de la visite : une cible a mettre en valeur, et un texte. */
interface Step {
  /** Selecteur CSS de l'element a entourer. */
  target: string;
  title: TranslationKey;
  body: TranslationKey;
}

/**
 * Etapes de la visite.
 *
 * Chaque cible existe dans la barre laterale ou l'en-tete : la visite reste
 * donc valable quel que soit l'onglet ouvert au demarrage.
 */
const STEPS: Step[] = [
  { target: '.brand', title: 'tour.welcomeTitle', body: 'tour.welcomeBody' },
  { target: '.status-strip', title: 'tour.statusTitle', body: 'tour.statusBody' },
  { target: '[data-tour="nav-streams"]', title: 'tour.streamsTitle', body: 'tour.streamsBody' },
  { target: '[data-tour="nav-urls"]', title: 'tour.urlsTitle', body: 'tour.urlsBody' },
  { target: '[data-tour="nav-obs"]', title: 'tour.obsTitle', body: 'tour.obsBody' },
  { target: '[data-tour="nav-logs"]', title: 'tour.logsTitle', body: 'tour.logsBody' },
  { target: '[data-tour="nav-faq"]', title: 'tour.faqTitle', body: 'tour.faqBody' },
  { target: '.lock-button', title: 'tour.lockTitle', body: 'tour.lockBody' },
  { target: '[data-tour="nav-settings"]', title: 'tour.settingsTitle', body: 'tour.settingsBody' },
];

/** Rectangle d'un element, en coordonnees fenetre. */
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(target: string): Rect | null {
  const element = document.querySelector(target);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/**
 * Visite guidee affichee au premier lancement.
 *
 * Elle met en valeur un element a la fois : un halo entoure la cible, le reste
 * est assombri, et une bulle explique a quoi sert l'element. On avance, on
 * recule, ou on passe tout.
 */
export function Onboarding({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[index];

  // On mesure la cible apres chaque rendu et a chaque redimensionnement :
  // l'element peut apparaitre un instant plus tard, ou bouger.
  useLayoutEffect(() => {
    const update = () => setRect(measure(step.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const timer = setInterval(update, 400);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      clearInterval(timer);
    };
  }, [step.target]);

  // La touche Echap termine la visite, comme n'importe quelle boite de dialogue.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFinish();
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(value + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(value - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFinish]);

  const last = index === STEPS.length - 1;

  // La bulle se place sous la cible, ou au-dessus s'il n'y a pas la place.
  const bubbleTop = rect ? rect.top + rect.height + 14 : window.innerHeight / 2;
  const below = rect ? bubbleTop + 190 < window.innerHeight : true;

  return (
    <div className="tour-root" role="dialog" aria-modal="true">
      <div className="tour-dim" />

      {rect ? (
        <div
          className="tour-halo"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : null}

      <div
        className="tour-bubble"
        style={
          rect
            ? {
                top: below ? bubbleTop : Math.max(16, rect.top - 200),
                left: Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 380)),
              }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        }
      >
        <div className="tour-step">{t('tour.step', { index: index + 1, total: STEPS.length })}</div>
        <h3 className="tour-title">{t(step.title)}</h3>
        <p className="tour-body">{t(step.body)}</p>

        <div className="tour-actions">
          <button type="button" className="btn small ghost" onClick={onFinish}>
            {t('tour.skip')}
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn small ghost"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            {t('tour.previous')}
          </button>
          <button
            type="button"
            className="btn small primary"
            onClick={() => (last ? onFinish() : setIndex((value) => value + 1))}
          >
            {last ? t('tour.finish') : t('tour.next')}
          </button>
        </div>

        <div className="tour-dots">
          {STEPS.map((entry, dotIndex) => (
            <span key={entry.target} className={`tour-dot${dotIndex === index ? ' on' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
