import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLevel } from '../../shared/types';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import type { TranslationKey } from '../../shared/i18n';

const LEVELS: Array<{ id: LogLevel | 'all'; label: TranslationKey }> = [
  { id: 'all', label: 'logs.all' },
  { id: 'info', label: 'logs.info' },
  { id: 'warn', label: 'logs.warn' },
  { id: 'error', label: 'logs.error' },
  { id: 'debug', label: 'logs.debug' },
];

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function LogsView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sc.logs.filter((entry) => {
      if (filter !== 'all' && entry.level !== filter) return false;
      if (!needle) return true;
      return (
        entry.message.toLowerCase().includes(needle) || entry.source.toLowerCase().includes(needle)
      );
    });
  }, [sc.logs, filter, search]);

  useEffect(() => {
    if (!follow) return;
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [filtered, follow]);

  const exportText = filtered
    .map((entry) => `${formatTime(entry.timestamp)} [${entry.source}] ${entry.level.toUpperCase()} ${entry.message}`)
    .join('\n');

  const counts = useMemo(
    () => ({
      error: sc.logs.filter((entry) => entry.level === 'error').length,
      warn: sc.logs.filter((entry) => entry.level === 'warn').length,
    }),
    [sc.logs],
  );

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.logs')}</h1>
          <div className="topbar-sub">
            {t('logs.entries', { count: sc.logs.length })} &middot; {t('logs.errors', { count: counts.error })}{' '}
            &middot; {t('logs.warnings', { count: counts.warn })}
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn small ghost"
            disabled={filtered.length === 0}
            onClick={() => void sc.copy(exportText, t('nav.logs'))}
          >
            {t('logs.copyAll')}
          </button>
          <button type="button" className="btn small danger" onClick={() => void sc.clearLogs()}>
            {t('logs.clear')}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <div className="btn-row">
            {LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                className={`btn small${filter === level.id ? ' primary' : ' ghost'}`}
                onClick={() => setFilter(level.id)}
              >
                {t(level.label)}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder={t('logs.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="checkbox" style={{ padding: 0 }}>
            <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
            {t('logs.follow')}
          </label>
        </div>
      </div>

      <div className="logs" ref={containerRef}>
        {filtered.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            {t('logs.empty')}
          </div>
        ) : (
          filtered.map((entry) => (
            <div className={`log-line ${entry.level}`} key={entry.id}>
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              <span className="log-source" title={entry.source}>
                {entry.source}
              </span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
