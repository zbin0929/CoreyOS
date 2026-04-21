import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores/chat';

/**
 * Left-side session list inside the Chat feature. Lives *inside* the Chat
 * route; it's not part of the global navigation `Sidebar`.
 */
export function SessionsPanel() {
  const orderedIds = useChatStore((s) => s.orderedIds);
  const sessions = useChatStore((s) => s.sessions);
  const currentId = useChatStore((s) => s.currentId);
  const newSession = useChatStore((s) => s.newSession);
  const switchTo = useChatStore((s) => s.switchTo);
  const deleteSession = useChatStore((s) => s.deleteSession);

  return (
    <aside className="flex h-full w-60 flex-none flex-col border-r border-border bg-bg-elev-1">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Sessions
        </span>
        <button
          onClick={() => newSession()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg transition hover:border-gold-500/40 hover:text-gold-500"
          aria-label="New chat"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {orderedIds.length === 0 ? (
          <p className="px-2 py-4 text-xs text-fg-subtle">
            No sessions yet. Start chatting to create one.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {orderedIds.map((id) => {
              const s = sessions[id];
              if (!s) return null;
              const active = id === currentId;
              return (
                <li key={id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition',
                      active
                        ? 'bg-gold-500/10 text-fg'
                        : 'text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
                    )}
                  >
                    <button
                      onClick={() => switchTo(id)}
                      className="min-w-0 flex-1 truncate text-left"
                      title={s.title}
                    >
                      {s.title}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${s.title}"?`)) deleteSession(id);
                      }}
                      className="invisible flex h-6 w-6 flex-none items-center justify-center rounded text-fg-subtle hover:bg-danger/10 hover:text-danger group-hover:visible"
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
