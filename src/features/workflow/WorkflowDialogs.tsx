import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { WorkflowDef, WorkflowSummary } from '@/lib/ipc';

export function RejectReasonDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-bg-elev-1 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-fg">{t('workflow_page.reject_dialog_title', { defaultValue: '驳回原因' })}</h2>
        <p className="mt-1 text-xs text-fg-subtle">{t('workflow_page.reject_dialog_subtitle', { defaultValue: '驳回会终止整个工作流，并把原因写入审计报告。可留空。' })}</p>
        <textarea autoFocus rows={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('workflow_page.reject_dialog_placeholder', { defaultValue: '例如：折扣率超过本季度预算上限，需要重新核算。' })} className={cn('mt-4 w-full resize-none rounded-md border border-border bg-bg-elev-2', 'px-3 py-2 text-sm text-fg placeholder:text-fg-subtle/60', 'focus:outline-none focus:ring-2 focus:ring-amber-500/40')} />
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('workflow_page.inputs_cancel')}</Button>
          <Button variant="primary" size="sm" onClick={() => onSubmit(reason)}>{t('workflow_page.reject_dialog_submit', { defaultValue: '确认驳回' })}</Button>
        </div>
      </div>
    </div>
  );
}

export function InputsPromptDialog({
  wf,
  def,
  onCancel,
  onSubmit,
}: {
  wf: WorkflowSummary;
  def: WorkflowDef;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const inp of def.inputs) init[inp.name] = inp.default ?? '';
    return init;
  });
  const [touched, setTouched] = useState(false);

  const missingRequired = def.inputs.filter((inp) => inp.required && !values[inp.name]?.trim());

  const submit = () => {
    setTouched(true);
    if (missingRequired.length > 0) return;
    const out: Record<string, unknown> = {};
    for (const inp of def.inputs) {
      const raw = values[inp.name] ?? '';
      if (inp.type === 'number') {
        const n = Number(raw);
        out[inp.name] = Number.isFinite(n) ? n : raw;
      } else {
        out[inp.name] = raw;
      }
    }
    onSubmit(out);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg-elev-1 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-fg">{wf.name}</h2>
        <p className="mt-1 text-xs text-fg-subtle">{t('workflow_page.inputs_dialog_subtitle')}</p>
        <div className="mt-5 space-y-4">
          {def.inputs.map((inp) => {
            const isMissing = touched && inp.required && !values[inp.name]?.trim();
            return (
              <div key={inp.name} className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-medium text-fg">
                  {inp.label || inp.name}
                  {inp.required && <span className="text-[10px] font-normal text-amber-500">* {t('workflow_page.inputs_required')}</span>}
                </label>
                {inp.options && inp.options.length > 0 ? (
                  <select value={values[inp.name] ?? ''} onChange={(e) => setValues((p) => ({ ...p, [inp.name]: e.target.value }))} className={cn('w-full rounded-md border bg-bg-elev-2 px-3 py-2 text-sm text-fg outline-none', isMissing ? 'border-red-500/60' : 'border-border')}>
                    <option value="">—</option>
                    {inp.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={inp.type === 'number' ? 'number' : 'text'} value={values[inp.name] ?? ''} onChange={(e) => setValues((p) => ({ ...p, [inp.name]: e.target.value }))} placeholder={inp.default ?? ''} className={cn('w-full rounded-md border bg-bg-elev-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle/60', isMissing ? 'border-red-500/60' : 'border-border')} />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{t('workflow_page.inputs_cancel')}</Button>
          <Button variant="primary" onClick={submit}><Icon icon={Play} size="xs" />{t('workflow_page.inputs_start')}</Button>
        </div>
      </div>
    </div>
  );
}
