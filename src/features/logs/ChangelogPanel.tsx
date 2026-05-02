import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  changelogList,
  changelogRevert,
  ipcErrorMessage,
  type ChangelogEntry,
} from '@/lib/ipc';

/**
 * Config changelog viewer.
 *
 * Reads `~/Library/Application Support/com.caduceus.app/changelog.jsonl`
 * newest-first. For each entry the row shows:
 *   - local time + op label
 *   - the server-side one-line summary
 *   - a Revert button for revertible ops (currently `hermes.config.model`)
 *   - a "Not revertible" pill for the rest, with a tooltip explaining why
 *
 * Reverts append a new entry describing themselves, so the list updates by
 * prepending the new entry returned from `changelogRevert` — no full reload
 * needed, and the user can re-revert by clicking the newest row.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; entries: ChangelogEntry[] }
  | { kind: 'error'; message: string };

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'reverting' }
  | { kind: 'ok' }
  | { kind: 'err'; message: string };

/**
 * Changelog tab body. Factored out of the old single-route LogsRoute when
 * the Logs page gained Agent/Gateway/Error tabs in T2.6. The refresh
 * button used to live in the route PageHeader; it now renders inline at
 * the top of the panel so each tab owns its own chrome.
 */
export function ChangelogPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** Per-row status, keyed by entry id. We don't clear old ids (they
   *  may still be visible after a revert prepended new entries). */
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const entries = await changelogList();
      setState({ kind: 'loaded', entries });
    } catch (e) {
      setState({ kind: 'error', message: ipcErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRevert(entry: ChangelogEntry) {
    setRowStatus((m) => ({ ...m, [entry.id]: { kind: 'reverting' } }));
    try {
      const { revert_entry } = await changelogRevert(entry.id);
      setRowStatus((m) => ({ ...m, [entry.id]: { kind: 'ok' } }));
      // Prepend the revert entry without round-tripping the whole list.
      setState((s) =>
        s.kind === 'loaded'
          ? { kind: 'loaded', entries: [revert_entry, ...s.entries] }
          : s,
      );
    } catch (e) {
      setRowStatus((m) => ({
        ...m,
        [entry.id]: { kind: 'err', message: ipcErrorMessage(e) },
      }));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Panel-local toolbar: subtitle + refresh. The page-level header is
          owned by the LogsRoute shell so the tabs can stay visible. */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <p className="text-xs text-fg-muted">{t('logs.subtitle')}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={load}
          disabled={state.kind === 'loading'}
          title={t('logs.refresh')}
        >
          <Icon
            icon={RefreshCw}
            size="sm"
            className={cn(state.kind === 'loading' && 'animate-spin')}
          />
          {t('logs.refresh')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              {t('logs.refresh')}…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <div className="flex-1">
                <div className="font-medium">{t('logs.error_title')}</div>
                <div className="mt-1 break-all text-xs opacity-80">{state.message}</div>
                <Button className="mt-3" size="sm" variant="secondary" onClick={load}>
                  <Icon icon={RefreshCw} size="sm" />
                  {t('logs.retry')}
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'loaded' && state.entries.length === 0 && (
            <EmptyState
              icon={ScrollText}
              title={t('logs.empty_title')}
              description={t('logs.empty_desc')}
              className="mx-auto mt-10 max-w-lg"
            />
          )}

          {state.kind === 'loaded' &&
            state.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                status={rowStatus[entry.id] ?? { kind: 'idle' }}
                onRevert={() => onRevert(entry)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Row ─────────────────────────

function EntryRow({
  entry,
  status,
  onRevert,
}: {
  entry: ChangelogEntry;
  status: RowStatus;
  onRevert: () => void;
}) {
  const { t, i18n } = useTranslation();
  const opLabel = i18n.exists(`logs.op.${entry.op}`) ? t(`logs.op.${entry.op}`) : entry.op;
  const revertible = entry.op === 'hermes.config.model';
  const envNote = entry.op === 'hermes.env.key';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-bg-elev-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
              {opLabel}
            </span>
            <span className="font-mono text-[11px] text-fg-subtle">
              {formatTime(entry.ts)}
            </span>
          </div>
          <p className="mt-1.5 break-words text-sm text-fg">{entry.summary}</p>
        </div>

        <div className="flex flex-none flex-col items-end gap-1">
          {revertible ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRevert}
              disabled={status.kind === 'reverting' || status.kind === 'ok'}
              title={t('logs.revert')}
            >
              {status.kind === 'reverting' ? (
                <Icon icon={Loader2} size="sm" className="animate-spin" />
              ) : status.kind === 'ok' ? (
                <Icon icon={CheckCircle2} size="sm" className="text-emerald-500" />
              ) : (
                <Icon icon={RotateCcw} size="sm" />
              )}
              {status.kind === 'reverting'
                ? t('logs.reverting')
                : status.kind === 'ok'
                  ? t('logs.reverted')
                  : t('logs.revert')}
            </Button>
          ) : (
            <span
              className="rounded-full border border-border bg-bg-elev-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle"
              title={envNote ? t('logs.not_revertible_env') : undefined}
            >
              {t('logs.not_revertible')}
            </span>
          )}
          {status.kind === 'err' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-danger">
              <Icon icon={AlertCircle} size="xs" />
              {status.message}
            </span>
          )}
        </div>
      </div>

      {/* Before/After diff — only when present AND non-null (creation entries
          have no before; deletions have no after). Keep it compact, two cols. */}
      {(entry.before !== undefined && entry.before !== null) ||
      (entry.after !== undefined && entry.after !== null) ? (
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          <DiffBlock label={t('logs.diff.before')} value={entry.before} />
          <DiffBlock label={t('logs.diff.after')} value={entry.after} />
        </div>
      ) : null}
    </div>
  );
}

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border bg-bg-elev-2/60 p-2">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</span>
      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-fg-muted">
        {value === undefined || value === null ? '—' : stringifyCompact(value)}
      </pre>
    </div>
  );
}

/** Compact JSON — drops trailing whitespace between keys but keeps newlines
 *  at the top level so small objects still read naturally. */
function stringifyCompact(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Local time HH:MM:SS on today, else full date. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
}
