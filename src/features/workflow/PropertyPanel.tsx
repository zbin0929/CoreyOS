import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { llmProfileList, type LlmProfile, type WorkflowStep } from '@/lib/ipc';
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
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);

  useEffect(() => {
    setLocal(step);
  }, [step]);

  // Load LLM profiles once. The list rarely changes during a single
  // editor session and the IPC is cheap, so we don't bother
  // re-fetching on every step selection. Failures fall back to an
  // empty list — the user just sees "default" as the only option,
  // which is the pre-T8 behaviour.
  useEffect(() => {
    void llmProfileList()
      .then((view) => setProfiles(view.profiles))
      .catch(() => setProfiles([]));
  }, []);

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
          {/* LLM Profile picker. The agent_id field doubles as the
              adapter routing key:
                - "" / "hermes-default" → built-in Hermes default agent
                - "hermes:profile:<id>" → routes through a saved
                  LLM Profile (deepseek / glm / minimax / …)
              The legacy raw-input fallback below stays so old
              workflow YAMLs that hard-coded `agent_id: hermes-foo`
              still load + edit cleanly. */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">
              {t('workflow_page.agent_profile_label', { defaultValue: '使用 LLM' })}
            </span>
            <Select
              value={agentIdToSelectValue(local.agent_id ?? '')}
              onChange={(v) =>
                set('agent_id', selectValueToAgentId(v) || undefined)
              }
              options={[
                { value: '__default__', label: t('workflow_page.agent_profile_default', { defaultValue: '默认（Hermes Agent）' }) },
                ...profiles.map((p) => ({
                  value: `__profile__${p.id}`,
                  label: profileLabel(p),
                })),
                { value: '__custom__', label: t('workflow_page.agent_profile_custom', { defaultValue: '自定义 Agent ID' }) },
              ]}
              ariaLabel={t('workflow_page.agent_profile_label', { defaultValue: '使用 LLM' })}
            />
          </label>

          {/* Custom-ID fallback: only shown when the user picks
              "Custom" or the existing agent_id doesn't match any
              known profile (e.g. legacy yaml). Plain text input;
              users entering this expert mode know what they're
              doing. */}
          {agentIdToSelectValue(local.agent_id ?? '') === '__custom__' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">Agent ID</span>
              <Input
                value={local.agent_id ?? ''}
                onChange={(e) => set('agent_id', e.target.value || undefined)}
                placeholder="hermes-default"
                className="text-xs"
              />
            </label>
          )}
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
            {/* rows=6 because the approval card renders this verbatim
                and 2 lines of editor often hides the body. The runtime
                view supports `{{inputs.x}}` and `{{<step>.output.y}}`
                substitution, so a paragraph or two of context is the
                norm. */}
            <Textarea
              rows={6}
              value={local.approval_message ?? ''}
              onChange={(e) => set('approval_message', e.target.value || undefined)}
              placeholder="向审批人解释要批什么。可使用 {{inputs.xxx}} 和 {{<step>.output.yyy}} 占位符。"
              className="text-xs"
            />
            <span className="text-[10px] text-fg-muted">
              {t('workflow_page.approval_message_hint', {
                defaultValue:
                  '运行到此步骤会暂停，等待审批人通过 / 驳回；驳回会终止整条流程。',
              })}
            </span>
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

// ───────────────────────── helpers ─────────────────────────

/**
 * Map a stored `step.agent_id` value to the picker's option value.
 *
 *   ""              → "__default__"  (no profile, fall back to hermes default agent)
 *   "hermes-default"→ "__default__"  (legacy explicit-default; same outcome)
 *   "hermes:profile:deepseek" → "__profile__deepseek"
 *   "anything-else" → "__custom__"   (raw text input revealed below)
 */
function agentIdToSelectValue(agentId: string): string {
  if (agentId === '' || agentId === 'hermes-default' || agentId === 'hermes') {
    return '__default__';
  }
  if (agentId.startsWith('hermes:profile:')) {
    return `__profile__${agentId.slice('hermes:profile:'.length)}`;
  }
  return '__custom__';
}

/**
 * Inverse of `agentIdToSelectValue`. The "__custom__" sentinel is
 * intentionally NOT mapped — when the user picks Custom we leave the
 * existing agent_id untouched and let the raw input below take over.
 */
function selectValueToAgentId(value: string): string {
  if (value === '__default__') return 'hermes-default';
  if (value.startsWith('__profile__')) {
    return `hermes:profile:${value.slice('__profile__'.length)}`;
  }
  // "__custom__" or unknown — return empty so the raw input below
  // shows its placeholder hint and the user can type a fresh value.
  return '';
}

/** Human-readable profile label: "label · model" if both present,
 *  otherwise fall back to id so we always have *something* to render. */
function profileLabel(p: LlmProfile): string {
  const lbl = (p.label || p.id).trim();
  const m = (p.model || '').trim();
  return m ? `${lbl} · ${m}` : lbl;
}
