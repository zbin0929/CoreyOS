import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  workflowList,
  workflowDelete,
  workflowRun,
  workflowRunStatus,
  workflowActiveRuns,
  workflowApprove,
  type WorkflowDef,
  type WorkflowSummary,
  type WorkflowRunResult,
} from '@/lib/ipc';
import { Sparkles } from 'lucide-react';
import { WorkflowEditor } from './Editor';
import { WorkflowGenerateDialog } from './GenerateDialog';

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; wfId: string | null; seed?: WorkflowDef }
  | { kind: 'run'; wf: WorkflowSummary };

export function WorkflowRoute() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Conversational-generation drawer toggle. Lives at the page
  // level (not inside the action bar) so the drawer can stay
  // mounted across mode transitions if we ever want to preserve a
  // half-typed prompt across "Back" presses.
  const [generateOpen, setGenerateOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await workflowList();
      setRows(list);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const active = await workflowActiveRuns();
        if (active.length > 0) {
          const run = active[0]!;
          const wf = rows?.find((w) => w.id === run.workflow_id);
          if (wf) {
            setMode({ kind: 'run', wf });
            setRunning(true);
            setRunResult(run);
            runIdRef.current = run.id;
            void pollRunStatus(run.id);
          }
        }
      } catch { /* ignore */ }
    })();
  }, [rows]);

  const handleDelete = async (id: string) => {
    try {
      await workflowDelete(id);
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await Promise.all([...selected].map((id) => workflowDelete(id)));
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const handleRun = async (wf: WorkflowSummary) => {
    setRunning(true);
    setRunResult(null);
    setMode({ kind: 'run', wf });
    try {
      const runId = await workflowRun(wf.id, {});
      runIdRef.current = runId;
      void pollRunStatus(runId);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRunning(false);
    }
  };

  const runIdRef = useRef<string>('');

  const pollRunStatus = async (runId: string) => {
    const poll = async () => {
      try {
        const result = await workflowRunStatus(runId);
        if (result) {
          setRunResult(result);
          if (result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
            setRunning(false);
            return;
          }
        }
      } catch { /* retry */ }
      setTimeout(poll, 1500);
    };
    poll();
  };

  const handleApprove = async (stepId: string, approved: boolean) => {
    if (!runIdRef.current) return;
    try {
      await workflowApprove(runIdRef.current, stepId, approved);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  if (mode.kind === 'edit') {
    return (
      <WorkflowEditor
        workflowId={mode.wfId}
        seed={mode.seed}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'run' && mode.wf) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader
          title={mode.wf.name}
          subtitle={running ? t('workflow_page.running') : t('workflow_page.run_result')}
          actions={
            <Button variant="ghost" onClick={() => { setMode({ kind: 'list' }); setRunResult(null); }}>
              {t('workflow_page.back')}
            </Button>
          }
        />
        <div className="flex-1 overflow-y-auto p-6">
          {running && runResult?.status !== 'paused' && (
            <div className="flex items-center gap-3 text-fg-subtle">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              <span>{t('workflow_page.executing')}</span>
            </div>
          )}
          {/* Distinct banner when the run is parked on a human
              decision: not spinning (nothing's running on the
              backend), but not "done" either. The Approve / Reject
              buttons live inside the step card below. */}
          {runResult?.status === 'paused' && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <Icon icon={Clock} size="md" />
              <span>{t('workflow_page.paused_awaiting_approval')}</span>
            </div>
          )}
          {runResult && (
            <div className="space-y-3">
              <div className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium',
                runResult.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                runResult.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                'bg-yellow-500/10 text-yellow-500',
              )}>
                <Icon icon={runResult.status === 'completed' ? CheckCircle2 : runResult.status === 'failed' ? XCircle : Clock} size="xs" />
                {runResult.status}
              </div>
              {runResult.error && (
                <p className="text-sm text-red-500">{runResult.error}</p>
              )}
              {(() => {
                const runs = Object.values(runResult.step_runs);
                const total = runs.length;
                const done = runs.filter((s) => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped').length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elev-2">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          runResult.status === 'failed' ? 'bg-red-500' : 'bg-gold-500',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-fg-subtle">{done}/{total} ({pct}%)</span>
                  </div>
                );
              })()}
              <div className="space-y-2">
                {Object.values(runResult.step_runs).map((sr) => (
                  <div
                    key={sr.step_id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3',
                      sr.status === 'completed' && 'bg-green-500/5',
                      sr.status === 'running' && 'bg-blue-500/5',
                      sr.status === 'failed' && 'bg-red-500/5',
                      sr.status === 'pending' && 'bg-bg-elev-1',
                      // Highlight the row that's blocking on the human.
                      // Amber rather than red — it's not a failure, just
                      // a pending decision.
                      sr.status === 'awaiting_approval' &&
                        'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30',
                    )}
                  >
                    <Icon
                      icon={
                        sr.status === 'completed'
                          ? CheckCircle2
                          : sr.status === 'failed'
                          ? XCircle
                          : sr.status === 'running'
                          ? Loader2
                          : Clock
                      }
                      size="sm"
                      className={cn(
                        sr.status === 'completed' && 'text-green-500',
                        sr.status === 'failed' && 'text-red-500',
                        sr.status === 'running' && 'text-blue-500 animate-spin',
                        sr.status === 'pending' && 'text-fg-subtle',
                        sr.status === 'awaiting_approval' && 'text-amber-500',
                      )}
                    />
                    <span className="text-sm font-medium text-fg">{sr.step_id}</span>
                    <span className="text-xs text-fg-subtle">{sr.status}</span>
                    {sr.duration_ms != null && (
                      <span className="text-xs text-fg-subtle">
                        {sr.duration_ms >= 1000
                          ? `${(sr.duration_ms / 1000).toFixed(1)}s`
                          : `${sr.duration_ms}ms`}
                      </span>
                    )}
                    {sr.error && (
                      <span className="ml-auto text-xs text-red-500" title={sr.error}>
                        {sr.error.length > 80 ? sr.error.slice(0, 80) + '…' : sr.error}
                      </span>
                    )}
                    {sr.output && (
                      <details className="ml-auto">
                        <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg">
                          {t('workflow_page.step_output')}
                        </summary>
                        <pre className="mt-1 max-w-sm overflow-auto rounded bg-bg-elev-2 p-2 text-xs text-fg-subtle">
                          {JSON.stringify(sr.output, null, 2).slice(0, 500)}
                        </pre>
                      </details>
                    )}
                    {sr.status === 'awaiting_approval' && (
                      <>
                        {/* Full-width approval prompt + actions.
                            Renders below the status row inside the
                            same card so the message stays anchored
                            to the step it gates. */}
                        <div className="basis-full" />
                        {typeof sr.output === 'object' &&
                          sr.output !== null &&
                          'message' in sr.output && (
                            <pre className="w-full whitespace-pre-wrap rounded bg-amber-500/5 p-3 text-xs text-fg">
                              {String((sr.output as Record<string, unknown>).message ?? '')}
                            </pre>
                          )}
                        <div className="ml-auto flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void handleApprove(sr.step_id, true)}
                          >
                            {t('workflow_page.approve')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleApprove(sr.step_id, false)}
                          >
                            {t('workflow_page.reject')}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('workflow_page.title')}
        subtitle={t('workflow_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button variant="ghost" onClick={() => void handleDeleteSelected()}>
                <Icon icon={Trash2} size="xs" className="text-red-500" />
                {t('workflow_page.delete_selected', { count: selected.size })}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setGenerateOpen(true)}
              data-testid="workflow-generate-open"
            >
              <Icon icon={Sparkles} size="xs" className="text-gold-500" />
              {t('workflow_page.generate')}
            </Button>
            <Button variant="secondary" onClick={() => setMode({ kind: 'edit', wfId: null })}>
              <Icon icon={Plus} size="xs" />
              {t('workflow_page.create')}
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
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
            icon={Workflow}
            title={t('workflow_page.empty_title')}
            description={t('workflow_page.empty_desc')}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((wf) => (
              <div
                key={wf.id}
                className="group rounded-xl border border-border bg-bg-elev-1 p-5 transition-colors hover:border-gold-500/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selected.has(wf.id)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(wf.id); else next.delete(wf.id);
                          return next;
                        });
                      }}
                      className="mt-1 shrink-0 accent-gold-500"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-fg">{wf.name}</h3>
                    {wf.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{wf.description}</p>
                    )}
                    </div>
                  </div>
                  <span className={cn(
                    'ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs',
                    wf.trigger_type === 'cron' ? 'bg-blue-500/10 text-blue-500' : 'bg-fg-subtle/10 text-fg-subtle',
                  )}>
                    {wf.trigger_type === 'cron' ? '⏰ Cron' : '👆 Manual'}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
                  <span>{t('workflow_page.steps_count', { count: wf.step_count })}</span>
                  <span>·</span>
                  <span>v{wf.version}</span>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setMode({ kind: 'edit', wfId: wf.id })}
                  >
                    <Icon icon={Pencil} size="xs" />
                    {t('workflow_page.edit')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRun(wf)}
                    disabled={running}
                  >
                    <Icon icon={Play} size="xs" />
                    {t('workflow_page.run')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(wf.id)}
                  >
                    <Icon icon={Trash2} size="xs" className="text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <WorkflowGenerateDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerated={(def) => {
          // Hand the AI's draft to the editor as a seed and dismiss
          // the drawer so the next mode transition is uncluttered.
          setGenerateOpen(false);
          setMode({ kind: 'edit', wfId: null, seed: def });
        }}
      />
    </div>
  );
}
