import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, History, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  skillVersionGet,
  skillVersionList,
  type SkillVersion,
  type SkillVersionSummary,
} from '@/lib/ipc';

/**
 * v9 — per-skill edit history drawer.
 *
 * Each save of a skill snapshots the PRIOR body into SQLite (see
 * `db.snapshot_skill_version` and `ipc::skills::skill_save`). This
 * drawer lists those snapshots newest-first for the currently
 * selected skill and lets the user preview / restore any of them.
 *
 * Restore is destructive but reversible: it calls the same `skillSave`
 * path with the historical body, which itself captures the current
 * on-disk version as a new snapshot before overwriting. So the user
 * can always get back to "now" via one more history click.
 */
export function SkillHistoryDrawer({
  open,
  path,
  onClose,
  onRestore,
}: {
  open: boolean;
  /** Skill path currently being edited. `null` when no skill is
   *  selected — drawer button is disabled in that case so this
   *  wouldn't fire, but guard anyway. */
  path: string | null;
  onClose: () => void;
  /** Called with the restored body. The parent feeds it through its
   *  normal save flow so the current on-disk version is snapshotted
   *  first (restore remains reversible). */
  onRestore: (body: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SkillVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-row preview state: the full body shown inline when a row is
  // expanded. Lazy-fetched on first expand; cached on the row so
  // re-expanding doesn't re-fire IPC. Keyed by row id.
  const [preview, setPreview] = useState<Record<number, SkillVersion>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setError(null);
    try {
      setRows(await skillVersionList(path));
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRows([]);
    }
  }, [path]);

  // Reload whenever the drawer opens OR the selected skill changes.
  useEffect(() => {
    if (!open) return;
    setExpanded(null);
    setPreview({});
    void load();
  }, [open, path, load]);

  const onExpand = useCallback(
    async (id: number) => {
      if (expanded === id) {
        setExpanded(null);
        return;
      }
      setExpanded(id);
      if (preview[id]) return;
      setLoadingId(id);
      try {
        const v = await skillVersionGet(id);
        if (v) setPreview((prev) => ({ ...prev, [id]: v }));
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        setLoadingId(null);
      }
    },
    [expanded, preview],
  );

  const onRestoreClick = useCallback(
    async (id: number) => {
      let v = preview[id];
      if (!v) {
        setLoadingId(id);
        try {
          const fetched = await skillVersionGet(id);
          if (!fetched) return;
          v = fetched;
          setPreview((prev) => ({ ...prev, [id]: fetched }));
        } catch (e) {
          setError(ipcErrorMessage(e));
          return;
        } finally {
          setLoadingId(null);
        }
      }
      await onRestore(v.body);
      // Close on success so the user sees the editor reflect the
      // restored content immediately. The list will also be stale
      // (one more row) — re-opening triggers a fresh load.
      onClose();
    },
    [preview, onRestore, onClose],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title={t('skills.history_title')}
      testId="skill-history-drawer"
    >
      <div className="flex flex-col gap-2 text-xs">
        <p className="text-fg-muted">
          {t('skills.history_desc')}
        </p>
        {error && (
          <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-danger">
            <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 text-fg-muted">
            <Icon icon={Loader2} size="sm" className="animate-spin" />
            {t('common.loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-bg-elev-1 px-3 py-6 text-center text-fg-subtle">
            <Icon icon={History} size="md" className="mx-auto mb-2 opacity-50" />
            {t('skills.history_empty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="skill-history-list">
            {rows.map((r, i) => (
              <HistoryRow
                key={r.id}
                row={r}
                isNewest={i === 0}
                expanded={expanded === r.id}
                preview={preview[r.id]}
                loading={loadingId === r.id}
                onExpand={() => void onExpand(r.id)}
                onRestore={() => void onRestoreClick(r.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

function HistoryRow({
  row,
  isNewest,
  expanded,
  preview,
  loading,
  onExpand,
  onRestore,
}: {
  row: SkillVersionSummary;
  isNewest: boolean;
  expanded: boolean;
  preview: SkillVersion | undefined;
  loading: boolean;
  onExpand: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const relative = useRelativeTime(row.created_at);
  return (
    <li
      className={cn(
        'rounded border border-border bg-bg-elev-1',
        expanded && 'border-gold-500/40',
      )}
      data-testid={`skill-history-row-${row.id}`}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-fg hover:bg-bg-elev-2"
      >
        <Icon icon={History} size="xs" className="flex-none text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{relative}</span>
            {isNewest && (
              <span className="rounded bg-gold-500/10 px-1 py-0 text-[9px] uppercase tracking-wider text-gold-500">
                {t('skills.history_latest')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-fg-subtle">
            {formatBytes(row.size)} · #{row.id}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2">
          {loading || !preview ? (
            <div className="flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              {t('common.loading')}
            </div>
          ) : (
            <>
              <pre
                className="max-h-48 overflow-auto rounded border border-border bg-bg-elev-2 p-2 font-mono text-[11px] leading-relaxed text-fg"
                data-testid={`skill-history-preview-${row.id}`}
              >
                {preview.body}
              </pre>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onRestore}
                  data-testid={`skill-history-restore-${row.id}`}
                  title={t('skills.history_restore_title')}
                >
                  <Icon icon={RotateCcw} size="xs" />
                  {t('skills.history_restore')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Live relative-time string ("3m ago", "yesterday") that updates
 *  every 30s while the drawer is open. Avoids bringing in a heavy
 *  date-fns dependency for what's ~30 lines of logic. */
function useRelativeTime(ms: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(h);
  }, []);
  return useMemo(() => formatRelative(ms, now), [ms, now]);
}

function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  // Fall back to an absolute locale date for anything older than a week.
  return new Date(ms).toLocaleDateString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
