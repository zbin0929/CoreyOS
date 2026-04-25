import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowStep } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Trash2 } from 'lucide-react';

interface Props {
  step: WorkflowStep | null;
  onUpdate: (updated: WorkflowStep) => void;
  onDelete: (id: string) => void;
}

const STEP_TYPES = ['agent', 'tool', 'parallel', 'branch', 'loop', 'approval'] as const;

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
        <input
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          value={local.id}
          onChange={(e) => set('id', e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.step_name')}</span>
        <input
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          value={local.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.step_type')}</span>
        <select
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          value={st}
          onChange={(e) => set('type', e.target.value as typeof st)}
        >
          {STEP_TYPES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>

      {st === 'agent' && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Agent ID</span>
            <input
              className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
              value={local.agent_id ?? ''}
              onChange={(e) => set('agent_id', e.target.value || undefined)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Prompt</span>
            <textarea
              className="h-24 rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
              value={local.prompt ?? ''}
              onChange={(e) => set('prompt', e.target.value || undefined)}
            />
          </label>
        </>
      )}

      {st === 'tool' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">Tool Name</span>
          <input
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
            value={local.tool_name ?? ''}
            onChange={(e) => set('tool_name', e.target.value || undefined)}
          />
        </label>
      )}

      {st === 'branch' && (
        <div className="rounded border border-border p-2">
          <span className="text-xs text-fg-subtle">{t('workflow_page.conditions')}</span>
          {(local.conditions ?? []).map((c, i) => (
            <div key={i} className="mt-1 flex gap-1">
              <input
                className="flex-1 rounded border border-border bg-bg px-1 py-0.5 text-[10px] text-fg"
                value={c.expression}
                placeholder="expression"
                onChange={(e) => {
                  const next = [...(local.conditions ?? [])];
                  next[i] = { expression: e.target.value, goto: next[i]?.goto ?? '' };
                  set('conditions', next);
                }}
              />
              <span className="text-[10px] text-fg-subtle">→</span>
              <input
                className="w-16 rounded border border-border bg-bg px-1 py-0.5 text-[10px] text-fg"
                value={c.goto}
                placeholder="step id"
                onChange={(e) => {
                  const next = [...(local.conditions ?? [])];
                  next[i] = { expression: next[i]?.expression ?? '', goto: e.target.value };
                  set('conditions', next);
                }}
              />
            </div>
          ))}
        </div>
      )}

      {st === 'loop' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('workflow_page.max_iterations')}</span>
          <input
            type="number"
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
            value={local.max_iterations ?? 3}
            onChange={(e) => set('max_iterations', Number(e.target.value))}
          />
        </label>
      )}

      {st === 'approval' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('workflow_page.timeout_min')}</span>
          <input
            type="number"
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
            value={local.timeout_minutes ?? 1440}
            onChange={(e) => set('timeout_minutes', Number(e.target.value))}
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-fg-subtle">{t('workflow_page.output_format')}</span>
        <select
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          value={local.output_format ?? 'text'}
          onChange={(e) => set('output_format', e.target.value)}
        >
          <option value="text">text</option>
          <option value="json">json</option>
          <option value="markdown">markdown</option>
        </select>
      </label>
    </div>
  );
}
