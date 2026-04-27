import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  History as HistoryIcon,
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
  workflowGet,
  workflowDelete,
  workflowRun,
  workflowRunCancel,
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
import { WorkflowHistoryRoute } from './History';

type Mode =
  | { kind: 'list' }
  | { kind: 'history' }
  | { kind: 'edit'; wfId: string | null; seed?: WorkflowDef }
  // The `def` is loaded once on entering run mode so the run view
  // can render steps in the order they're declared in the YAML
  // (the engine stores step_runs in a HashMap, which iterates in
  // an unspecified order — the cause of the "audit_report shows
  // first" bug). It's optional because `workflowActiveRuns`
  // rehydration on remount may snap us into run mode before
  // `workflowGet` resolves; the UI degrades gracefully to the
  // unsorted hash order in that brief window.
  | { kind: 'run'; wf: WorkflowSummary; def?: WorkflowDef };

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

  // Resolved through a ref so we can reference pollRunStatus from the
  // effect below without tripping the temporal-dead-zone (the callback
  // is declared further down because it depends on `stopPolling`).
  const pollRunStatusRef = useRef<(runId: string) => void>(() => {});

  useEffect(() => {
    (async () => {
      try {
        const active = await workflowActiveRuns();
        if (active.length > 0) {
          const run = active[0]!;
          const wf = rows?.find((w) => w.id === run.workflow_id);
          if (wf) {
            // Pull the def alongside the run so the run view's
            // step ordering matches the YAML, not HashMap iteration
            // order. Rehydrate-without-def previously rendered the
            // step list in random order (audit_report could appear
            // before validate).
            let def: WorkflowDef | undefined;
            try {
              def = await workflowGet(run.workflow_id);
            } catch {
              // Def fetch failure is non-fatal — UI degrades to
              // hash-order, but the run still works.
            }
            setMode({ kind: 'run', wf, def });
            setRunning(true);
            setRunResult(run);
            runIdRef.current = run.id;
            pollRunStatusRef.current(run.id);
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

  // When the user clicks Run, we first fetch the def. If it has
  // declared inputs, we open a dialog to collect them — otherwise
  // we kick the run immediately. This was the missing piece that
  // made the e-commerce demo render approval cards with empty
  // `活动：` `SKU：` lines: nobody was supplying inputs.
  const [inputsPrompt, setInputsPrompt] = useState<{
    wf: WorkflowSummary;
    def: WorkflowDef;
  } | null>(null);

  const startRun = async (wf: WorkflowSummary, def: WorkflowDef, inputs: Record<string, unknown>) => {
    setRunning(true);
    setRunResult(null);
    setMode({ kind: 'run', wf, def });
    try {
      const runId = await workflowRun(wf.id, inputs);
      runIdRef.current = runId;
      void pollRunStatus(runId);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setRunning(false);
    }
  };

  const handleRun = async (wf: WorkflowSummary) => {
    try {
      const def = await workflowGet(wf.id);
      if (def.inputs && def.inputs.length > 0) {
        setInputsPrompt({ wf, def });
        return;
      }
      await startRun(wf, def, {});
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const runIdRef = useRef<string>('');
  // Tracks active polling timers so we can cancel them on unmount or
  // when the user navigates away from the run view. Without this, a
  // long-running workflow would keep firing setRunResult on an
  // unmounted component and React would warn (and we'd waste IPC).
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAliveRef = useRef(false);

  const stopPolling = useCallback(() => {
    pollAliveRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollRunStatus = useCallback((runId: string) => {
    pollAliveRef.current = true;
    const tick = async () => {
      if (!pollAliveRef.current) return;
      try {
        const result = await workflowRunStatus(runId);
        if (!pollAliveRef.current) return;
        if (result) {
          setRunResult(result);
          if (
            result.status === 'completed' ||
            result.status === 'failed' ||
            result.status === 'cancelled'
          ) {
            setRunning(false);
            stopPolling();
            return;
          }
          // Paused runs: keep polling at a slower cadence — there's
          // nothing changing on the backend until the user clicks
          // approve / reject, and we re-tighten via setRunResult
          // optimistically inside handleApprove.
          const delay = result.status === 'paused' ? 3000 : 1200;
          pollTimerRef.current = setTimeout(tick, delay);
          return;
        }
      } catch {
        /* transient — retry */
      }
      pollTimerRef.current = setTimeout(tick, 1500);
    };
    void tick();
  }, [stopPolling]);

  // Keep the ref in sync so the rehydration effect can call into the
  // latest closure without listing it as a dep.
  useEffect(() => {
    pollRunStatusRef.current = pollRunStatus;
  }, [pollRunStatus]);

  // Frontend-side `running` step elapsed timer.
  //
  // Backend doesn't expose `started_at_ms` per step today (it would
  // need a schema bump), but for live UX we only need a stopwatch:
  // when a step first appears as `running`, stamp `Date.now()`. While
  // ANY step is running, tick a 1 Hz state to drive re-render so the
  // displayed elapsed value advances. When the step leaves `running`
  // (completed / failed / paused), drop its stamp so completed
  // steps fall back to the authoritative `duration_ms` from the
  // backend hook.
  //
  // This survives the run view re-mount because we re-stamp on the
  // next render after rehydrate (the step is still `running`). Stamps
  // would be slightly off if the run had been running before app
  // launch, but that's bounded by however long the step has been
  // alive — the backend's eventual `duration_ms` corrects it once the
  // step finishes, so we never persist a wrong number.
  const [stepRunningSince, setStepRunningSince] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!runResult) return;
    setStepRunningSince((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sr of Object.values(runResult.step_runs)) {
        if (sr.status === 'running' && next[sr.step_id] === undefined) {
          next[sr.step_id] = Date.now();
          changed = true;
        } else if (sr.status !== 'running' && next[sr.step_id] !== undefined) {
          delete next[sr.step_id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [runResult]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const hasRunning = Object.keys(stepRunningSince).length > 0;
    if (!hasRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [stepRunningSince]);
  // `tick` is read in the render to defeat dead-code elimination —
  // we don't actually need its value, just the re-render it triggers.
  void tick;

  // Reject collects a freeform reason via a small modal — the
  // feedback ends up in `workflow_runs.error` and audit reports
  // (where it answers "why was this stopped?"). Approve has no
  // analogous prompt today: the act of clicking "通过" is itself the
  // approval signal, no extra text needed for the audit trail.
  const [rejectPrompt, setRejectPrompt] = useState<{ stepId: string } | null>(null);

  const submitApproval = async (
    stepId: string,
    approved: boolean,
    feedback?: string,
  ) => {
    if (!runIdRef.current) return;
    try {
      // Optimistically reflect the click so the buttons disappear
      // immediately — the next poll will overwrite with backend truth
      // (Completed for approve, Failed for reject).
      setRunResult((prev) => {
        if (!prev) return prev;
        const sr = prev.step_runs[stepId];
        if (!sr || sr.status !== 'awaiting_approval') return prev;
        return {
          ...prev,
          status: approved ? 'running' : 'failed',
          step_runs: {
            ...prev.step_runs,
            [stepId]: {
              ...sr,
              status: approved ? 'completed' : 'failed',
            },
          },
        };
      });
      // Reject path: prefer the user-supplied reason, fall back to a
      // localized "no reason given" so the run error banner shows in
      // the UI language instead of hard-coded English.
      const finalFeedback = approved
        ? undefined
        : (feedback?.trim() || t('workflow_page.rejected_default'));
      await workflowApprove(runIdRef.current, stepId, approved, finalFeedback);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const handleApprove = (stepId: string) => {
    void submitApproval(stepId, true);
  };

  const handleReject = (stepId: string) => {
    // Open the reason dialog. The user can submit empty (= falls back
    // to the localized default reason) or skip the dialog with Esc /
    // cancel — but we still ask, because workflows that paused on a
    // financial / safety gate genuinely benefit from a written reason.
    setRejectPrompt({ stepId });
  };

  const handleCancelRun = async () => {
    if (!runIdRef.current) return;
    if (
      !window.confirm(
        t('workflow_page.cancel_confirm', {
          defaultValue: '确认停止当前运行？正在执行的步骤会跑完当前调用后退出。',
        }),
      )
    ) {
      return;
    }
    try {
      // Optimistic flip so the UI doesn't sit on "running" for the
      // up-to-30-second window where the in-flight agent step is
      // still finishing. Backend's next poll will overwrite with
      // the authoritative `cancelled` status.
      setRunResult((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
      await workflowRunCancel(runIdRef.current);
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

  if (mode.kind === 'history') {
    return <WorkflowHistoryRoute onBack={() => setMode({ kind: 'list' })} />;
  }

  if (mode.kind === 'run' && mode.wf) {
    const runStatusKey = runResult
      ? `workflow_page.status_${runResult.status}`
      : null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader
          title={mode.wf.name}
          subtitle={running ? t('workflow_page.running') : t('workflow_page.run_result')}
          actions={
            <div className="flex items-center gap-2">
              {/* Cancel only renders while there's still something
                  to stop (running or paused). Terminal runs don't
                  need a stop button — there's nothing running. */}
              {(runResult?.status === 'running' || runResult?.status === 'paused') && (
                <Button
                  variant="ghost"
                  onClick={() => void handleCancelRun()}
                  className="text-red-500 hover:bg-red-500/10"
                >
                  {t('workflow_page.cancel_run', { defaultValue: '停止运行' })}
                </Button>
              )}
              <Button variant="ghost" onClick={() => { setMode({ kind: 'list' }); setRunResult(null); }}>
                {t('workflow_page.back')}
              </Button>
            </div>
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
                runResult.status === 'paused' ? 'bg-amber-500/10 text-amber-500' :
                'bg-yellow-500/10 text-yellow-500',
              )}>
                <Icon icon={runResult.status === 'completed' ? CheckCircle2 : runResult.status === 'failed' ? XCircle : Clock} size="xs" />
                {runStatusKey ? t(runStatusKey) : runResult.status}
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
                {(() => {
                  // Render in the order steps are declared in the def
                  // — not in HashMap iteration order, which causes
                  // `audit_report` to randomly appear before `validate`.
                  // Falls back to insertion order if def hasn't loaded
                  // yet (e.g. during active-run rehydration).
                  const sorted = mode.def
                    ? mode.def.steps
                        .map((s) => runResult.step_runs[s.id])
                        .filter((sr): sr is NonNullable<typeof sr> => Boolean(sr))
                    : Object.values(runResult.step_runs);
                  return sorted;
                })().map((sr) => (
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
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[11px]',
                      sr.status === 'completed' && 'bg-green-500/10 text-green-500',
                      sr.status === 'running' && 'bg-blue-500/10 text-blue-500',
                      sr.status === 'failed' && 'bg-red-500/10 text-red-500',
                      sr.status === 'pending' && 'bg-bg-elev-2 text-fg-subtle',
                      sr.status === 'awaiting_approval' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                      sr.status === 'skipped' && 'bg-bg-elev-2 text-fg-subtle',
                    )}>
                      {t(`workflow_page.status_${sr.status}`)}
                    </span>
                    {/* Live elapsed for running steps. The frontend
                        stopwatch uses the moment we first SAW the
                        step in `running` state; backend `duration_ms`
                        replaces this once the step settles. */}
                    {sr.status === 'running' && stepRunningSince[sr.step_id] !== undefined && (
                      <span className="text-xs text-blue-500 tabular-nums">
                        {formatElapsed(Date.now() - stepRunningSince[sr.step_id]!)}
                      </span>
                    )}
                    {sr.duration_ms != null && sr.status !== 'running' && (
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
                    {/* Hide raw JSON output for awaiting_approval rows
                        — the message body below already renders the
                        human-readable approval prompt; the {message,
                        status:'awaiting_approval'} blob is engine
                        plumbing the user shouldn't see. */}
                    {sr.output && sr.status !== 'awaiting_approval' && (
                      <details className="ml-auto">
                        <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg">
                          {t('workflow_page.step_output')}
                        </summary>
                        <pre className="mt-1 max-w-sm overflow-auto rounded bg-bg-elev-2 p-2 text-xs text-fg-subtle">
                          {JSON.stringify(sr.output, null, 2).slice(0, 500)}
                        </pre>
                      </details>
                    )}
                    {/* Live partial output for streaming agent steps.
                        The backend's progress hook stuffs cumulative
                        text into `output.partial` every ~50 ms; we
                        render it inline so the user can see the
                        agent's answer typing in instead of staring
                        at a 30-second spinner. Tail the last ~6
                        lines so a long output doesn't push everything
                        else off-screen — the full body is available
                        once the step settles via the Output details
                        toggle. */}
                    {sr.status === 'running' &&
                      typeof sr.output === 'object' &&
                      sr.output !== null &&
                      typeof (sr.output as Record<string, unknown>).partial === 'string' &&
                      ((sr.output as Record<string, unknown>).partial as string).length > 0 && (
                        <div className="basis-full" />
                      )}
                    {sr.status === 'running' &&
                      typeof sr.output === 'object' &&
                      sr.output !== null &&
                      typeof (sr.output as Record<string, unknown>).partial === 'string' &&
                      ((sr.output as Record<string, unknown>).partial as string).length > 0 && (
                        <div className="w-full max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-bg-elev-2/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-subtle">
                          {tail(
                            (sr.output as Record<string, unknown>).partial as string,
                            6,
                          )}
                          <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 bg-blue-500/70 animate-pulse" />
                        </div>
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
                            // Plain prose, not <pre>. The yaml's `|` block
                            // already preserves line breaks; we just need
                            // whitespace-pre-line to honor them. Monospace
                            // here was making approval cards look like
                            // console dumps (per user feedback).
                            <div className="w-full whitespace-pre-line rounded-md bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-fg">
                              {String((sr.output as Record<string, unknown>).message ?? '')}
                            </div>
                          )}
                        <div className="ml-auto flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleApprove(sr.step_id)}
                          >
                            {t('workflow_page.approve')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReject(sr.step_id)}
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
            <Button variant="ghost" onClick={() => setMode({ kind: 'history' })}>
              <Icon icon={HistoryIcon} size="xs" />
              {t('workflow_page.history_button', { defaultValue: '历史' })}
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

      {inputsPrompt && (
        <InputsPromptDialog
          wf={inputsPrompt.wf}
          def={inputsPrompt.def}
          onCancel={() => setInputsPrompt(null)}
          onSubmit={(values) => {
            const target = inputsPrompt;
            setInputsPrompt(null);
            void startRun(target.wf, target.def, values);
          }}
        />
      )}

      {rejectPrompt && (
        <RejectReasonDialog
          onCancel={() => setRejectPrompt(null)}
          onSubmit={(reason) => {
            const target = rejectPrompt;
            setRejectPrompt(null);
            void submitApproval(target.stepId, false, reason);
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal collecting a freeform reason for an approval rejection.
 * The reason flows through `workflow_approve` → backend's reason
 * field → `workflow_runs.error` → audit_report ("rejected_by",
 * "rejected_reason"). Empty submit is allowed; the backend falls
 * back to the localized default.
 */
function RejectReasonDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-bg-elev-1 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-fg">
          {t('workflow_page.reject_dialog_title', { defaultValue: '驳回原因' })}
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          {t('workflow_page.reject_dialog_subtitle', {
            defaultValue:
              '驳回会终止整个工作流，并把原因写入审计报告。可留空。',
          })}
        </p>
        <textarea
          autoFocus
          rows={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('workflow_page.reject_dialog_placeholder', {
            defaultValue: '例如：折扣率超过本季度预算上限，需要重新核算。',
          })}
          className={cn(
            'mt-4 w-full resize-none rounded-md border border-border bg-bg-elev-2',
            'px-3 py-2 text-sm text-fg placeholder:text-fg-subtle/60',
            'focus:outline-none focus:ring-2 focus:ring-amber-500/40',
          )}
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('workflow_page.inputs_cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSubmit(reason)}>
            {t('workflow_page.reject_dialog_submit', { defaultValue: '确认驳回' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Return the last N lines of `s`. Used by the live-partial renderer
 * to keep the streaming output preview compact even for an agent
 * that produces a 100-line markdown table.
 */
function tail(s: string, n: number): string {
  const lines = s.split('\n');
  if (lines.length <= n) return s;
  return lines.slice(lines.length - n).join('\n');
}

/**
 * Compact "Xs" / "Xm Ys" formatter for the running-step stopwatch.
 * Sub-second is shown as "0.X s" so a fast step doesn't pulse "0s
 * 1s 2s" when it's actually finishing in 600 ms.
 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/**
 * Modal that collects values for a workflow's declared `inputs` before
 * the run starts. Without this, demos like "电商促销审批与上下架"
 * render approval cards with empty `活动：` / `SKU：` lines because
 * `workflowRun(wf.id, {})` was being called with no values.
 */
function InputsPromptDialog({
  wf,
  def,
  onCancel,
  onSubmit,
}: {
  wf: WorkflowSummary;
  def: WorkflowDef;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  // Seed with each input's `default` so the user can just hit Start
  // for demos that ship sensible defaults.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const inp of def.inputs) init[inp.name] = inp.default ?? '';
    return init;
  });
  const [touched, setTouched] = useState(false);

  const missingRequired = def.inputs.filter(
    (inp) => inp.required && !values[inp.name]?.trim(),
  );

  const submit = () => {
    setTouched(true);
    if (missingRequired.length > 0) return;
    // Coerce by declared type. Number fields become numbers; everything
    // else is forwarded as string. Lists / JSON are kept as raw strings
    // since the engine renders them with {{inputs.x}} into a template.
    const out: Record<string, unknown> = {};
    for (const inp of def.inputs) {
      const raw = values[inp.name] ?? '';
      if (inp.type === 'number') {
        const n = Number(raw);
        out[inp.name] = Number.isFinite(n) ? n : raw;
      } else {
        out[inp.name] = raw;
      }
    }
    onSubmit(out);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg-elev-1 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-fg">
          {wf.name}
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          {t('workflow_page.inputs_dialog_subtitle')}
        </p>
        <div className="mt-5 space-y-4">
          {def.inputs.map((inp) => {
            const isMissing =
              touched && inp.required && !values[inp.name]?.trim();
            return (
              <div key={inp.name} className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-medium text-fg">
                  {inp.label || inp.name}
                  {inp.required && (
                    <span className="text-[10px] font-normal text-amber-500">
                      * {t('workflow_page.inputs_required')}
                    </span>
                  )}
                </label>
                {inp.options && inp.options.length > 0 ? (
                  <select
                    value={values[inp.name] ?? ''}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [inp.name]: e.target.value }))
                    }
                    className={cn(
                      'w-full rounded-md border bg-bg-elev-2 px-3 py-2 text-sm text-fg outline-none',
                      isMissing ? 'border-red-500/60' : 'border-border',
                    )}
                  >
                    <option value="">—</option>
                    {inp.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={inp.type === 'number' ? 'number' : 'text'}
                    value={values[inp.name] ?? ''}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [inp.name]: e.target.value }))
                    }
                    placeholder={inp.default ?? ''}
                    className={cn(
                      'w-full rounded-md border bg-bg-elev-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle/60',
                      isMissing ? 'border-red-500/60' : 'border-border',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('workflow_page.inputs_cancel')}
          </Button>
          <Button variant="primary" onClick={submit}>
            <Icon icon={Play} size="xs" />
            {t('workflow_page.inputs_start')}
          </Button>
        </div>
      </div>
    </div>
  );
}
