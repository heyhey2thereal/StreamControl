import type { MacroNotice, Notice } from '../hooks/useStreamControl';

interface Props {
  notices: Notice[];
  onDismiss: (id: number) => void;
}

export function Toasts({ notices, onDismiss }: Props) {
  if (notices.length === 0) return null;

  return (
    <div className="toasts">
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className={`toast ${notice.kind}`}
          onClick={() => onDismiss(notice.id)}
          title="Cliquer pour fermer"
        >
          {notice.text}
        </button>
      ))}
    </div>
  );
}

/**
 * Bulles produites par les macros (« notifier »).
 *
 * Elles s'affichent en bas a **gauche**, a l'oppose des notifications de
 * l'application : l'operateur distingue ainsi d'un coup d'oeil un message de sa
 * regie d'un message de l'outil. Le clic les ferme.
 */
export function MacroToasts({
  notices,
  onDismiss,
}: {
  notices: MacroNotice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) return null;

  return (
    <div className="toasts macro-toasts">
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className="toast macro"
          onClick={() => onDismiss(notice.id)}
          title="Cliquer pour fermer"
        >
          <span className="toast-tag">Macro</span>
          {notice.text}
        </button>
      ))}
    </div>
  );
}
