import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ListChecks,
  Loader2,
  RefreshCw,
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
  workflowHistoryList,
  workflowRunCancel,
  type WorkflowRunResult,
  type WorkflowRunSummary,
} from '@/lib/ipc';

type TabId = 'active' | 'history';

interface UnifiedTask {
  id: string;
  workflowId: string;
  status: WorkflowRunResult['status'] | 'unknown';
  startedAt: number;
  updatedAt: number;
  stepCount?: number;
  completedCount?: number;
  failedCount?: number;
  error?: string;
}

const REFRESH_MS = 5_000;

export function TasksRoute() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('active');
  const [active, setActive] = useState<WorkflowRunResult[] | null>(null);
  const [history, setHistory] = useState<WorkflowRunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, h] = await Promise.all([
        workflowActiveRuns(),
        workflowHistoryList(undefined, 200),
      ]);
      setActive(a);
      setHistory(h);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const activeTasks = useMemo<UnifiedTask[]>(
    () =>
      (active ?? []).map((r) => ({
        id: r.id,
        workflowId: r.workflow_id,
        status: r.status,
        startedAt: 0,
        updatedAt: 0,
        stepCount: Object.keys(r.step_runs ?? {}).length,
        completedCount: Object.values(r.step_runs ?? {}).filter(
          (s) => s.status === 'completed',
        ).length,
        failedCount: Object.values(r.step_runs ?? {}).filter((s) => s.status === 'failed')
          .length,
        error: r.error,
      })),
    [active],
  );

  const historyTasks = useMemo<UnifiedTask[]>(
    () =>
      (history ?? []).map((r) => ({
        id: r.id,
        workflowId: r.workflow_id,
        status: r.status as WorkflowRunResult['status'],
        startedAt: r.started_at,
        updatedAt: r.updated_at,
        stepCount: r.step_count,
        completedCount: r.completed_count,
        failedCount: r.failed_count,
        error: r.error,
      })),
    [history],
  );

  const handleCancel = async (runId: string) => {
    try {
      await workflowRunCancel(runId);
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  const visible = tab === 'active' ? activeTasks : historyTasks;
  const isEmpty = visible.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('tasks.title', { defaultValue: '任务' })}
        subtitle={t('tasks.subtitle', {
          defaultValue: '当前运行中、已完成、失败的任务一览。包含所有 Workflow 运行。',
        })}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <Icon icon={loading ? Loader2 : RefreshCw} size={14} className={loading ? 'animate-spin' : ''} />
            <span className="ml-1.5">{t('tasks.refresh', { defaultValue: '刷新' })}</span>
          </Button>
        }
      />

      <div className="flex items-center gap-1 border-b border-border/50 px-4">
        <TabButton
          active={tab === 'active'}
          onClick={() => setTab('active')}
          icon={Activity}
          label={t('tasks.tab_active', { defaultValue: '运行中' })}
          count={activeTasks.length}
        />
        <TabButton
          active={tab === 'history'}
          onClick={() => setTab('history')}
          icon={ListChecks}
          label={t('tasks.tab_history', { defaultValue: '历史' })}
          count={historyTasks.length}
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertTriangle} size={16} />
            <span>{error}</span>
          </div>
        )}

        {isEmpty ? (
          <EmptyState
            icon={tab === 'active' ? Activity : ListChecks}
            title={
              tab === 'active'
                ? t('tasks.empty_active_title', { defaultValue: '当前没有运行中的任务' })
                : t('tasks.empty_history_title', { defaultValue: '暂无任务历史' })
            }
            description={
              tab === 'active'
                ? t('tasks.empty_active_desc', {
                    defaultValue: '从工作流页面或聊天中触发的长任务会出现在这里。',
                  })
                : t('tasks.empty_history_desc', {
                    defaultValue: '完成或失败的任务会保留在历史中以便回溯。',
                  })
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} onCancel={handleCancel} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition',
        active ? 'text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      <Icon icon={icon} size={14} />
      <span>{label}</span>
      <span
        className={cn(
          'min-w-[18px] rounded-full px-1.5 text-[10px] font-semibold leading-[18px]',
          active ? 'bg-gold-500/20 text-gold-500' : 'bg-bg-elev-2 text-fg-muted',
        )}
      >
        {count}
      </span>
      {active && (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-gold-500" aria-hidden />
      )}
    </button>
  );
}

function TaskRow({
  task,
  onCancel,
}: {
  task: UnifiedTask;
  onCancel: (id: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const isRunning = task.status === 'running' || task.status === 'pending';
  const isPaused = task.status === 'paused';

  return (
    <li className="rounded-lg border border-border/50 bg-bg-elev-1 p-3 transition hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <StatusPill status={task.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                to="/workflows"
                className="truncate text-sm font-semibold text-fg hover:text-gold-500"
              >
                {task.workflowId}
              </Link>
              <code className="rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                {task.id.slice(0, 8)}
              </code>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted">
              {task.stepCount !== undefined && (
                <span className="flex items-center gap-1">
                  <Icon icon={CheckCircle2} size={12} />
                  {task.completedCount ?? 0}/{task.stepCount}{' '}
                  {t('tasks.steps', { defaultValue: '步' })}
                </span>
              )}
              {(task.failedCount ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-danger">
                  <Icon icon={XCircle} size={12} />
                  {task.failedCount} {t('tasks.failed', { defaultValue: '失败' })}
                </span>
              )}
              {task.startedAt > 0 && (
                <span className="flex items-center gap-1">
                  <Icon icon={Clock} size={12} />
                  {formatTime(task.startedAt)}
                </span>
              )}
            </div>
            {task.error && (
              <div className="mt-2 line-clamp-2 text-[11px] text-danger">{task.error}</div>
            )}
          </div>
        </div>

        {(isRunning || isPaused) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onCancel(task.id)}
            className="shrink-0 text-danger hover:bg-danger/10"
          >
            {t('tasks.cancel', { defaultValue: '取消' })}
          </Button>
        )}
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: UnifiedTask['status'] }) {
  const map: Record<string, { label: string; color: string; icon: typeof Activity }> = {
    running: { label: '运行', color: 'bg-info/15 text-info', icon: Loader2 },
    pending: { label: '排队', color: 'bg-fg-muted/15 text-fg-muted', icon: Clock },
    paused: { label: '暂停', color: 'bg-warning/15 text-warning', icon: Clock },
    completed: { label: '完成', color: 'bg-success/15 text-success', icon: CheckCircle2 },
    failed: { label: '失败', color: 'bg-danger/15 text-danger', icon: XCircle },
    cancelled: { label: '取消', color: 'bg-fg-muted/15 text-fg-muted', icon: XCircle },
    unknown: { label: '?', color: 'bg-fg-muted/15 text-fg-muted', icon: Clock },
  };
  const cfg = map[status] ?? map.unknown!;
  const isSpinning = status === 'running';
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        cfg.color,
      )}
      title={cfg.label}
    >
      <Icon icon={cfg.icon} size={14} className={isSpinning ? 'animate-spin' : ''} />
    </span>
  );
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}
