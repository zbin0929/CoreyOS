import { useTranslation } from 'react-i18next';
import { Clock, Coins, Columns3, Loader2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Markdown } from '@/features/chat/MessageBubble';

import { formatMs } from './reports';
import type { Lane, LaneState } from './types';

export function LanePanel({ lane, onCancel, isFastest, isFewestTokens }: {
  lane: Lane;
  onCancel: () => void;
  isFastest?: boolean;
  isFewestTokens?: boolean;
}) {
  const { t } = useTranslation();
  const streaming = lane.state.kind === 'streaming';
  const content =
    lane.state.kind === 'done' || lane.state.kind === 'streaming' || lane.state.kind === 'cancelled'
      ? lane.state.content
      : lane.state.kind === 'error'
      ? lane.state.content
      : '';
  const elapsed =
    lane.state.kind === 'done'
      ? lane.state.finishedAt - lane.state.startedAt
      : lane.state.kind === 'streaming'
      ? Date.now() - lane.state.startedAt
      : null;
  const tokens =
    lane.state.kind === 'done'
      ? (lane.state.summary.prompt_tokens ?? 0) +
        (lane.state.summary.completion_tokens ?? 0)
      : null;

  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3"
      data-testid={`compare-lane-${lane.model.id}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">
            {lane.model.display_name ?? lane.model.id}
            {isFastest && (
              <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-500">
                ⚡ {t('compare.fastest')}
              </span>
            )}
            {isFewestTokens && (
              <span className="ml-1.5 inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-500">
                💰 {t('compare.fewest_tokens')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-fg-subtle">{lane.model.provider}</div>
        </div>
        <div className="flex items-center gap-1">
          {streaming && (
            <>
              <Icon icon={Loader2} size="sm" className="animate-spin text-fg-muted" />
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                data-testid={`compare-lane-cancel-${lane.model.id}`}
                title={t('compare.cancel_lane')}
              >
                <Icon icon={Square} size="xs" fill="currentColor" />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-[80px] text-sm text-fg">
        {content ? (
          <Markdown>{content}</Markdown>
        ) : streaming ? (
          <span className="text-fg-subtle">{t('compare.waiting')}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </div>

      {/* Footer: per-lane stats. Hidden for `idle`; always rendered for
          terminal states so layouts don't jiggle when one lane
          finishes before another. */}
      {lane.state.kind !== 'idle' && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-fg-subtle">
          {elapsed !== null && (
            <span className="inline-flex items-center gap-1" data-testid={`compare-lane-latency-${lane.model.id}`}>
              <Icon icon={Clock} size="xs" />
              {formatMs(elapsed)}
            </span>
          )}
          {tokens !== null && tokens > 0 && (
            <span className="inline-flex items-center gap-1" data-testid={`compare-lane-tokens-${lane.model.id}`}>
              <Icon icon={Coins} size="xs" />
              {tokens} tok
            </span>
          )}
          {lane.state.kind === 'done' && lane.state.summary.finish_reason && (
            <span className="inline-flex rounded border border-border px-1 text-[10px] uppercase tracking-wider">
              {lane.state.summary.finish_reason}
            </span>
          )}
          {lane.state.kind === 'cancelled' && (
            <span className="text-warning" data-testid={`compare-lane-cancelled-${lane.model.id}`}>
              {t('compare.cancelled')}
            </span>
          )}
          {lane.state.kind === 'error' && (
            <span className="text-danger" data-testid={`compare-lane-error-${lane.model.id}`}>
              {lane.state.message}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

export function DiffFooter({ lanes }: { lanes: Lane[] }) {
  const { t } = useTranslation();
  const done = lanes.filter(
    (l): l is Lane & { state: Extract<LaneState, { kind: 'done' }> } =>
      l.state.kind === 'done',
  );
  if (done.length < 2) return null;
  const fastest = done.reduce((a, b) =>
    b.state.finishedAt - b.state.startedAt < a.state.finishedAt - a.state.startedAt ? b : a,
  );
  const mostTokens = done.reduce((a, b) =>
    ((b.state.summary.prompt_tokens ?? 0) + (b.state.summary.completion_tokens ?? 0)) >
    ((a.state.summary.prompt_tokens ?? 0) + (a.state.summary.completion_tokens ?? 0))
      ? b
      : a,
  );

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-[11px] text-fg-muted"
      data-testid="compare-diff-footer"
    >
      <span className="font-medium text-fg">{t('compare.winners')}</span>
      <span className="inline-flex items-center gap-1" data-testid="compare-winner-latency">
        <Icon icon={Clock} size="xs" />
        {t('compare.fastest')}:{' '}
        <code className="text-fg">{fastest.model.display_name ?? fastest.model.id}</code>
        <span className="text-fg-subtle">
          ({formatMs(fastest.state.finishedAt - fastest.state.startedAt)})
        </span>
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Coins} size="xs" />
        {t('compare.most_tokens')}:{' '}
        <code className="text-fg">{mostTokens.model.display_name ?? mostTokens.model.id}</code>
      </span>
    </div>
  );
}

export function EmptyPrompt() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-fg-muted">
      <Icon icon={Columns3} size={32} className="text-fg-subtle" />
      <div className="text-sm font-medium text-fg">{t('compare.empty_title')}</div>
      <div className="max-w-md text-xs">{t('compare.empty_desc')}</div>
    </div>
  );
}
