import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Coins,
  GitBranch,
  Hammer,
  Loader2,
  MessageSquare,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import {
  dbLoadAll,
  ipcErrorMessage,
  type DbMessageWithTools,
  type DbSessionWithMessages,
} from '@/lib/ipc';

/**
 * Phase 4 · T4.3 — Trajectory timeline.
 *
 * Read-only visualization of a persisted session: a vertical timeline
 * with one row per message, tool-call ribbons beneath their turn, and a
 * side inspector that opens on click. Scope kept small:
 *
 * - No D3. The timeline is CSS-driven; durations render as proportional
 *   bars against the session's wall-clock span. D3 would add kilobytes
 *   for a layout we don't need yet.
 * - No replay. The plan hints at stream-style replay; deferred until
 *   someone asks for it. The inspector shows the full captured content,
 *   which covers the "I want to see what actually happened" case.
 * - Data source is the local SQLite store — the same `dbLoadAll` hydrate
 *   path the Chat page uses. Adds no new IPC.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; sessions: DbSessionWithMessages[] }
  | { kind: 'error'; message: string };

export function TrajectoryRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const sessions = await dbLoadAll();
      setState({ kind: 'loaded', sessions });
      if (sessions.length > 0 && !selectedId) {
        setSelectedId(sessions[0]!.id);
      }
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    // Intentionally run once; reload via the Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = useMemo(() => {
    if (state.kind !== 'loaded' || !selectedId) return null;
    return state.sessions.find((s) => s.id === selectedId) ?? null;
  }, [state, selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('trajectory.title')}
        subtitle={t('trajectory.subtitle')}
        actions={
          state.kind === 'loaded' && state.sessions.length > 0 && (
            <SessionPicker
              sessions={state.sessions}
              value={selectedId}
              onChange={(id) => {
                setSelectedId(id);
                setInspectorId(null);
              }}
            />
          )
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 py-6">
            {state.kind === 'loading' && (
              <div className="flex items-center gap-2 text-fg-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}
              </div>
            )}
            {state.kind === 'error' && (
              <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{state.message}</span>
              </div>
            )}
            {state.kind === 'loaded' && state.sessions.length === 0 && (
              <EmptyState
                icon={GitBranch}
                title={t('trajectory.empty_title')}
                description={t('trajectory.empty_desc')}
              />
            )}
            {session && (
              <Timeline
                session={session}
                selectedMessageId={inspectorId}
                onSelect={setInspectorId}
              />
            )}
          </div>
        </div>
        {session && inspectorId && (
          <Inspector
            session={session}
            messageId={inspectorId}
            onClose={() => setInspectorId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Session picker ─────────────────────────

function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: DbSessionWithMessages[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = sessions.find((s) => s.id === value) ?? null;
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((s) => !s)}
        data-testid="trajectory-session-picker"
      >
        <span className="max-w-[220px] truncate">
          {selected ? selected.title : t('trajectory.pick_session')}
        </span>
        <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-md border border-border bg-bg-elev-2 shadow-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-fg hover:bg-bg-elev-3"
              data-testid={`trajectory-session-option-${s.id}`}
            >
              <span className="truncate text-sm text-fg">{s.title}</span>
              <span className="text-[10px] text-fg-subtle">
                {formatDate(s.updated_at)} · {s.messages.length} msg
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Timeline ─────────────────────────

function Timeline({
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
          <MessageSquare className="h-3 w-3" />
          {t('trajectory.totals.messages', { n: totals.messages })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          {t('trajectory.totals.tool_calls', { n: totals.toolCalls })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Coins className="h-3 w-3" />
          {totals.tokens} tok
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
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

            {/* Tool-call ribbons */}
            {row.msg.tool_calls.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 pl-8">
                {row.msg.tool_calls.map((tc) => (
                  <li
                    key={tc.id}
                    className="flex items-center gap-2 rounded border border-border bg-bg-elev-2/60 px-2 py-1 text-[11px] text-fg-muted"
                    data-testid={`trajectory-tool-${tc.id}`}
                  >
                    <Hammer className="h-3 w-3 text-fg-subtle" />
                    <code className="font-mono text-fg">{tc.tool}</code>
                    {tc.label && <span className="truncate">{tc.label}</span>}
                    <span className="ml-auto text-[10px] text-fg-subtle">
                      {formatTime(tc.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────────── Inspector ─────────────────────────

function Inspector({
  session,
  messageId,
  onClose,
}: {
  session: DbSessionWithMessages;
  messageId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          ×
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
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

// ───────────────────────── Helpers ─────────────────────────

interface Row {
  msg: DbMessageWithTools;
  /** Time from this message to the next, in ms. `null` for the last message. */
  durationMs: number | null;
  tokens: number;
}

function computeRows(session: DbSessionWithMessages): Row[] {
  const msgs = session.messages;
  return msgs.map((m, i) => {
    const next = msgs[i + 1];
    const durationMs = next ? Math.max(0, next.created_at - m.created_at) : null;
    const tokens = (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
    return { msg: m, durationMs, tokens };
  });
}

function computeTotals(session: DbSessionWithMessages) {
  let tokens = 0;
  let toolCalls = 0;
  for (const m of session.messages) {
    tokens += (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
    toolCalls += m.tool_calls.length;
  }
  const first = session.messages[0];
  const last = session.messages[session.messages.length - 1];
  const durationMs = first && last ? Math.max(0, last.created_at - first.created_at) : 0;
  return { messages: session.messages.length, toolCalls, tokens, durationMs };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function RoleIcon({ role }: { role: string }) {
  if (role === 'user') {
    return <User className="mt-0.5 h-4 w-4 flex-none text-fg-subtle" />;
  }
  if (role === 'assistant') {
    return <Sparkles className="mt-0.5 h-4 w-4 flex-none text-gold-500" />;
  }
  return <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-fg-subtle" />;
}
