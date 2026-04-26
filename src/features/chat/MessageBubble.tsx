import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import {
  AlertCircle,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useContextMenu } from '@/components/ui/context-menu';
import { useChatStore, type UiMessage, type UiSuggestion } from '@/stores/chat';

import { SuggestionCard } from './SuggestionCard';
import { AttachmentsStrip } from './messageBubble/AttachmentsStrip';
import { CopyButton } from './messageBubble/CopyButton';
import { FeedbackButtons } from './messageBubble/FeedbackButtons';
import { Markdown } from './messageBubble/Markdown';
import { ReasoningPanel } from './messageBubble/ReasoningPanel';
import { RetryButton } from './messageBubble/RetryButton';
import { ToolCallsStrip } from './messageBubble/ToolCallsStrip';

// Re-export for `src/features/compare/index.tsx`, which renders each
// lane's response in the same chrome via this named export.
export { Markdown } from './messageBubble/Markdown';

export function MessageBubble({
  msg,
  highlight = false,
  onRetry,
  onSuggestionConfirm,
  onSuggestionDismiss,
}: {
  msg: UiMessage;
  /** T-polish — renders a gold ring around the bubble when this
   *  message is the active in-chat-search match. Purely visual; the
   *  scroll to the row is owned by `MessageList` + Virtuoso. */
  highlight?: boolean;
  /** T-polish — passed only for the last assistant message. When
   *  present a "regenerate" button is shown alongside Copy; clicking
   *  it replays the preceding user turn and re-streams into this
   *  message's id. Undefined ⇒ hide the button entirely. */
  onRetry?: () => void;
  onSuggestionConfirm?: (sug: UiSuggestion) => Promise<void>;
  onSuggestionDismiss?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = msg.role === 'user';
  const canCopy = !msg.pending && !msg.error && msg.content.length > 0;
  // T6.1 — feedback buttons are offered only on completed, non-error
  // assistant bubbles. User bubbles and in-flight turns have nothing
  // meaningful to rate.
  const canRate = !isUser && canCopy;
  const canRetry = !isUser && !msg.pending && onRetry !== undefined;

  const menuItems = useMemo(() => {
    const items: { label: string; icon: ReactNode; onClick: () => void }[] = [];
    if (canCopy) {
      items.push({
        label: t('chat_page.copy'),
        icon: <Icon icon={Copy} size="xs" />,
        onClick: () => void navigator.clipboard.writeText(msg.content).catch(() => {}),
      });
    }
    if (canRetry) {
      items.push({
        label: t('chat_page.retry'),
        icon: <Icon icon={RefreshCw} size="xs" />,
        onClick: () => onRetry!(),
      });
    }
    if (canRate) {
      const sessionId = useChatStore.getState().currentId;
      items.push(
        {
          label: t('chat_page.feedback_up'),
          icon: <Icon icon={ThumbsUp} size="xs" />,
          onClick: () => {
            if (!sessionId) return;
            useChatStore.getState().setMessageFeedback(sessionId, msg.id, 'up');
          },
        },
        {
          label: t('chat_page.feedback_down'),
          icon: <Icon icon={ThumbsDown} size="xs" />,
          onClick: () => {
            if (!sessionId) return;
            useChatStore.getState().setMessageFeedback(sessionId, msg.id, 'down');
          },
        },
      );
    }
    return items;
  }, [canCopy, canRetry, canRate, msg.content, msg.id, onRetry, t]);

  const onContextMenu = useContextMenu(menuItems);

  return (
    <div
      className={cn(
        'group flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
      onContextMenu={menuItems.length > 0 ? onContextMenu : undefined}
    >
      <div
        className={cn(
          'flex h-8 w-8 flex-none items-center justify-center rounded-full',
          isUser ? 'bg-gold-500/15 text-gold-500' : 'bg-bg-elev-1 text-fg',
        )}
        aria-hidden
      >
        <Icon icon={isUser ? User : Sparkles} size="md" />
      </div>
      {/* `flex-1 min-w-0` is load-bearing: without `flex-1` the column
          shrinks to its children's intrinsic width, and the bubble's
          `max-w-[85%]` then resolves against that shrunk width — a
          circular constraint that collapses the bubble to min-content
          (1 char per line for CJK, since Chinese text has no word
          boundary for `overflow-wrap` to anchor on). Giving the column
          `flex-1` pins it to the full available row width so 85% has a
          stable reference. */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
            // Fixed dark ink for the gold bubble — independent of theme.
            isUser
              ? 'bg-gold-500 text-[hsl(225_30%_10%)]'
              : 'border border-border bg-bg-elev-1 text-fg',
            msg.error && 'border-danger/40 bg-danger/5 text-danger',
            // Active in-chat-search match — ring is theme-independent
            // and doesn't change the border/background chrome the
            // user has learned to associate with user vs assistant.
            highlight &&
              'ring-2 ring-gold-500 ring-offset-2 ring-offset-bg',
          )}
          data-active-search-match={highlight || undefined}
        >
          {highlight && (
            <div className="mb-2 flex justify-end">
              <span
                className="inline-flex items-center rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-gold-600"
                data-testid="chat-search-match-badge"
              >
                {t('chat_page.search_match_badge')}
              </span>
            </div>
          )}
          {/* Reasoning / chain-of-thought panel — shown for
              reasoning-capable models (deepseek-reasoner, o1). Open by
              default WHILE streaming so the user sees progress; the
              user can collapse it any time. Once `msg.content` starts
              arriving we close it by default on subsequent renders so
              the final answer is the focus. */}
          {!isUser && msg.reasoning && msg.reasoning.length > 0 && (
            <ReasoningPanel
              reasoning={msg.reasoning}
              streaming={!!msg.pending || msg.content.length === 0}
            />
          )}
          {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
            <ToolCallsStrip calls={msg.toolCalls} />
          )}
          {isUser && msg.attachments && msg.attachments.length > 0 && (
            <AttachmentsStrip attachments={msg.attachments} />
          )}
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              thinking…
            </span>
          ) : msg.error ? (
            <span className="inline-flex items-start gap-2">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span className="flex-1">{msg.error}</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ml-2 flex-none rounded-md border border-danger/30 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 transition-colors"
                >
                  <Icon icon={RefreshCw} size="xs" className="mr-1" />
                  {t('chat_page.retry')}
                </button>
              )}
            </span>
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : msg.content ? (
            <Markdown>{msg.content}</Markdown>
          ) : null}
        </div>
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="w-full max-w-[85%]">
            {msg.suggestions.map((sug) => (
              <SuggestionCard
                key={sug.id}
                suggestion={sug}
                onConfirm={onSuggestionConfirm ?? (async () => {})}
                onDismiss={onSuggestionDismiss ?? (() => {})}
              />
            ))}
          </div>
        )}
        {(canCopy || canRate || canRetry) && (
          <div className="flex items-center gap-1">
            {canCopy && <CopyButton text={msg.content} />}
            {canRetry && <RetryButton onClick={onRetry!} />}
            {canRate && <FeedbackButtons msg={msg} />}
          </div>
        )}
      </div>
    </div>
  );
}
