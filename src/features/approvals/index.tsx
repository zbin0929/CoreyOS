import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  workflowActiveRuns,
  workflowApprove,
  type WorkflowRunResult,
  type WorkflowStepRun,
} from '@/lib/ipc';

/**
 * Workflow approval gate inbox.
 *
 * Shows every step across every active run that's currently sitting
 * in `awaiting_approval` state, with Approve / Reject buttons that
 * call the existing `workflow_approve` IPC. This is the global
 * counterpart to the in-chat ApprovalCard — chat handles per-session
 * tool approvals; this view handles workflow approval steps that
 * pause runs.
 *
 * Polling: every 4 s. The `workflow:run-finished` event from
 * useWorkflowNotifications would also work as a trigger but most
 * approval transitions don't fire a "finished" event (run pauses, it
 * doesn't terminate), so a polling loop stays correct.
 */
const REFRESH_MS = 4_000;

interface PendingItem {
  runId: string;
  workflowId: string;
  step: WorkflowStepRun;
}

export function ApprovalsRoute() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<WorkflowRunResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const a = await workflowActiveRuns();
      setRuns(a);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const tid = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(tid);
  }, [load]);

  const items = useMemo<PendingItem[]>(() => {
    if (!runs) return [];
    const out: PendingItem[] = [];
    for (const run of runs) {
      const stepEntries = Object.entries(run.step_runs ?? {});
      for (const [, step] of stepEntries) {
        if (step.status === 'awaiting_approval') {
          out.push({ runId: run.id, workflowId: run.workflow_id, step });
        }
      }
    }
    return out;
  }, [runs]);

  const decide = useCallback(
    async (runId: string, stepId: string, approved: boolean) => {
      const key = approvalKey(runId, stepId);
      setPending((s) => {
        const next = new Set(s);
        next.add(key);
        return next;
      });
      try {
        await workflowApprove(runId, stepId, approved, feedback[key]);
        // Optimistic refresh — the engine flips status synchronously
        // inside the IPC, so a poll right after will already show the
        // new state.
        await load();
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [feedback, load],
  );

  const toggleExpand = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('approvals.title', '审批中心')}
        subtitle={t(
          'approvals.description',
          '工作流暂停在审批节点 → 在这里批准或驳回；与对话页里的工具审批互不重复。',
        )}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            data-testid="approvals-refresh"
          >
            <Icon icon={RefreshCw} size={12} className={cn(loading && 'animate-spin')} />
            {t('common.refresh', '刷新')}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 py-4">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!error && items.length === 0 && (
          <EmptyState
            icon={ShieldAlert}
            title={t('approvals.empty.title', '没有等待审批的工作流')}
            description={t(
              'approvals.empty.description',
              '工作流跑到 `type: approval` 节点会暂停在这里。',
            )}
          />
        )}

        {items.map(({ runId, workflowId, step }) => {
          const key = approvalKey(runId, step.step_id);
          const isPending = pending.has(key);
          const isExpanded = expanded.has(key);
          return (
            <article
              key={key}
              className="rounded-lg border border-border bg-bg-elev-1 p-4 shadow-sm"
              data-testid="approval-card"
            >
              <header className="flex items-start gap-3">
                <Icon
                  icon={AlertTriangle}
                  size={20}
                  className="shrink-0 text-amber-600 dark:text-amber-400"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="truncate text-sm font-semibold text-fg">
                      {step.step_id}
                    </h3>
                    <span className="text-[11px] text-fg-subtle">
                      {workflowId} · run {runId.slice(0, 8)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">
                    {t('approvals.waiting', '等待人工批准 — 工作流已暂停。')}
                  </p>
                </div>
                <Link
                  to="/tasks"
                  className="text-[11px] text-fg-subtle hover:text-fg inline-flex items-center gap-1"
                >
                  <Icon icon={ExternalLink} size={12} />
                  {t('approvals.goto_tasks', '查看任务')}
                </Link>
              </header>

              <button
                type="button"
                onClick={() => toggleExpand(key)}
                className="mt-3 inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
              >
                <Icon icon={isExpanded ? ChevronDown : ChevronRight} size={12} />
                {t('approvals.show_details', '步骤上下文')}
              </button>

              {isExpanded && step.output && (
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-bg-elev-2 p-2 text-[11px] text-fg-muted">
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              )}

              <div className="mt-3 flex flex-col gap-2">
                <input
                  type="text"
                  value={feedback[key] ?? ''}
                  onChange={(e) =>
                    setFeedback((f) => ({ ...f, [key]: e.target.value }))
                  }
                  placeholder={t('approvals.feedback_placeholder', '可选：备注（写入审计日志）')}
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-gold-500"
                  data-testid={`approval-feedback-${step.step_id}`}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void decide(runId, step.step_id, false)}
                    disabled={isPending}
                    data-testid={`approval-reject-${step.step_id}`}
                  >
                    {isPending ? (
                      <Icon icon={Loader2} size={12} className="animate-spin" />
                    ) : (
                      <Icon icon={XCircle} size={12} />
                    )}
                    {t('approvals.reject', '驳回')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void decide(runId, step.step_id, true)}
                    disabled={isPending}
                    data-testid={`approval-approve-${step.step_id}`}
                  >
                    {isPending ? (
                      <Icon icon={Loader2} size={12} className="animate-spin" />
                    ) : (
                      <Icon icon={CheckCircle2} size={12} />
                    )}
                    {t('approvals.approve', '批准')}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function approvalKey(runId: string, stepId: string): string {
  return `${runId}::${stepId}`;
}
