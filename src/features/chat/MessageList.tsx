import { forwardRef, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageBubble } from './MessageBubble';
import type { UiMessage } from '@/stores/chat';

/**
 * T1.9 — virtualised chat message list.
 *
 * Replaces the previous `messages.map(...)` render with `react-virtuoso`.
 * Virtuoso keeps only the rows inside (and a small overscan around) the
 * viewport mounted, so scroll perf + memory stay flat whether the
 * session has 20 messages or 20,000. `followOutput="smooth"` is the
 * idiomatic substitute for the old `scrollRef.current.scrollTo({top:
 * scrollHeight})` autoscroll pattern — it sticks to the bottom when
 * the user is already there, but stays put once they scroll up to
 * read earlier context (which the old behaviour fought by yanking
 * them back down every token).
 *
 * ### Why not do this when there are <50 messages?
 *
 * We deliberately use Virtuoso unconditionally even for a new
 * session. The alternative ("branch on messages.length > N") adds
 * render churn + a DOM swap the one time you cross the threshold,
 * and Virtuoso's overhead for a short list is genuinely negligible
 * (tested locally: no perceptible first-paint difference vs the
 * array map). One code path is worth more than a micro-optimisation.
 *
 * ### Streaming height updates
 *
 * Virtuoso's internal ResizeObserver picks up row-height changes as
 * each SSE chunk extends the assistant bubble. No manual invalidation
 * needed — the component just works.
 *
 * ### Playwright compatibility
 *
 * The chat e2e (`e2e/chat.spec.ts`) locates bubbles via
 * `page.getByText(..., { exact: false }).first()` and the messages it
 * asserts on are always in the viewport during a fresh send, so the
 * only-renders-visible-rows behaviour doesn't trip the suite.
 */
interface MessageListProps {
  messages: UiMessage[];
  /** Forwarded to `Virtuoso.ref`; exposes `.scrollToIndex(...)` and
   *  the other imperative handles for callers that want to jump to a
   *  specific message (none today, but cheap to forward). */
  /** T-polish — id of the message currently highlighted by the
   *  in-chat search. The matching bubble renders a gold ring so the
   *  user can see exactly which one Virtuoso just scrolled to. */
  activeMatchId?: string | null;
  /** T-polish — invoked when the hover-reveal "regenerate" button on
   *  the last assistant bubble is clicked. MessageList is responsible
   *  only for deciding which bubble shows the button (the terminal
   *  assistant row); the actual stream-replay lives in `ChatPane.retry`. */
  onRetryLastAssistant?: () => void;
}

export const MessageList = forwardRef<VirtuosoHandle, MessageListProps>(
  function MessageList({ messages, activeMatchId, onRetryLastAssistant }, ref) {
    // Precompute the index of the last assistant row once per render
    // pass so the per-row `itemContent` closure doesn't re-scan the
    // array on every scroll event. `-1` when no such row exists.
    const lastAssistantIdx = useMemo(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.role === 'assistant') return i;
      }
      return -1;
    }, [messages]);

    // Memoised so `<Virtuoso itemContent={…}>` keeps the same fn
    // reference across renders; otherwise Virtuoso treats every
    // parent render as a row-renderer change and re-mounts rows.
    const itemContent = useMemo(
      () => (index: number) => {
        const m = messages[index];
        if (!m) return null;
        // Per-row padding lives here, not on a parent flex container,
        // because Virtuoso owns the scroller and positions each row
        // absolutely — outer `gap-4` wouldn't apply to virtualised
        // children.
        return (
          <div className="mx-auto max-w-3xl px-6 pb-4 pt-0 first:pt-6 last:pb-6">
            <MessageBubble
              msg={m}
              highlight={activeMatchId === m.id}
              onRetry={
                index === lastAssistantIdx && onRetryLastAssistant
                  ? onRetryLastAssistant
                  : undefined
              }
            />
          </div>
        );
      },
      [messages, activeMatchId, lastAssistantIdx, onRetryLastAssistant],
    );

    return (
      <Virtuoso
        ref={ref}
        className="min-h-0 flex-1"
        data={messages}
        itemContent={itemContent}
        // Stable row key keyed by the message id — same identity the
        // old `messages.map(m => <MessageBubble key={m.id} .../>)`
        // relied on, so React preserves MessageBubble state (copy-
        // button "Copied!" flash, pending attachment thumbnails)
        // across appends.
        computeItemKey={(_, m) => m.id}
        // Open a session at the LAST message, not the top. Without
        // this Virtuoso mounts at index 0 and the user sees the
        // oldest content on entry, having to manually scroll to the
        // latest reply. `messages.length - 1` clamps to 0 on empty
        // sessions (Virtuoso handles the -1 → no-op gracefully but
        // we'd rather not tempt it). Only applied on initial mount;
        // subsequent appends use `followOutput` for stick-to-bottom.
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        // "Stick to bottom when the user is at bottom; leave them
        // alone otherwise." Matches the old autoscroll-on-every-
        // render behaviour but respects manual scroll-up.
        followOutput="smooth"
        // A short overscan means slightly richer scrolling at the
        // cost of a few extra rendered rows. `200` picked by eyeball:
        // small enough that memory stays flat, big enough that fast
        // flicks don't expose blank rows on the trailing edge.
        increaseViewportBy={{ top: 200, bottom: 400 }}
      />
    );
  },
);
