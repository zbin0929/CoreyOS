import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { workflowRunCancel, type WorkflowDef, type WorkflowSummary } from '@/lib/ipc';
import type { WorkflowRunState } from './useWorkflowRun';

export function WorkflowRunView({
  wf,
  def,
  runState,
  onBack,
}: {
  wf: WorkflowSummary;
  def?: WorkflowDef;
  runState: WorkflowRunState;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const hasRunning = Object.keys(runState.stepRunningSince).length > 0;
    if (!hasRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [runState.stepRunningSince]);
  void tick;

  const { runResult, running, stepRunningSince } = runState;
  const runStatusKey = runResult ? `workflow_page.status_${runResult.status}` : null;

  const handleCancelRun = async () => {
    if (!window.confirm(t('workflow_page.cancel_confirm', { defaultValue: '确认停止当前运行？' }))) return;
    try {
      runState.reset();
      if (runResult?.id) await workflowRunCancel(runResult.id);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={wf.name}
        subtitle={running ? t('workflow_page.running') : t('workflow_page.run_result')}
        actions={
          <div className="flex items-center gap-2">
            {(runResult?.status === 'running' || runResult?.status === 'paused') && (
              <Button variant="ghost" onClick={() => void handleCancelRun()} className="text-red-500 hover:bg-red-500/10">
                {t('workflow_page.cancel_run', { defaultValue: '停止运行' })}
              </Button>
            )}
            <Button variant="ghost" onClick={onBack}>
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
            {runResult.error && <p className="text-sm text-red-500">{runResult.error}</p>}
            {(() => {
              const runs = Object.values(runResult.step_runs);
              const total = runs.length;
              const done = runs.filter((s) => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped').length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-elev-2">
                    <div className={cn('h-full rounded-full transition-all duration-300', runResult.status === 'failed' ? 'bg-red-500' : 'bg-gold-500')} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-fg-subtle">{done}/{total} ({pct}%)</span>
                </div>
              );
            })()}
            <div className="space-y-2">
              {(() => {
                const sorted = def
                  ? def.steps.map((s) => runResult.step_runs[s.id]).filter((sr): sr is NonNullable<typeof sr> => Boolean(sr))
                  : Object.values(runResult.step_runs);
                return sorted;
              })().map((sr) => (
                <div key={sr.step_id} className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3',
                  sr.status === 'completed' && 'bg-green-500/5',
                  sr.status === 'running' && 'bg-blue-500/5',
                  sr.status === 'failed' && 'bg-red-500/5',
                  sr.status === 'pending' && 'bg-bg-elev-1',
                  sr.status === 'awaiting_approval' && 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30',
                )}>
                  <Icon icon={sr.status === 'completed' ? CheckCircle2 : sr.status === 'failed' ? XCircle : sr.status === 'running' ? Loader2 : Clock} size="sm" className={cn(
                    sr.status === 'completed' && 'text-green-500',
                    sr.status === 'failed' && 'text-red-500',
                    sr.status === 'running' && 'text-blue-500 animate-spin',
                    sr.status === 'pending' && 'text-fg-subtle',
                    sr.status === 'awaiting_approval' && 'text-amber-500',
                  )} />
                  <span className="text-sm font-medium text-fg">{sr.step_id}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px]',
                    sr.status === 'completed' && 'bg-green-500/10 text-green-500',
                    sr.status === 'running' && 'bg-blue-500/10 text-blue-500',
                    sr.status === 'failed' && 'bg-red-500/10 text-red-500',
                    sr.status === 'pending' && 'bg-bg-elev-2 text-fg-subtle',
                    sr.status === 'awaiting_approval' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    sr.status === 'skipped' && 'bg-bg-elev-2 text-fg-subtle',
                  )}>{t(`workflow_page.status_${sr.status}`)}</span>
                  {sr.status === 'running' && stepRunningSince[sr.step_id] !== undefined && (
                    <span className="text-xs text-blue-500 tabular-nums">{formatElapsed(Date.now() - stepRunningSince[sr.step_id]!)}</span>
                  )}
                  {sr.duration_ms != null && sr.status !== 'running' && (
                    <span className="text-xs text-fg-subtle">{sr.duration_ms >= 1000 ? `${(sr.duration_ms / 1000).toFixed(1)}s` : `${sr.duration_ms}ms`}</span>
                  )}
                  {sr.error && <span className="ml-auto text-xs text-red-500" title={sr.error}>{sr.error.length > 80 ? sr.error.slice(0, 80) + '…' : sr.error}</span>}
                  {sr.output && sr.status !== 'awaiting_approval' && (
                    <details className="ml-auto">
                      <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg">{t('workflow_page.step_output')}</summary>
                      <pre className="mt-1 max-w-sm overflow-auto rounded bg-bg-elev-2 p-2 text-xs text-fg-subtle">{JSON.stringify(sr.output, null, 2).slice(0, 500)}</pre>
                    </details>
                  )}
                  {sr.status === 'running' && typeof sr.output === 'object' && sr.output !== null && typeof (sr.output as Record<string, unknown>).partial === 'string' && ((sr.output as Record<string, unknown>).partial as string).length > 0 && (
                    <>
                      <div className="basis-full" />
                      <div className="w-full max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-bg-elev-2/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-subtle">
                        {tail((sr.output as Record<string, unknown>).partial as string, 6)}
                        <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 bg-blue-500/70 animate-pulse" />
                      </div>
                    </>
                  )}
                  {sr.status === 'awaiting_approval' && (
                    <>
                      <div className="basis-full" />
                      {typeof sr.output === 'object' && sr.output !== null && 'message' in sr.output && (
                        <div className="w-full whitespace-pre-line rounded-md bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-fg">
                          {String((sr.output as Record<string, unknown>).message ?? '')}
                        </div>
                      )}
                      <div className="ml-auto flex gap-2">
                        <Button variant="primary" size="sm" onClick={() => runState.submitApproval(sr.step_id, true)}>{t('workflow_page.approve')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => runState.setRejectPrompt({ stepId: sr.step_id })}>{t('workflow_page.reject')}</Button>
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

function tail(s: string, n: number): string {
  const lines = s.split('\n');
  if (lines.length <= n) return s;
  return lines.slice(lines.length - n).join('\n');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}
