import type { ServiceState } from '../../shared/types';
import { useTranslation } from '../hooks/useTranslation';
import type { TranslationKey } from '../../shared/i18n';

interface Props {
  state: ServiceState | 'connected' | 'disconnected';
  label: string;
}

const LABELS: Record<string, TranslationKey> = {
  stopped: 'state.stopped',
  starting: 'state.starting',
  running: 'state.running',
  stopping: 'state.stopping',
  error: 'state.error',
  connected: 'state.connected',
  disconnected: 'state.disconnected',
};

export function StatusLed({ state, label }: Props) {
  const { t } = useTranslation();
  const key = LABELS[state];
  return (
    <span className="status-line">
      <span className={`led ${state}`} aria-hidden />
      <span>
        <span className="stat-label">{label}</span>
        <span style={{ marginLeft: 8, fontSize: 12.5 }}>{key ? t(key) : state}</span>
      </span>
    </span>
  );
}
