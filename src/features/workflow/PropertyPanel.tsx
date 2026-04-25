import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowStep } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';

interface Props {
  step: WorkflowStep | null;
  onUpdate: (updated: WorkflowStep) => void;
  onDelete: (id: string) => void;
}

const STEP_TYPES = [
  { value: 'agent', label: '🤖 Agent', hint: 'AI Agent 执行任务' },
  { value: 'tool', label: '🔧 Tool', hint: '调用工具' },
  { value: 'browser', label: '🌐 Browser', hint: '浏览器自动化' },
  { value: 'parallel', label: '⚡ Parallel', hint: '并行执行' },
  { value: 'branch', label: '🔀 Branch', hint: '条件分支' },
  { value: 'loop', label: '🔄 Loop', hint: '循环执行' },
  { value: 'approval', label: '✋ Approval', hint: '人工审批' },
] as const;

const OUTPUT_FORMATS = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
] as const;

export function PropertyPanel({ step, onUpdate, onDelete }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<WorkflowStep | null>(null);

  useEffect(() => {
    setLocal(step);
  }, [step]);

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-fg-subtle">
        {t('workflow_page.select_step')}
      </div>
    );
  }

  const set = <K extends keyof WorkflowStep>(key: K, value: WorkflowStep[K]) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    onUpdate(next);
  };

  const st = local.type;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">{t('workflow_page.step_props')}</h3>
        <Button variant="ghost" size="sm" onClick={() => onDelete(local.id)}>
          <Icon icon={Trash2} size="xs" className="text-red-500" />
        </Button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">ID</span>
        <Input
          value={local.id}
          onChange={(e) => set('id', e.target.value)}
          className="text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.step_name')}</span>
        <Input
          value={local.name}
          onChange={(e) => set('name', e.target.value)}
          className="text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.step_type')}</span>
        <Select
          value={st}
          onChange={(v) => set('type', v as typeof st)}
          options={[...STEP_TYPES]}
          ariaLabel={t('workflow_page.step_type')}
        />
      </label>

      {st === 'agent' && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Agent ID</span>
            <Input
              value={local.agent_id ?? ''}
              onChange={(e) => set('agent_id', e.target.value || undefined)}
              placeholder="hermes-default"
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Prompt</span>
            <Textarea
              rows={4}
              value={local.prompt ?? ''}
              onChange={(e) => set('prompt', e.target.value || undefined)}
              placeholder="输入提示词..."
              className="text-xs"
            />
          </label>
        </>
      )}

      {st === 'tool' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">Tool Name</span>
          <Input
            value={local.tool_name ?? ''}
            onChange={(e) => set('tool_name', e.target.value || undefined)}
            placeholder="web_search"
            className="text-xs"
          />
        </label>
      )}

      {st === 'browser' && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">URL</span>
            <Input
              value={local.tool_name ?? ''}
              onChange={(e) => set('tool_name', e.target.value || undefined)}
              placeholder="https://www.douyin.com"
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.browser_action')}</span>
            <Select
              value={local.agent_id ?? 'agent'}
              onChange={(v) => set('agent_id', v || undefined)}
              options={[
                { value: 'agent', label: 'Agent（多步自动）' },
                { value: 'act', label: 'Act（执行操作）' },
                { value: 'extract', label: 'Extract（提取数据）' },
                { value: 'observe', label: 'Observe（观察页面）' },
              ]}
              ariaLabel={t('workflow_page.browser_action')}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.browser_instruction')}</span>
            <Textarea
              rows={3}
              value={local.prompt ?? ''}
              onChange={(e) => set('prompt', e.target.value || undefined)}
              placeholder="搜索热门搞笑视频，提取前5个的标题和点赞数"
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.browser_profile')}</span>
            <Input
              value={local.browser_profile ?? ''}
              onChange={(e) => set('browser_profile', e.target.value || undefined)}
              placeholder="ups-session（留空则无状态）"
              className="text-xs"
            />
            <span className="text-[10px] text-fg-muted">{t('workflow_page.browser_profile_hint')}</span>
          </label>
        </>
      )}

      {st === 'branch' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <span className="text-xs font-medium text-fg-subtle">{t('workflow_page.conditions')}</span>
          {(local.conditions ?? []).map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                value={c.expression}
                placeholder="expression"
                onChange={(e) => {
                  const next = [...(local.conditions ?? [])];
                  next[i] = { expression: e.target.value, goto: next[i]?.goto ?? '' };
                  set('conditions', next);
                }}
                className="flex-1 text-[11px]"
              />
              <span className="text-xs text-fg-subtle">→</span>
              <Input
                value={c.goto}
                placeholder="step id"
                onChange={(e) => {
                  const next = [...(local.conditions ?? [])];
                  next[i] = { expression: next[i]?.expression ?? '', goto: e.target.value };
                  set('conditions', next);
                }}
                className="w-20 text-[11px]"
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = [...(local.conditions ?? []), { expression: '', goto: '' }];
              set('conditions', next);
            }}
          >
            + {t('workflow_page.add_condition')}
          </Button>
        </div>
      )}

      {st === 'loop' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('workflow_page.max_iterations')}</span>
          <Input
            type="number"
            value={local.max_iterations ?? 3}
            onChange={(e) => set('max_iterations', Number(e.target.value))}
            className="text-xs"
          />
        </label>
      )}

      {st === 'approval' && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.timeout_min')}</span>
            <Input
              type="number"
              value={local.timeout_minutes ?? 1440}
              onChange={(e) => set('timeout_minutes', Number(e.target.value))}
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.approval_message')}</span>
            <Textarea
              rows={2}
              value={local.approval_message ?? ''}
              onChange={(e) => set('approval_message', e.target.value || undefined)}
              placeholder="审批提示信息..."
              className="text-xs"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.output_format')}</span>
        <Select
          value={local.output_format ?? 'text'}
          onChange={(v) => set('output_format', v)}
          options={[...OUTPUT_FORMATS]}
          ariaLabel={t('workflow_page.output_format')}
        />
      </label>
    </div>
  );
}
