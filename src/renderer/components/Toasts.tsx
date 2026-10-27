import type { Notice } from '../hooks/useStreamControl';

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
