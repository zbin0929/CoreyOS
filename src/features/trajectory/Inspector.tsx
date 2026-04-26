import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import type { DbSessionWithMessages } from '@/lib/ipc';

import { formatDate, formatTime } from './helpers';

export function Inspector({
  session,
  messageId,
  onClose,
}: {
  session: DbSessionWithMessages;
  messageId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const sessionStats = useMemo(() => {
    const msgs = session.messages;
    const totalTokens = msgs.reduce(
      (sum, m) => sum + (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0),
      0,
    );
    const toolCallCount = msgs.reduce((sum, m) => sum + m.tool_calls.length, 0);
    const first = msgs[0]?.created_at;
    const last = msgs[msgs.length - 1]?.created_at;
    const durationMs = first && last ? last - first : 0;
    const duration =
      durationMs < 60_000
        ? `${Math.round(durationMs / 1000)}s`
        : `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
    return { totalTokens, toolCallCount, duration };
  }, [session.messages]);

  const msg = session.messages.find((m) => m.id === messageId);
  if (!msg) return null;
  return (
    <aside
      className="flex w-80 flex-none flex-col border-l border-border bg-bg-elev-1"
      data-testid="trajectory-inspector"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-fg">{msg.role}</div>
          <div className="text-[10px] text-fg-subtle">
            {formatDate(msg.created_at)}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('widgets.close')}>
          ×
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
        {sessionStats && (
          <section className="rounded-md border border-border bg-bg-elev-2 px-2 py-2">
            <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {t('trajectory.inspector.session_stats')}
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="text-fg-muted">{t('trajectory.inspector.messages')}</dt>
              <dd className="text-right text-fg">{session.messages.length}</dd>
              <dt className="text-fg-muted">{t('trajectory.inspector.total_tokens')}</dt>
              <dd className="text-right text-fg">{sessionStats.totalTokens.toLocaleString()}</dd>
              <dt className="text-fg-muted">{t('trajectory.inspector.tool_calls')}</dt>
              <dd className="text-right text-fg">{sessionStats.toolCallCount}</dd>
              <dt className="text-fg-muted">{t('trajectory.inspector.duration')}</dt>
              <dd className="text-right text-fg">{sessionStats.duration}</dd>
            </dl>
          </section>
        )}
        {msg.error && (
          <div className="rounded border border-danger/40 bg-danger/5 px-2 py-1 text-danger">
            {msg.error}
          </div>
        )}
        {msg.content && (
          <section>
            <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {t('trajectory.inspector.content')}
            </h3>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-fg">
              {msg.content}
            </pre>
          </section>
        )}
        {(msg.prompt_tokens || msg.completion_tokens) && (
          <section>
            <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {t('trajectory.inspector.tokens')}
            </h3>
            <dl className="grid grid-cols-2 gap-1 text-[11px] text-fg-muted">
              <dt>prompt</dt>
              <dd className="text-right text-fg">{msg.prompt_tokens ?? 0}</dd>
              <dt>completion</dt>
              <dd className="text-right text-fg">{msg.completion_tokens ?? 0}</dd>
            </dl>
          </section>
        )}
        {msg.tool_calls.length > 0 && (
          <section>
            <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              {t('trajectory.inspector.tools')}
            </h3>
            <ul className="flex flex-col gap-1">
              {msg.tool_calls.map((tc) => (
                <li key={tc.id} className="rounded border border-border px-2 py-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-fg">{tc.tool}</code>
                    {tc.emoji && <span>{tc.emoji}</span>}
                  </div>
                  {tc.label && (
                    <p className="mt-0.5 text-[10px] text-fg-subtle">{tc.label}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-fg-subtle">
                    at {formatTime(tc.at)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
