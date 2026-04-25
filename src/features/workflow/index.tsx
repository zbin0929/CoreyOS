import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Play,
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
  workflowApprove,
  type WorkflowSummary,
  type WorkflowRunResult,
} from '@/lib/ipc';
import { WorkflowEditor } from './Editor';

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; wfId: string }
  | { kind: 'run'; wf: WorkflowSummary };

export function WorkflowRoute() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [running, setRunning] = useState(false);

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

  const handleDelete = async (id: string) => {
    try {
      await workflowDelete(id);
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
    return <WorkflowEditor workflowId={mode.wfId} onBack={() => setMode({ kind: 'list' })} />;
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
          {running && (
            <div className="flex items-center gap-3 text-fg-subtle">
              <Icon icon={Loader2} size="md" className="animate-spin" />
              <span>{t('workflow_page.executing')}</span>
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
              <div className="space-y-2">
                {Object.values(runResult.step_runs).map((sr) => (
                  <div
                    key={sr.step_id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border border-border px-4 py-3',
                      sr.status === 'completed' && 'bg-green-500/5',
                      sr.status === 'running' && 'bg-blue-500/5',
                      sr.status === 'failed' && 'bg-red-500/5',
                      sr.status === 'pending' && 'bg-bg-elev-1',
                    )}
                  >
                    <Icon
                      icon={sr.status === 'completed' ? CheckCircle2 : sr.status === 'failed' ? XCircle : sr.status === 'running' ? Loader2 : Clock}
                      size="sm"
                      className={cn(
                        sr.status === 'completed' && 'text-green-500',
                        sr.status === 'failed' && 'text-red-500',
                        sr.status === 'running' && 'text-blue-500 animate-spin',
                        sr.status === 'pending' && 'text-fg-subtle',
                      )}
                    />
                    <span className="text-sm font-medium text-fg">{sr.step_id}</span>
                    <span className="text-xs text-fg-subtle">{sr.status}</span>
                    {sr.error && <span className="ml-auto text-xs text-red-500">{sr.error}</span>}
                    {sr.output && (
                      <pre className="ml-auto max-w-xs truncate text-xs text-fg-subtle">
                        {JSON.stringify(sr.output).slice(0, 100)}
                      </pre>
                    )}
                    {sr.status === 'running' && runResult?.status === 'paused' && (
                      <div className="ml-auto flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void handleApprove(sr.step_id, true)}>
                          {t('workflow_page.approve')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleApprove(sr.step_id, false)}>
                          {t('workflow_page.reject')}
                        </Button>
                      </div>
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
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-fg">{wf.name}</h3>
                    {wf.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{wf.description}</p>
                    )}
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
    </div>
  );
}
