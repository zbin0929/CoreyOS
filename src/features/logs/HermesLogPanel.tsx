import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileSearch, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  hermesLogTail,
  ipcErrorMessage,
  type HermesLogKind,
  type HermesLogTail,
} from '@/lib/ipc';

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: HermesLogTail }
  | { kind: 'error'; message: string };

const DEFAULT_MAX_LINES = 500;

/**
 * Tail one of Hermes's rolling log files. Read-on-demand (no streaming
 * / no `notify` watcher — T2.6 scope) plus a client-side substring
 * filter. Refresh is manual; we auto-fetch on mount and on tab focus
 * change. A line-level filter lives next to Refresh because debugging a
 * specific trace ID is the single most common reason to open this page.
 *
 * When the file doesn't exist — Hermes never ran, or it's a profile that
 * doesn't write to this kind — we render an EmptyState showing the
 * resolved path so the user can double-check their install.
 */
export function HermesLogPanel({ kind }: { kind: HermesLogKind }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [filter, setFilter] = useState('');
  // Keep scroll pinned at the bottom on refresh — it's a tail, after all.
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await hermesLogTail({ kind, maxLines: DEFAULT_MAX_LINES });
      setState({ kind: 'loaded', data });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, [kind]);

  // Fetch on mount + whenever the selected kind changes (tab switch).
  useEffect(() => {
    void load();
  }, [load]);

  // Scroll to bottom after each load so new lines are visible without
  // a manual scroll. `scrollIntoView` on a sentinel would work too but
  // setting scrollTop is cheaper and doesn't trigger smooth-scroll jank.
  useEffect(() => {
    if (state.kind === 'loaded' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state]);

  const filteredLines = useMemo(() => {
    if (state.kind !== 'loaded') return [];
    const q = filter.trim().toLowerCase();
    if (!q) return state.data.lines;
    return state.data.lines.filter((l) => l.toLowerCase().includes(q));
  }, [state, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: path + total-lines meta · filter · refresh. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          {state.kind === 'loaded' && (
            <p
              className="truncate font-mono text-[11px] text-fg-subtle"
              title={state.data.path}
            >
              {t('hermes_logs.tail_meta', {
                shown: filteredLines.length,
                total: state.data.total_lines,
              })}
            </p>
          )}
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('hermes_logs.filter_placeholder')}
          data-testid={`hermes-log-filter-${kind}`}
          className={cn(
            'w-48 rounded-md border border-border bg-bg-elev-1 px-2.5 py-1.5 text-xs text-fg',
            'placeholder:text-fg-subtle',
            'focus:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-500/40',
          )}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={load}
          disabled={state.kind === 'loading'}
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', state.kind === 'loading' && 'animate-spin')}
          />
          {t('logs.refresh')}
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid={`hermes-log-body-${kind}`}
      >
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 px-6 py-4 text-fg-muted">
            <Icon icon={Loader2} size="md" className="animate-spin" />
            {t('logs.refresh')}…
          </div>
        )}

        {state.kind === 'error' && (
          <div className="mx-6 my-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
            <div className="flex-1">
              <div className="font-medium">{t('hermes_logs.error_title')}</div>
              <div className="mt-1 break-all text-xs opacity-80">{state.message}</div>
              <Button className="mt-3" size="sm" variant="secondary" onClick={load}>
                <Icon icon={RefreshCw} size="sm" />
                {t('logs.retry')}
              </Button>
            </div>
          </div>
        )}

        {state.kind === 'loaded' && state.data.missing && (
          <EmptyState
            icon={FileSearch}
            title={t('hermes_logs.missing_title')}
            description={t('hermes_logs.missing_desc', { path: state.data.path })}
            className="mx-auto mt-10 max-w-lg"
          />
        )}

        {state.kind === 'loaded' &&
          !state.data.missing &&
          filteredLines.length === 0 &&
          filter.trim() !== '' && (
            <div className="px-6 py-4 text-xs text-fg-subtle">
              {t('hermes_logs.no_matches', { query: filter })}
            </div>
          )}

        {state.kind === 'loaded' && !state.data.missing && filteredLines.length > 0 && (
          <pre className="m-0 whitespace-pre-wrap break-all bg-bg-elev-2/40 px-6 py-3 font-mono text-[11px] leading-relaxed text-fg">
            {filteredLines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * A single log line. Tints the row amber/red when the line looks like a
 * WARN/ERROR so scanning is easier. We match loosely — any of:
 *   - `[ERROR]` / `[WARN]` (bracketed level)
 *   - ` ERROR ` / ` WARN ` (space-delimited)
 *   - tracing's `ERROR ` / `WARN ` prefix at the start after whitespace
 * so Hermes's Python `logging` format and Rust `tracing` format both
 * tint correctly. False positives on "NoError" etc. would be possible
 * but vanishingly rare in a real log.
 */
function LogLine({ line }: { line: string }) {
  const level = classifyLine(line);
  return (
    <div
      className={cn(
        'block',
        level === 'error' && 'text-danger',
        level === 'warn' && 'text-amber-500',
      )}
    >
      {line || '\u00a0'}
    </div>
  );
}

function classifyLine(line: string): 'error' | 'warn' | 'info' {
  if (/\b(error|critical|fatal)\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
  return 'info';
}
