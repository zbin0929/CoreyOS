import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/cn';

interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  workspace_path: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
}

interface KanbanStats {
  triage: number;
  todo: number;
  ready: number;
  running: number;
  blocked: number;
  done: number;
}

const statusConfig: Record<
  string,
  { label: string; color: string; iconClass: string; Icon: typeof RefreshCw }
> = {
  triage: {
    label: '待分类',
    color: 'bg-bg-elev-2',
    iconClass: 'text-fg-muted',
    Icon: AlertCircle,
  },
  todo: {
    label: '待办',
    color: 'bg-bg-elev-2',
    iconClass: 'text-blue-500',
    Icon: Clock,
  },
  ready: {
    label: '就绪',
    color: 'bg-bg-elev-2',
    iconClass: 'text-yellow-500',
    Icon: Play,
  },
  running: {
    label: '执行中',
    color: 'bg-bg-elev-2',
    iconClass: 'text-purple-500',
    Icon: RefreshCw,
  },
  blocked: {
    label: '阻塞',
    color: 'bg-bg-elev-2',
    iconClass: 'text-danger',
    Icon: AlertCircle,
  },
  done: {
    label: '完成',
    color: 'bg-bg-elev-2',
    iconClass: 'text-green-500',
    Icon: CheckCircle2,
  },
};

export default function KanbanPage() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [stats, setStats] = useState<KanbanStats | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newBody, setNewBody] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [taskList, statData, assigneeList] = await Promise.all([
        invoke<KanbanTask[]>('kanban_list'),
        invoke<KanbanStats>('kanban_stats'),
        invoke<string[]>('kanban_assignees'),
      ]);
      setTasks(taskList);
      setStats(statData);
      setAssignees(assigneeList);
    } catch (e) {
      console.error('Failed to fetch kanban data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      await invoke('kanban_create', {
        title: newTitle,
        assignee: newAssignee || null,
        body: newBody || null,
      });
      setNewTitle('');
      setNewAssignee('');
      setNewBody('');
      setCreateOpen(false);
      fetchData();
    } catch (e) {
      console.error('Failed to create task:', e);
    }
  };

  const handleComplete = async (taskId: string) => {
    try {
      await invoke('kanban_complete', { taskId, result: null });
      fetchData();
    } catch (e) {
      console.error('Failed to complete task:', e);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const columns = ['ready', 'running', 'done'];

  const assigneeOptions: SelectOption[] = assignees.map((a) => ({
    value: a,
    label: a,
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">多 Agent 协作</h1>
          <p className="text-sm text-fg-muted">
            Hermes Kanban 任务板 — 分配任务给不同专家 Profile
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建任务
          </Button>
        </div>
      </div>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建任务"
        side="right"
      >
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-fg">任务标题</label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：分析产品 B0XXXXXX 的市场规模"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-fg">分配给</label>
            <Select
              value={newAssignee}
              onChange={setNewAssignee}
              options={assigneeOptions}
              placeholder="选择专家 Profile"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-fg">任务描述（可选）</label>
            <Textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="详细描述任务要求..."
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!newTitle.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Drawer>

      {stats && (
        <div className="grid grid-cols-6 gap-4 border-b border-border px-6 py-4">
          {Object.entries(statusConfig).map(([key, config]) => {
            const IconComp = config.Icon;
            return (
              <Card key={key} className="p-3">
                <div className="flex items-center gap-2">
                  <IconComp className={cn('h-4 w-4', config.iconClass)} />
                  <span className="text-sm font-medium text-fg">{config.label}</span>
                </div>
                <div className="mt-1 text-2xl font-bold text-fg">
                  {stats[key as keyof KanbanStats]}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-fg-muted" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-fg-muted">
            <Users className="mb-4 h-16 w-16" />
            <p className="text-lg">暂无任务</p>
            <p className="text-sm">点击「新建任务」创建第一个多 Agent 协作任务</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {columns.map((col) => {
              const colConfig = statusConfig[col];
              const ColIcon = colConfig?.Icon;
              return (
                <div key={col} className="space-y-4">
                  <div className="flex items-center gap-2">
                    {ColIcon && <ColIcon className={cn('h-4 w-4', colConfig.iconClass)} />}
                    <h2 className="font-semibold text-fg">{colConfig?.label}</h2>
                    <span className="rounded bg-bg-elev-2 px-2 py-0.5 text-xs text-fg-muted">
                      {tasks.filter((t) => t.status === col).length}
                    </span>
                  </div>
                <div className="space-y-3">
                  {tasks
                    .filter((t) => t.status === col)
                    .map((task) => (
                      <Card key={task.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-fg">{task.title}</h3>
                            {task.body && (
                              <p className="mt-1 text-sm text-fg-muted line-clamp-2">
                                {task.body}
                              </p>
                            )}
                          </div>
                          {task.status === 'running' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleComplete(task.id)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
                          {task.assignee && (
                            <span
                              className={cn(
                                'rounded border px-2 py-0.5',
                                task.assignee.startsWith('ecom-')
                                  ? 'border-gold-500/30 bg-gold-500/10 text-gold-500'
                                  : 'border-border bg-bg-elev-2'
                              )}
                            >
                              {task.assignee}
                            </span>
                          )}
                          <span>{formatTime(task.created_at)}</span>
                        </div>
                        {task.result && (
                          <div className="mt-2 rounded bg-bg-elev-2 p-2 text-xs text-fg-muted">
                            {task.result}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
