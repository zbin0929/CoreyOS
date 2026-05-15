import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileBox,
  ListChecks,
  Loader2,
  MessageSquare,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  artifactList,
  artifactWrite,
  ipcErrorMessage,
  workflowActiveRuns,
  workflowHistoryList,
  workflowRunCancel,
  workflowRunGet,
  type ArtifactInfo,
  type WorkflowRunResult,
  type WorkflowRunSummary,
  type WorkflowStepRun,
} from '@/lib/ipc';
import { useChatStore } from '@/stores/chat';

type TabId = 'active' | 'history' | 'long_chats';

/**
 * Threshold above which a chat session is treated as a "task" worth
 * surfacing alongside workflow runs. 10 messages = ~5 user turns,
 * which is the rough boundary between "quick question" and
 * "ongoing project". Below this we'd flood the page with every
 * casual chat the user ever had.
 */
const LONG_CHAT_MIN_MESSAGES = 10;

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

/**
 * Compact projection of `ChatSession` for the "Long chats" tab. We
 * keep this separate from `UnifiedTask` because the row layout is
 * different (no step count / failure state; just message count +
 * model + last-touched).
 */
interface LongChatTask {
  id: string;
  title: string;
  messageCount: number;
  userTurns: number;
  updatedAt: number;
  adapterId: string;
  model: string | null;
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

