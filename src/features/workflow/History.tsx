import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  workflowHistoryList,
  workflowRunDelete,
  workflowRunGet,
  type WorkflowRunResult,
  type WorkflowRunSummary,
} from '@/lib/ipc';

/**
 * Workflow run history page.
 *
 * Reads from the v12 SQLite tables via `workflow_history_list` and
 * shows a flat MRU list of every run (active + terminal). Each row
 * has:
 *   - status pill (matches the run view's color scheme)
 *   - workflow id (the human label lives in `workflows/list` —
 *     fetching it for every history row is wasteful, so we just
 *     show the id, which is what the YAML / file name uses)
 *   - timestamps + per-step counters
 *   - quick delete (CASCADEs to step rows via FK)
 *
 * Clicking a row opens a side panel with the full step-by-step
 * audit trail (status + duration + JSON output per step). This is
 * read-only — there's no "re-run" affordance because re-running an
 * already-terminal run with new state would break the audit guarantee.
 */
export function WorkflowHistoryRoute({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<WorkflowRunSummary[] | null>(null);
  const [selected, setSelected] = useState<WorkflowRunResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const list = await workflowHistoryList(undefined, 200);
      setRows(list);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (runId: string) => {
    setSelectedId(runId);
    setLoadingDetail(true);
    try {
      const r = await workflowRunGet(runId);
      setSelected(r);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setSelectedId(null);
  };

  const handleDelete = async (runId: string, e: React.MouseEvent) => {
    // Stop the parent row's onClick from also firing (would open
    // detail panel for a row we're about to nuke).
    e.stopPropagation();
    if (
      !window.confirm(
        t('workflow_page.history_delete_confirm', {
          defaultValue: '确认删除这条运行记录？此操作不可撤销。',
        }),
      )
    ) {
      return;
    }
    try {
      await workflowRunDelete(runId);
      if (selectedId === runId) closeDetail();
      await load();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('workflow_page.history_title', { defaultValue: '运行历史' })}
        subtitle={t('workflow_page.history_subtitle', {
          defaultValue: '审计已结束 / 进行中 / 暂停的所有工作流运行',
        })}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <Icon
                icon={RefreshCw}
                size="xs"
                className={cn(refreshing && 'animate-spin')}
              />
              {t('workflow_page.refresh', { defaultValue: '刷新' })}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              {t('workflow_page.back')}
            </Button>
          </div>
        }
      />
      <div className="flex flex-1 min-h-0">
        {/* Left: list. Always shown. */}
        <div className={cn('flex-1 overflow-y-auto p-6', selected && 'border-r border-border')}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}
          {rows === null ? (
            <div className="flex items-center gap-2 text-fg-subtle">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              <span>{t('workflow_page.loading')}</span>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={t('workflow_page.history_empty_title', {
                defaultValue: '暂无运行历史',
              })}
              description={t('workflow_page.history_empty_desc', {
                defaultValue: '运行任意工作流后，这里会保留可审计的完整轨迹。',
              })}
            />
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void openDetail(r.id)}
                  className={cn(
                    'flex w-full flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                    selectedId === r.id
                      ? 'border-gold-500/40 bg-gold-500/5'
                      : 'border-border bg-bg-elev-1 hover:border-gold-500/20',
                  )}
                >
                  <Icon
                    icon={statusIcon(r.status)}
                    size="sm"
                    className={cn(statusColor(r.status))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg truncate">
                      {r.workflow_id}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      {formatTime(r.started_at)} ·{' '}
                      {r.completed_count}/{r.step_count}{' '}
                      {t('workflow_page.history_steps_label', { defaultValue: '步骤已完成' })}
                      {r.failed_count > 0 && (
                        <span className="ml-1 text-red-500">
                          · {r.failed_count} {t('workflow_page.history_failed', { defaultValue: '失败' })}
                        </span>
                      )}
                    </div>
                    {r.error && (
                      <div className="mt-1 truncate text-xs text-red-500" title={r.error}>
                        {r.error}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px]',
                      statusBadgeBg(r.status),
                    )}
                  >
                    {t(`workflow_page.status_${r.status}`, { defaultValue: r.status })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => void handleDelete(r.id, e)}
                    aria-label="delete run"
                  >
                    <Icon icon={Trash2} size="xs" className="text-red-500" />
                  </Button>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel. Only shown when a row is selected. */}
        {selected && (
          <div className="w-[28rem] shrink-0 overflow-y-auto bg-bg-elev-1 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-fg">
                  {selected.workflow_id}
                </h3>
                <p className="mt-0.5 text-[11px] text-fg-subtle break-all font-mono">
                  {selected.id}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                <Icon icon={XCircle} size="xs" />
              </Button>
            </div>

            {/* Export row. Two buttons because audit consumers
                fall into two camps: ops people want a Markdown
                they can paste into a ticket, security/compliance
                want a JSON they can diff or feed downstream. The
                full run is in scope (header + every step's output)
                — there's no "summarized" export, since the whole
                point of this view is the audit trail. */}
            {!loadingDetail && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportRunAsJson(selected)}
                  title={t('workflow_page.history_export_json_hint', {
                    defaultValue: '完整原始数据，便于程序化处理',
                  })}
                >
                  <Icon icon={Download} size="xs" />
                  {t('workflow_page.history_export_json', { defaultValue: '导出 JSON' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportRunAsMarkdown(selected)}
                  title={t('workflow_page.history_export_md_hint', {
                    defaultValue: '人类可读，便于贴到工单或邮件',
                  })}
                >
                  <Icon icon={FileText} size="xs" />
                  {t('workflow_page.history_export_md', { defaultValue: '导出 Markdown' })}
                </Button>
              </div>
            )}

            {loadingDetail ? (
              <div className="mt-6 flex items-center gap-2 text-fg-subtle">
                <Icon icon={Loader2} size="md" className="animate-spin" />
                <span>{t('workflow_page.loading')}</span>
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                      statusBadgeBg(selected.status),
                    )}
                  >
                    <Icon icon={statusIcon(selected.status)} size="xs" />
                    {t(`workflow_page.status_${selected.status}`, {
                      defaultValue: selected.status,
                    })}
                  </span>
                </div>
                {selected.error && (
                  <p className="mt-2 break-all rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-500">
                    {selected.error}
                  </p>
                )}

                {/* Inputs (collapsed by default; users rarely care
                    once a run is over but the audit value is real). */}
                {Object.keys(selected.inputs ?? {}).length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium text-fg-subtle hover:text-fg">
                      {t('workflow_page.history_inputs', { defaultValue: '运行参数' })}
                    </summary>
                    <pre className="mt-1 overflow-auto rounded bg-bg-elev-2 p-2 text-[11px] text-fg-subtle">
                      {JSON.stringify(selected.inputs, null, 2)}
                    </pre>
                  </details>
                )}

                <div className="mt-5 space-y-2">
                  {Object.values(selected.step_runs).map((sr) => (
                    <div
                      key={sr.step_id}
                      className="rounded-md border border-border bg-bg-elev-2/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          icon={statusIcon(sr.status)}
                          size="xs"
                          className={cn(statusColor(sr.status))}
                        />
                        <span className="text-sm font-medium text-fg">
                          {sr.step_id}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px]',
                            statusBadgeBg(sr.status),
                          )}
                        >
                          {t(`workflow_page.status_${sr.status}`, {
                            defaultValue: sr.status,
                          })}
                        </span>
                        {sr.duration_ms != null && (
                          <span className="ml-auto text-[11px] tabular-nums text-fg-subtle">
                            {sr.duration_ms >= 1000
                              ? `${(sr.duration_ms / 1000).toFixed(1)}s`
                              : `${sr.duration_ms}ms`}
                          </span>
                        )}
                      </div>
                      {sr.error && (
                        <p className="mt-1 break-all text-[11px] text-red-500">
                          {sr.error}
                        </p>
                      )}
                      {sr.output && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] text-fg-subtle hover:text-fg">
                            {t('workflow_page.step_output')}
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-bg-elev-1 p-2 text-[10.5px] leading-snug text-fg-subtle">
                            {JSON.stringify(sr.output, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return CheckCircle2;
    case 'failed':
    case 'cancelled':
      return XCircle;
    case 'running':
      return Loader2;
    default:
      return Clock;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-500';
    case 'failed':
    case 'cancelled':
      return 'text-red-500';
    case 'running':
      return 'text-blue-500 animate-spin';
    case 'paused':
    case 'awaiting_approval':
      return 'text-amber-500';
    default:
      return 'text-fg-subtle';
  }
}

function statusBadgeBg(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500/10 text-green-500';
    case 'failed':
    case 'cancelled':
      return 'bg-red-500/10 text-red-500';
    case 'running':
      return 'bg-blue-500/10 text-blue-500';
    case 'paused':
    case 'awaiting_approval':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    default:
      return 'bg-bg-elev-2 text-fg-subtle';
  }
}

/**
 * Trigger a browser file download with given content, filename, and
 * MIME. We use the synthesized-anchor-click pattern (rather than
 * Tauri's `dialog.save` IPC) because:
 *   1. it's stateless — no extra IPC handler to register;
 *   2. we don't need to write to a Corey-controlled directory;
 *   3. WebView2 / WKWebView both honor the `download` attribute and
 *      drop the file in the user's normal Downloads folder.
 */
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Browsers fire `click` synchronously and queue the download
  // immediately; we can revoke the URL on the next tick without
  // racing the actual download stream.
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/** JSON export — full WorkflowRunResult verbatim. Pretty-printed
 *  with 2-space indent so a `git diff` between two run exports is
 *  human-readable for compliance review. */
function exportRunAsJson(run: WorkflowRunResult) {
  const payload = JSON.stringify(run, null, 2);
  const fname = `${run.workflow_id}-${run.id.slice(0, 8)}.json`;
  downloadBlob(payload, fname, 'application/json');
}

/**
 * Markdown export — human-readable audit trail.
 *
 * Layout:
 *   # <workflow_id>
 *   - Run id, status, started, error (if any)
 *   ## Inputs
 *   ...JSON code block...
 *   ## Steps
 *   ### <step_id> (status, duration)
 *   <error>
 *   <output> (JSON code block)
 *
 * Output blobs are inlined as fenced JSON blocks because the agent
 * step's `text` field is itself usually JSON; keeping it inside a
 * fence prevents accidental Markdown interpretation of curly braces.
 */
function exportRunAsMarkdown(run: WorkflowRunResult) {
  const lines: string[] = [];
  lines.push(`# ${run.workflow_id}`);
  lines.push('');
  lines.push(`- **Run id**: \`${run.id}\``);
  lines.push(`- **Status**: ${run.status}`);
  if (run.error) {
    lines.push(`- **Error**: ${run.error}`);
  }
  lines.push('');

  if (Object.keys(run.inputs ?? {}).length > 0) {
    lines.push('## Inputs');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(run.inputs, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const sr of Object.values(run.step_runs)) {
    const dur =
      sr.duration_ms != null
        ? sr.duration_ms >= 1000
          ? ` · ${(sr.duration_ms / 1000).toFixed(1)}s`
          : ` · ${sr.duration_ms}ms`
        : '';
    lines.push(`### ${sr.step_id} (${sr.status}${dur})`);
    lines.push('');
    if (sr.error) {
      lines.push(`> Error: ${sr.error}`);
      lines.push('');
    }
    if (sr.output !== undefined && sr.output !== null) {
      lines.push('```json');
      lines.push(JSON.stringify(sr.output, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  const fname = `${run.workflow_id}-${run.id.slice(0, 8)}.md`;
  downloadBlob(lines.join('\n'), fname, 'text/markdown');
}

/**
 * Format a millisecond epoch as `M-D HH:mm` for compact list rows.
 * Year is omitted for current-year timestamps to save space; an old
 * row from a prior year shows the year explicitly so it can't be
 * mistaken for "today".
 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameYear ? `${m}-${day} ${hh}:${mm}` : `${d.getFullYear()}-${m}-${day} ${hh}:${mm}`;
}
