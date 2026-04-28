import { useTranslation } from 'react-i18next';
import {
  History as HistoryIcon,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { Sparkles } from 'lucide-react';
import type { WorkflowDef, WorkflowSummary } from '@/lib/ipc';
import { WorkflowGenerateDialog } from './GenerateDialog';
import { InputsPromptDialog, RejectReasonDialog } from './WorkflowDialogs';

export function WorkflowList({
  rows,
  error,
  selected,
  setSelected,
  running,
  onDelete,
  onDeleteSelected,
  onRun,
  onEdit,
  onHistory,
  onCreate,
  generateOpen,
  setGenerateOpen,
  onGenerated,
  inputsPrompt,
  setInputsPrompt,
  startRun,
  rejectPrompt,
  setRejectPrompt,
  submitApproval,
}: {
  rows: WorkflowSummary[] | null;
  error: string | null;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  running: boolean;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
  onRun: (wf: WorkflowSummary) => void;
  onEdit: (wfId: string) => void;
  onHistory: () => void;
  onCreate: () => void;
  generateOpen: boolean;
  setGenerateOpen: (v: boolean) => void;
  onGenerated: (def: WorkflowDef) => void;
  inputsPrompt: { wf: WorkflowSummary; def: WorkflowDef } | null;
  setInputsPrompt: (v: { wf: WorkflowSummary; def: WorkflowDef } | null) => void;
  startRun: (wf: WorkflowSummary, def: WorkflowDef, inputs: Record<string, unknown>) => Promise<void>;
  rejectPrompt: { stepId: string } | null;
  setRejectPrompt: (v: { stepId: string } | null) => void;
  submitApproval: (stepId: string, approved: boolean, feedback?: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('workflow_page.title')}
        subtitle={t('workflow_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button variant="ghost" onClick={() => void onDeleteSelected()}>
                <Icon icon={Trash2} size="xs" className="text-red-500" />
                {t('workflow_page.delete_selected', { count: selected.size })}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setGenerateOpen(true)} data-testid="workflow-generate-open">
              <Icon icon={Sparkles} size="xs" className="text-gold-500" />
              {t('workflow_page.generate')}
            </Button>
            <Button variant="ghost" onClick={onHistory}>
              <Icon icon={HistoryIcon} size="xs" />
              {t('workflow_page.history_button', { defaultValue: '历史' })}
            </Button>
            <Button variant="secondary" onClick={onCreate}>
              <Icon icon={Plus} size="xs" />
              {t('workflow_page.create')}
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">{error}</div>
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 text-fg-subtle">
            <Icon icon={Loader2} size="md" className="animate-spin" />
            <span>{t('workflow_page.loading')}</span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Workflow} title={t('workflow_page.empty_title')} description={t('workflow_page.empty_desc')} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((wf) => (
              <div key={wf.id} className="group rounded-xl border border-border bg-bg-elev-1 p-5 transition-colors hover:border-gold-500/30">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <input type="checkbox" checked={selected.has(wf.id)} onChange={(e) => { setSelected(new Set(e.target.checked ? [...selected, wf.id] : [...selected].filter((id) => id !== wf.id))); }} className="mt-1 shrink-0 accent-gold-500" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-fg">{wf.name}</h3>
                      {wf.description && <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{wf.description}</p>}
                    </div>
                  </div>
                  <span className={cn('ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs', wf.trigger_type === 'cron' ? 'bg-blue-500/10 text-blue-500' : 'bg-fg-subtle/10 text-fg-subtle')}>
                    {wf.trigger_type === 'cron' ? '⏰ Cron' : '👆 Manual'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
                  <span>{t('workflow_page.steps_count', { count: wf.step_count })}</span>
                  <span>·</span>
                  <span>v{wf.version}</span>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onEdit(wf.id)}>
                    <Icon icon={Pencil} size="xs" />{t('workflow_page.edit')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onRun(wf)} disabled={running}>
                    <Icon icon={Play} size="xs" />{t('workflow_page.run')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void onDelete(wf.id)}>
                    <Icon icon={Trash2} size="xs" className="text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <WorkflowGenerateDialog open={generateOpen} onClose={() => setGenerateOpen(false)} onGenerated={onGenerated} />
      {inputsPrompt && (
        <InputsPromptDialog wf={inputsPrompt.wf} def={inputsPrompt.def} onCancel={() => setInputsPrompt(null)} onSubmit={(values: Record<string, unknown>) => { const target = inputsPrompt; setInputsPrompt(null); void startRun(target.wf, target.def, values); }} />
      )}
      {rejectPrompt && (
        <RejectReasonDialog onCancel={() => setRejectPrompt(null)} onSubmit={(reason: string) => { const target = rejectPrompt; setRejectPrompt(null); void submitApproval(target.stepId, false, reason); }} />
      )}
    </div>
  );
}