  // B-9.1 — long chat sessions surface as tasks. We don't fold them
  // into active/history because the lifecycle is different (no
  // running/failed; chats just go quiet) — they get their own tab so
  // the row contract stays clean.
  const chatSessions = useChatStore((s) => s.sessions);
  const longChats = useMemo<LongChatTask[]>(() => {
    return Object.values(chatSessions)
      .filter((s) => s.messages.length >= LONG_CHAT_MIN_MESSAGES)
      .map((s) => ({
        id: s.id,
        title: s.title || t('tasks.long_chat_default_title', { defaultValue: '未命名会话' }),
        messageCount: s.messages.length,
        userTurns: s.messages.filter((m) => m.role === 'user').length,
        updatedAt: s.updatedAt,
        adapterId: s.adapterId,
        model: s.model ?? null,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [chatSessions, t]);

  const handleCancel = async (runId: string) => {
    try {
      await workflowRunCancel(runId);
      await load();
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  };

  // Long-chats tab has its own dedicated render below; the
  // workflow-task views share a single list shape.
  const workflowVisible = tab === 'active' ? activeTasks : historyTasks;
  const isEmpty =
    tab === 'long_chats' ? longChats.length === 0 : workflowVisible.length === 0;

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
        <TabButton
          active={tab === 'long_chats'}
          onClick={() => setTab('long_chats')}
          icon={MessageSquare}
          label={t('tasks.tab_long_chats', { defaultValue: '长会话' })}
          count={longChats.length}
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
            icon={
              tab === 'active'
                ? Activity
                : tab === 'long_chats'
                  ? MessageSquare
                  : ListChecks
            }
            title={
              tab === 'active'
                ? t('tasks.empty_active_title', { defaultValue: '当前没有运行中的任务' })
                : tab === 'long_chats'
                  ? t('tasks.empty_long_chats_title', {
                      defaultValue: '还没有长会话',
                    })
                  : t('tasks.empty_history_title', { defaultValue: '暂无任务历史' })
            }
            description={
              tab === 'active'
                ? t('tasks.empty_active_desc', {
                    defaultValue: '从工作流页面或聊天中触发的长任务会出现在这里。',
                  })
                : tab === 'long_chats'
                  ? t('tasks.empty_long_chats_desc', {
                      defaultValue: `超过 ${LONG_CHAT_MIN_MESSAGES} 条消息的会话会自动出现在这里。`,
                    })
                  : t('tasks.empty_history_desc', {
                      defaultValue: '完成或失败的任务会保留在历史中以便回溯。',
                    })
            }
          />
        ) : tab === 'long_chats' ? (
          <ul className="flex flex-col gap-2">
            {longChats.map((c) => (
              <LongChatRow key={c.id} chat={c} />
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-2">
            {workflowVisible.map((task) => (
              <TaskRow key={task.id} task={task} active={active} onCancel={handleCancel} />
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
  active,
  onCancel,
}: {
  task: UnifiedTask;
  active: WorkflowRunResult[] | null;
  onCancel: (id: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const isRunning = task.status === 'running' || task.status === 'pending';
  const isPaused = task.status === 'paused';
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<WorkflowRunResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const ensureDetail = useCallback(async () => {
    const fromActive = (active ?? []).find((r) => r.id === task.id);
    if (fromActive) {
      setDetail(fromActive);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const r = await workflowRunGet(task.id);
      setDetail(r);
    } catch (e) {
      setDetailError(ipcErrorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  }, [active, task.id]);

  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      void ensureDetail();
    }
  };

  return (
    <li className="rounded-lg border border-border/50 bg-bg-elev-1 transition hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
        aria-expanded={expanded}
        data-testid={`task-row-${task.id}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon
            icon={expanded ? ChevronDown : ChevronRight}
            size={14}
            className="mt-1 shrink-0 text-fg-subtle"
          />
          <StatusPill status={task.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-fg">
                {task.workflowId}
              </span>
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
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              void onCancel(task.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                void onCancel(task.id);
              }
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-danger transition hover:bg-danger/10"
          >
            {t('tasks.cancel', { defaultValue: '取消' })}
          </span>
        )}
      </button>

      {expanded && (
        <TaskDetail
          loading={detailLoading}
          error={detailError}
          detail={detail}
          fallbackId={task.id}
          fallbackWorkflowId={task.workflowId}
        />
      )}
    </li>
  );
}

function TaskDetail({
  loading,
  error,
  detail,
  fallbackId,
  fallbackWorkflowId,
}: {
  loading: boolean;
  error: string | null;
  detail: WorkflowRunResult | null;
  fallbackId: string;
  fallbackWorkflowId: string;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="border-t border-border/50 px-3 py-3 text-xs text-fg-subtle">
        <Icon icon={Loader2} size={12} className="mr-1.5 inline animate-spin" />
        {t('tasks.loading_detail', { defaultValue: '加载中…' })}
      </div>
    );
  }
  if (error) {
    return (
      <div className="border-t border-border/50 px-3 py-3 text-xs text-danger">{error}</div>
    );
  }
  if (!detail) {
    return (
      <div className="border-t border-border/50 px-3 py-3 text-xs text-fg-subtle">
        {t('tasks.no_detail', {
          defaultValue: '没有更多详情。run id：{{id}}',
          id: fallbackId,
        })}
      </div>
    );
  }
  const steps = Object.values(detail.step_runs ?? {});
  const hasInputs = Object.keys(detail.inputs ?? {}).length > 0;
  return (
    <div className="border-t border-border/50 px-3 py-3" data-testid={`task-detail-${fallbackId}`}>
      {steps.length === 0 ? (
        <div className="text-xs text-fg-subtle">
          {t('tasks.no_steps_yet', {
            defaultValue: '尚未执行任何步骤。',
          })}
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {steps.map((s) => (
            <StepRow key={s.step_id} step={s} runId={fallbackId} />
          ))}
        </ol>
      )}
      {hasInputs && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-fg-subtle hover:text-fg">
            {t('tasks.inputs', { defaultValue: '运行参数' })}
          </summary>
          <pre className="mt-1 overflow-auto rounded bg-bg-elev-2 p-2 text-[11px] text-fg-subtle">
            {JSON.stringify(detail.inputs, null, 2)}
          </pre>
        </details>
      )}

      {/* B-9.4 — files this run produced (via `save_artifact`
          MCP tool, agent steps that write to artifacts dir, or
          power-user IPC). Lazy-loaded; missing dir = empty. */}
      <ArtifactsList runId={fallbackId} />

      <div className="mt-2 text-[10px] text-fg-subtle">
        <Link
          to="/workflows"
          className="underline-offset-2 hover:underline hover:text-fg"
        >
          {fallbackWorkflowId}
        </Link>
      </div>
    </div>
  );
}

function StepRow({ step, runId }: { step: WorkflowStepRun; runId: string }) {
  const { t } = useTranslation();
  const colorMap: Record<WorkflowStepRun['status'], string> = {
    pending: 'bg-fg-muted/15 text-fg-muted',
    running: 'bg-info/15 text-info',
    completed: 'bg-success/15 text-success',
    failed: 'bg-danger/15 text-danger',
    skipped: 'bg-fg-muted/10 text-fg-subtle',
    awaiting_approval: 'bg-warning/15 text-warning',
  };
  const outputText = step.output
    ? typeof step.output === 'string'
      ? step.output
      : JSON.stringify(step.output, null, 2)
    : null;
  const handleExport = useCallback(async () => {
    if (!outputText) return;
    try {
      await artifactWrite(runId, `${step.step_id}-output.md`, outputText);
    } catch {
      // artifact write best-effort
    }
  }, [runId, step.step_id, outputText]);
  return (
    <li className="flex flex-col gap-1 rounded border border-border/40 bg-bg-elev-1 px-2.5 py-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
            colorMap[step.status],
          )}
        >
          {step.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg">{step.step_name || step.step_id}</span>
        {step.duration_ms != null && (
          <span className="shrink-0 tabular-nums text-fg-subtle">
            {step.duration_ms >= 1000
              ? `${(step.duration_ms / 1000).toFixed(1)}s`
              : `${step.duration_ms}ms`}
          </span>
        )}
      </div>
      {step.error && (
        <div className="text-[10px] text-danger">{step.error}</div>
      )}
      {outputText && (
        <div className="flex items-start gap-1.5">
          <pre className="min-w-0 max-h-24 flex-1 overflow-auto whitespace-pre-wrap break-all rounded bg-bg/50 px-2 py-1 text-[10px] font-mono text-fg-subtle">
            {outputText.length > 500 ? outputText.slice(0, 500) + '…' : outputText}
          </pre>
          <button
            type="button"
            onClick={handleExport}
            className="shrink-0 rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
            title={t('tasks.export_output', { defaultValue: '导出产物' })}
          >
            <Download size={12} />
          </button>
        </div>
      )}
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

/**
 * Compact row for the "Long chats" tab. Click → /chat with the
 * session id query param so the chat page restores that session.
 * Stays minimal — message count + last-touched + "go to chat" hint.
 */
/**
 * Renders the artifact list for a single workflow run inside the
 * expanded TaskDetail. Lazy-loads on first mount; missing dir is
 * an empty list (not an error).
 *
 * Each row shows filename + size + mtime + two click actions:
 *
 * - **Copy path**: writes the absolute path to clipboard. Useful
 *   for piping into `code <path>` / `open <path>` from Terminal.
 * - **Open**: triggers the OS default app via `tauri-plugin-shell`'s
 *   `open` (already registered as a default-allowed scheme). Falls
 *   back to silently doing nothing outside Tauri (Storybook /
 *   Playwright); the copy-path button still works there.
 */
function ArtifactsList({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ArtifactInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await artifactList(runId);
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(ipcErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) {
    return (
      <div className="mt-3 text-[11px] text-danger">
        {t('tasks.artifacts_error', { defaultValue: '产物列表加载失败：' })}
        {error}
      </div>
    );
  }
  if (items === null) {
    return null;
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <details className="mt-3" open>
      <summary className="cursor-pointer text-[11px] font-medium text-fg-subtle hover:text-fg">
        <Icon icon={FileBox} size={12} className="mr-1 inline" />
        {t('tasks.artifacts', { defaultValue: '产物文件' })}
        <span className="ml-1 text-fg-subtle">({items.length})</span>
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((a) => (
          <ArtifactRow key={a.path} artifact={a} />
        ))}
      </ul>
    </details>
  );
}

function ArtifactRow({ artifact }: { artifact: ArtifactInfo }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* best effort */
    }
  };
  const onOpen = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(artifact.path);
    } catch {
      /* outside Tauri or open denied — silent */
    }
  };
  return (
    <li className="flex items-center gap-2 rounded border border-border/40 bg-bg-elev-1 px-2 py-1 text-[11px]">
      <Icon icon={FileBox} size={12} className="shrink-0 text-fg-subtle" />
      <span className="truncate font-mono text-fg" title={artifact.path}>
        {artifact.name}
      </span>
      <span className="shrink-0 text-fg-subtle">{formatBytes(artifact.size)}</span>
      <span className="shrink-0 text-fg-subtle">{formatTime(artifact.mtime_ms)}</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => void onCopyPath()}
          title={t('tasks.artifact_copy_path', { defaultValue: '复制路径' })}
          className="rounded px-1.5 py-0.5 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
          data-testid={`artifact-copy-${artifact.name}`}
        >
          <Icon icon={copied ? CheckCircle2 : Copy} size={11} />
        </button>
        <button
          type="button"
          onClick={() => void onOpen()}
          title={t('tasks.artifact_open', { defaultValue: '打开' })}
          className="rounded px-1.5 py-0.5 text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
          data-testid={`artifact-open-${artifact.name}`}
        >
          <Icon icon={ChevronRight} size={11} />
        </button>
      </div>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function LongChatRow({ chat }: { chat: LongChatTask }) {
  const { t } = useTranslation();
  return (
    <li>
      <Link
        to="/chat"
        search={{ session: chat.id } as never}
        className="group flex items-center gap-3 rounded-lg border border-border bg-bg-elev-1 p-3 transition hover:border-gold-500/40 hover:bg-bg-elev-2"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-elev-2 text-fg-muted">
          <Icon icon={MessageSquare} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{chat.title}</span>
            <span className="rounded-full border border-border bg-bg-elev-2 px-1.5 py-0.5 text-[10px] font-mono text-fg-subtle">
              {t('tasks.long_chat_messages', {
                defaultValue: `${chat.messageCount} 条消息`,
                count: chat.messageCount,
              })}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
            <span>
              {t('tasks.long_chat_user_turns', {
                defaultValue: `${chat.userTurns} 轮提问`,
                count: chat.userTurns,
              })}
            </span>
            {chat.model && <span className="font-mono">· {chat.model}</span>}
            <span>·</span>
            <span>{formatTime(chat.updatedAt)}</span>
          </div>
        </div>
        <Icon icon={ChevronRight} size={14} className="text-fg-subtle group-hover:text-fg" />
      </Link>
    </li>
  );
}
