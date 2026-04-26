import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Coins, MessageSquare, Wrench } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { DbSessionWithMessages } from '@/lib/ipc';

import { RoleIcon } from './RoleIcon';
import { ToolCallTree } from './ToolCallTree';
import {
  computeRows,
  computeTotals,
  formatMs,
  formatTime,
} from './helpers';

export function Timeline({
  session,
  selectedMessageId,
  onSelect,
}: {
  session: DbSessionWithMessages;
  selectedMessageId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => computeRows(session), [session]);
  const totals = useMemo(() => computeTotals(session), [session]);

  if (session.messages.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={t('trajectory.session_empty_title')}
        description={t('trajectory.session_empty_desc')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="trajectory-timeline">
      {/* Session header — totals strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <Icon icon={MessageSquare} size="xs" />
          {t('trajectory.totals.messages', { n: totals.messages })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon icon={Wrench} size="xs" />
          {t('trajectory.totals.tool_calls', { n: totals.toolCalls })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon icon={Coins} size="xs" />
          {totals.tokens} tok
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon icon={Clock} size="xs" />
          {formatMs(totals.durationMs)}
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.msg.id}
            data-testid={`trajectory-row-${row.msg.id}`}
            onClick={() => onSelect(row.msg.id)}
          >
            <div
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border bg-bg-elev-1 px-3 py-2 transition-colors',
                'hover:border-gold-500/40',
                selectedMessageId === row.msg.id ? 'border-gold-500/60' : 'border-border',
              )}
            >
              <RoleIcon role={row.msg.role} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg">
                    {row.msg.role}
                  </span>
                  <span className="text-[10px] text-fg-subtle">
                    {formatTime(row.msg.created_at)}
                  </span>
                </div>
                {row.msg.content && (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-muted">
                    {row.msg.content}
                  </p>
                )}
                {/* Token + duration pills */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-subtle">
                  {row.tokens > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Coins className="h-2.5 w-2.5" /> {row.tokens} tok
                    </span>
                  )}
                  {row.durationMs !== null && (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {formatMs(row.durationMs)}
                    </span>
                  )}
                </div>

                {/* Duration bar */}
                {row.durationMs !== null && totals.durationMs > 0 && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-elev-3">
                    <div
                      className="h-full bg-gold-500/60"
                      style={{
                        width: `${Math.max(2, (row.durationMs / totals.durationMs) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Tool-call ribbons. T6.3 — when a delegate_task is in
                the list, render a nested tree grouping the subagent's
                tool calls under the parent; otherwise keep the flat
                look. */}
            {row.msg.tool_calls.length > 0 && (
              <ToolCallTree calls={row.msg.tool_calls} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
