import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';

const VISIBLE_SESSIONS = 5;

interface Props {
  active: boolean;
  shortcut?: string[];
}

/**
 * Sidebar "hero" block for the assistant.
 *
 * Renders the top-most slab of the sidebar with three layers:
 *   1. The Chat link itself, styled bigger / bolder than a normal
 *      `<NavItem>` so it visually dominates.
 *   2. A `+ New chat` CTA — creates a fresh session via
 *      `useChatStore.newSession()` and routes to `/chat`.
 *   3. The 5 most-recent sessions belonging to the active adapter
 *      (matches `SessionsPanel`'s default scope). Click → switch +
 *      navigate. A footer link reveals the full list inside `/chat`.
 *
 * The recent-sessions list is hidden when no sessions exist yet so
 * first-launch users don't stare at a sad empty box.
 */
export function ChatHeroBlock({ active, shortcut: _shortcut }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const orderedIds = useChatStore((s) => s.orderedIds);
  const sessions = useChatStore((s) => s.sessions);
  const currentId = useChatStore((s) => s.currentId);
  const newSession = useChatStore((s) => s.newSession);
  const switchTo = useChatStore((s) => s.switchTo);

  const adapters = useAgentsStore((s) => s.adapters);
  const activeId = useAgentsStore((s) => s.activeId);
  const activeAdapterId = useMemo<string | null>(() => {
    if (!adapters || adapters.length === 0) return null;
    if (activeId && adapters.some((a) => a.id === activeId)) return activeId;
    return adapters.find((a) => a.is_default)?.id ?? adapters[0]?.id ?? null;
  }, [adapters, activeId]);

  const recentIds = useMemo(() => {
    let ids = orderedIds;
    if (activeAdapterId !== null) {
      ids = ids.filter((id) => sessions[id]?.adapterId === activeAdapterId);
    }
    return ids.slice(0, VISIBLE_SESSIONS);
  }, [orderedIds, sessions, activeAdapterId]);

  const totalCount = orderedIds.length;
  const hiddenCount = Math.max(0, recentIds.length === 0 ? 0 : totalCount - recentIds.length);

  function startNewChat(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    newSession();
    void navigate({ to: '/chat' });
  }

  function openSession(id: string) {
    switchTo(id);
    void navigate({ to: '/chat' });
  }

  return (
    <div
      className={cn(
        'mx-1 mb-3 rounded-xl border bg-bg-elev-1/40 p-1.5 backdrop-blur',
        active
          ? 'border-gold-500/40 shadow-[0_0_24px_hsl(38_90%_56%/0.18)]'
          : 'border-border/60',
      )}
      data-testid="chat-hero-block"
    >
      <Link
        to="/chat"
        className={cn(
          'group relative flex h-10 items-center gap-2.5 rounded-lg px-2.5',
          'text-sm font-semibold transition-all duration-200 ease-enter',
          active
            ? 'bg-gold-500/15 text-fg'
            : 'text-fg hover:bg-[var(--glass-bg-hover)]',
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-500 shadow-[0_0_8px_hsl(38_90%_56%/0.6)]" />
        )}
        <Icon
          icon={MessageSquare}
          size="md"
          className={cn(
            'relative transition-colors',
            active
              ? 'text-gold-500 drop-shadow-[0_0_6px_hsl(38_90%_56%/0.5)]'
              : 'text-gold-500/80 group-hover:text-gold-500',
          )}
        />
        <span className="relative flex-1 truncate">{t('nav.chat')}</span>
        <button
          type="button"
          onClick={startNewChat}
          aria-label={t('chat_page.new_chat', { defaultValue: '新建对话' })}
          title={t('chat_page.new_chat', { defaultValue: '新建对话' })}
          className={cn(
            'relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            'border border-border/60 text-fg-subtle',
            'transition hover:border-gold-500/50 hover:bg-gold-500/15 hover:text-gold-500',
          )}
          data-testid="chat-hero-new"
        >
          <Icon icon={MessageSquarePlus} size="sm" />
        </button>
      </Link>

      {recentIds.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5" data-testid="chat-hero-recent">
          {recentIds.map((id) => {
            const s = sessions[id];
            if (!s) return null;
            const isCurrent = id === currentId && active;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => openSession(id)}
                  title={s.title}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[12px]',
                    'transition-colors',
                    isCurrent
                      ? 'bg-gold-500/10 text-fg'
                      : 'text-fg-muted hover:bg-[var(--glass-bg-hover)] hover:text-fg',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1 w-1 shrink-0 rounded-full',
                      isCurrent ? 'bg-gold-500' : 'bg-fg-subtle/50',
                    )}
                  />
                  <span className="flex-1 truncate">
                    {s.title || t('chat_page.untitled', { defaultValue: '未命名会话' })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(recentIds.length > 0 || hiddenCount > 0) && (
        <Link
          to="/chat"
          className={cn(
            'mt-1 flex items-center justify-between rounded-md px-2.5 py-1 text-[10px] uppercase tracking-wider',
            'text-fg-subtle transition hover:text-fg',
          )}
        >
          <span>{t('chat_hero.view_all', { defaultValue: '全部会话' })}</span>
          {totalCount > 0 && (
            <span className="font-mono normal-case tracking-normal">{totalCount}</span>
          )}
        </Link>
      )}
    </div>
  );
}
