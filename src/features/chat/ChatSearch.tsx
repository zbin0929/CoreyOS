import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { UiMessage } from '@/stores/chat';
import { computeMatchIndices } from './chatSearchMatch';

/**
 * T-polish — in-session message search ("find-in-chat").
 *
 * Pairs with `SessionsPanel`'s session-level search (added same
 * day): that one finds the right conversation; this one finds the
 * right message within one. Two layers, same mental model.
 *
 * ### Design notes
 *
 * - **Where**: a fixed bar anchored to the top of the chat scroll
 *   area, revealed only while searching. Keeps the message list fully
 *   visible (no shrinking on open) and stays inside the session
 *   viewport so multi-session searches don't survive a session
 *   switch.
 * - **How the bubble is highlighted**: rather than text-level
 *   highlighting (hard to do through Markdown + code blocks + tool
 *   ribbons cleanly), we ring the active match's container. Users
 *   see exactly which bubble matched; `Cmd+F` → arrow keys walks
 *   through them; reading the actual match is the same as reading
 *   the bubble. Good enough for MVP; text-highlight is a follow-up.
 * - **No regex**. Literal substring only. Power-users can copy the
 *   message into an external editor. Most users type 3 letters and
 *   scroll.
 */
export interface ChatSearchProps {
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  /** Current list of messages in render order; used for match
   *  computation. Kept as a prop (rather than reading the store
   *  directly) so the search bar stays reusable in stories / tests. */
  messages: UiMessage[];
  /** 0-indexed active-match position within `matchIndices`. The
   *  parent owns this state so keyboard shortcuts (Cmd+F reopens
   *  with last query; nav arrows) can survive close/reopen. */
  activeMatchIdx: number;
  onActiveMatchChange: (idx: number) => void;
  /** Fires when the parent should scroll the message list to a
   *  specific index. Typically delegates to `VirtuosoHandle.scrollToIndex`. */
  onScrollToIndex: (index: number) => void;
}

export function ChatSearch({
  open,
  query,
  onQueryChange,
  onClose,
  messages,
  activeMatchIdx,
  onActiveMatchChange,
  onScrollToIndex,
}: ChatSearchProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => computeMatchIndices(messages, query),
    [messages, query],
  );

  // Auto-focus on open. The caller re-mounts this with open=true when
  // Cmd+F fires, so focusing on mount covers both first-open and
  // reopen-after-close.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clamp activeMatchIdx when the match list shrinks (e.g. user
  // broadened then narrowed the query). If there are no matches,
  // leave idx=0 so typing a fresh query starts from the top.
  useEffect(() => {
    if (matches.length === 0) {
      if (activeMatchIdx !== 0) onActiveMatchChange(0);
      return;
    }
    if (activeMatchIdx >= matches.length) {
      onActiveMatchChange(matches.length - 1);
    }
  }, [matches.length, activeMatchIdx, onActiveMatchChange]);

  // Scroll-to-match as the active index changes. Also fires on query
  // change because `matches` recomputes and we land on index 0.
  useEffect(() => {
    if (matches.length === 0) return;
    const target = matches[Math.min(activeMatchIdx, matches.length - 1)];
    if (target !== undefined) onScrollToIndex(target);
  }, [matches, activeMatchIdx, onScrollToIndex]);

  function step(delta: 1 | -1) {
    if (matches.length === 0) return;
    const next = (activeMatchIdx + delta + matches.length) % matches.length;
    onActiveMatchChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    }
  }

  if (!open) return null;

  const totalLabel = query.trim()
    ? matches.length === 0
      ? t('chat_page.search_no_match_short')
      : `${activeMatchIdx + 1} / ${matches.length}`
    : '';

  return (
    <div
      className={cn(
        'pointer-events-auto mx-auto mt-3 flex w-full max-w-3xl items-center gap-1 rounded-md',
        'border border-border bg-bg-elev-2 px-2 py-1.5 shadow-1',
      )}
      data-testid="chat-search-bar"
    >
      <Icon icon={Search} size="xs" className="text-fg-subtle" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('chat_page.search_in_chat_placeholder')}
        aria-label={t('chat_page.search_in_chat_placeholder')}
        data-testid="chat-search-input"
        className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
      />
      <span
        className="min-w-[3.5em] flex-none text-right font-mono text-[10px] text-fg-subtle"
        data-testid="chat-search-counter"
      >
        {totalLabel}
      </span>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={matches.length === 0}
        aria-label={t('chat_page.search_prev')}
        className="rounded p-1 text-fg-subtle hover:bg-bg-elev-3 hover:text-fg disabled:opacity-40"
        data-testid="chat-search-prev"
      >
        <Icon icon={ChevronUp} size="xs" />
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={matches.length === 0}
        aria-label={t('chat_page.search_next')}
        className="rounded p-1 text-fg-subtle hover:bg-bg-elev-3 hover:text-fg disabled:opacity-40"
        data-testid="chat-search-next"
      >
        <Icon icon={ChevronDown} size="xs" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('chat_page.search_close')}
        className="rounded p-1 text-fg-subtle hover:bg-bg-elev-3 hover:text-fg"
        data-testid="chat-search-close"
      >
        <Icon icon={X} size="xs" />
      </button>
    </div>
  );
}
