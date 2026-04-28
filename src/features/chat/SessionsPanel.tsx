import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MessageSquarePlus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { GatewaySection } from './GatewaySection';

/**
 * Left-side session list inside the Chat feature. Lives *inside* the Chat
 * route; it's not part of the global navigation `Sidebar`.
 *
 * T5.5c — unified inbox. Sessions now carry `adapterId` and are filtered
 * by a local `scope`:
 *   - `'active'` (default): only show sessions owned by the currently
 *     active adapter (`useAgentsStore.activeId` or registry default).
 *     Matches user intent "show me what's relevant to the chat window
 *     I'm about to type into".
 *   - `'all'`: show sessions from every adapter, with per-row badges.
 *     The only way to see another adapter's history without first
 *     switching to it.
 *
 * Rows render a small adapter badge (`[hermes]` / `[claude]` / `[aider]`)
 * whenever the scope is `'all'` OR the active adapter can't be
 * resolved (first-paint before the registry probe lands).
 */
export function SessionsPanel() {
  const { t } = useTranslation();
  const orderedIds = useChatStore((s) => s.orderedIds);
  const sessions = useChatStore((s) => s.sessions);
  const currentId = useChatStore((s) => s.currentId);
  const newSession = useChatStore((s) => s.newSession);
  const switchTo = useChatStore((s) => s.switchTo);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const adapters = useAgentsStore((s) => s.adapters);
  const activeId = useAgentsStore((s) => s.activeId);
  // Same fallback order the AgentSwitcher + Sidebar use.
  const activeAdapterId = useMemo<string | null>(() => {
    if (!adapters || adapters.length === 0) return null;
    if (activeId && adapters.some((a) => a.id === activeId)) return activeId;
    return adapters.find((a) => a.is_default)?.id ?? adapters[0]?.id ?? null;
  }, [adapters, activeId]);
  const activeAdapterName = adapters?.find((a) => a.id === activeAdapterId)?.name;
  const adapterNameById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const a of adapters ?? []) out[a.id] = a.name;
    return out;
  }, [adapters]);

  const [scope, setScope] = useState<'active' | 'all'>('active');
  // T-polish — title search. Substring, case-insensitive, applied
  // AFTER scope filter so a scoped view can be searched independently.
  // Kept local to this component because the query is a transient
  // view concern, not persisted state.
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredIds = useMemo(() => {
    let ids = orderedIds;
    if (scope !== 'all' && activeAdapterId !== null) {
      ids = ids.filter((id) => sessions[id]?.adapterId === activeAdapterId);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      ids = ids.filter((id) => sessions[id]?.title.toLowerCase().includes(q));
    }
    return ids;
  }, [scope, activeAdapterId, orderedIds, sessions, query]);

  // Per-adapter counts for the scope toggle's hint text.
  const activeCount = useMemo(() => {
    if (activeAdapterId === null) return orderedIds.length;
    return orderedIds.filter((id) => sessions[id]?.adapterId === activeAdapterId)
      .length;
  }, [activeAdapterId, orderedIds, sessions]);
  const totalCount = orderedIds.length;

  return (
    <aside className="flex h-full w-60 flex-none flex-col border-r border-border bg-bg-elev-1">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t('chat_page.sessions')}
        </span>
        <button
          onClick={() => newSession()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg transition hover:border-gold-500/40 hover:text-gold-500"
          aria-label={t('chat_page.new_chat')}
        >
          <Icon icon={MessageSquarePlus} size="sm" />
          {t('chat_page.new')}
        </button>
      </div>

      {/* Scope toggle. Only useful when there's more than one adapter
          AND at least one session belongs to another adapter; otherwise
          it's noise so we hide it. */}
      {adapters && adapters.length > 1 && activeCount !== totalCount && (
        <div
          role="tablist"
          aria-label={t('chat_page.session_scope')}
          className="mx-3 mb-2 inline-flex rounded-md border border-border bg-bg-elev-2 p-0.5 text-[11px]"
          data-testid="sessions-scope"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'active'}
            onClick={() => setScope('active')}
            className={cn(
              'flex-1 rounded px-2 py-0.5 text-center transition-colors',
              scope === 'active'
                ? 'bg-bg-elev-3 text-fg'
                : 'text-fg-subtle hover:text-fg',
            )}
          >
            {activeAdapterName ?? t('chat_page.scope_active')}
            <span className="ml-1 font-mono text-[10px] text-fg-subtle">
              {activeCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'all'}
            onClick={() => setScope('all')}
            className={cn(
              'flex-1 rounded px-2 py-0.5 text-center transition-colors',
              scope === 'all'
                ? 'bg-bg-elev-3 text-fg'
                : 'text-fg-subtle hover:text-fg',
            )}
          >
            All agents
            <span className="ml-1 font-mono text-[10px] text-fg-subtle">
              {totalCount}
            </span>
          </button>
        </div>
      )}

      {/* Search input — hidden when there are no sessions at all so it
          doesn't clutter the fresh-install state. Debouncing isn't
          needed: our filter is pure substring over an in-memory array
          of at most a few hundred titles, so per-keystroke is fine. */}
      {totalCount > 0 && (
        <div className="relative mx-3 mb-2">
          <Icon
            icon={Search}
            size="xs"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat_page.search_placeholder')}
            aria-label={t('chat_page.search_placeholder')}
            data-testid="sessions-search"
            className={cn(
              'w-full rounded-md border border-border bg-bg-elev-2 py-1 pl-7 pr-6 text-xs text-fg',
              'placeholder:text-fg-subtle',
              'focus:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-500/40',
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label={t('chat_page.search_clear')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:bg-bg-elev-3 hover:text-fg"
              data-testid="sessions-search-clear"
            >
              <Icon icon={X} size="xs" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filteredIds.length === 0 ? (
          <p className="px-2 py-4 text-xs text-fg-subtle">
            {query
              ? t('chat_page.search_no_match', { query })
              : scope === 'all' || totalCount === 0
                ? t('chat_page.empty_sessions')
                : t('chat_page.empty_adapter_sessions', { adapter: activeAdapterName ?? '' })}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filteredIds.map((id) => {
              const s = sessions[id];
              if (!s) return null;
              const active = id === currentId;
              // Show badge in "all" mode, or whenever the session's
              // adapter differs from the active one (edge case: user
              // switched adapter mid-scope=active, we still want the
              // outlier to be obvious).
              const showBadge =
                scope === 'all' || s.adapterId !== activeAdapterId;
              return (
                <li key={id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition',
                      active
                        ? 'bg-gold-500/10 text-fg'
                        : 'text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
                    )}
                    data-testid={`session-row-${id}`}
                    data-adapter={s.adapterId}
                  >
                    <button
                      onClick={() => switchTo(id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={`${s.title} \u2014 ${adapterNameById[s.adapterId] ?? s.adapterId}`}
                    >
                      {showBadge && (
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-1 py-0 font-mono text-[9px] uppercase tracking-wider',
                            adapterBadgeClass(s.adapterId),
                          )}
                        >
                          {adapterBadgeLabel(s.adapterId, adapterNameById)}
                        </span>
                      )}
                      <span className="truncate">{s.title}</span>
                    </button>
                    <DeleteButton onConfirm={() => deleteSession(id)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <GatewaySection />
    </aside>
  );
}

/** Per-adapter badge colours. Keeps Hermes on the gold accent (primary
 *  brand colour), Claude Code on cyan (reflects the company's brand), and
 *  Aider on violet. Unknown adapters get a muted neutral. */
function adapterBadgeClass(id: string): string {
  switch (id) {
    case 'hermes':
      return 'border-gold-500/40 bg-gold-500/10 text-gold-500';
    case 'claude_code':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-500';
    case 'aider':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-500';
    default:
      return 'border-border bg-bg-elev-2 text-fg-subtle';
  }
}

/** Short 3-4 char badge label from the adapter name. Falls back to the
 *  id's first token when the registry snapshot hasn't loaded yet. */
function adapterBadgeLabel(id: string, names: Record<string, string>): string {
  const name = names[id];
  if (name) {
    // Take up to 3 chars of the first word. Handles "Hermes Agent" → "Her",
    // "Claude Code" → "Cla", "Aider" → "Aid".
    const first = name.split(/\s+/)[0] ?? name;
    return first.slice(0, 3);
  }
  return id.split('_')[0]?.slice(0, 3) ?? id.slice(0, 3);
}

/**
 * Two-click delete: first click arms (icon becomes a red check for 2s),
 * second click deletes. Native `confirm()` is unreliable in the Tauri
 * webview (needs per-capability permission), so we do it in-app.
 */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function handleClick(e: ReactMouseEvent) {
    e.stopPropagation();
    if (armed) {
      if (timer.current) window.clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = window.setTimeout(() => setArmed(false), 2000);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex h-6 w-6 flex-none items-center justify-center rounded transition',
        armed
          ? 'bg-danger/15 text-danger'
          : 'invisible text-fg-subtle hover:bg-danger/10 hover:text-danger group-hover:visible',
      )}
      aria-label={armed ? t('chat_page.delete_confirm') : t('chat_page.delete')}
      title={armed ? t('chat_page.delete_confirm') : t('chat_page.delete')}
    >
      <Icon icon={armed ? Check : Trash2} size="sm" />
    </button>
  );
}
