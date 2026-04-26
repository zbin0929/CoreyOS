import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  schedulerUpsertJob,
  schedulerValidateCron,
  type SchedulerJob,
  type SchedulerValidateResult,
} from '@/lib/ipc';

export function JobEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: SchedulerJob;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [cronExpression, setCronExpression] = useState(
    initial?.cron_expression ?? '0 0 9 * * *',
  );
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [validation, setValidation] = useState<SchedulerValidateResult | null>(null);

  // Live-validate cron expression with a small debounce.
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const r = await schedulerValidateCron(cronExpression);
        if (!cancelled) setValidation(r);
      } catch {
        // Validation is best-effort UI feedback — swallow transport errors.
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [cronExpression]);

  const nextFireLabel = useMemo(() => {
    if (!validation?.ok || !validation.next_fire_at) return null;
    return new Date(validation.next_fire_at * 1000).toLocaleString();
  }, [validation]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim() || !prompt.trim()) return;
    if (!validation?.ok) {
      setErr(validation?.error ?? t('scheduler_page.invalid_cron'));
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      await schedulerUpsertJob({
        id: initial?.id,
        name: name.trim(),
        cron_expression: cronExpression.trim(),
        prompt: prompt.trim(),
        adapter_id: initial?.adapter_id ?? 'hermes',
        enabled,
      });
      await onSaved();
    } catch (e2) {
      setErr(ipcErrorMessage(e2));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="scheduler-editor"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted" htmlFor="sched-name">
          {t('scheduler_page.field_name')}
        </label>
        <input
          id="sched-name"
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('scheduler_page.field_name_placeholder')}
          data-testid="scheduler-name-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted" htmlFor="sched-cron">
          {t('scheduler_page.field_cron')}
        </label>
        <input
          id="sched-cron"
          className="rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-accent focus:outline-none"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          placeholder="0 0 9 * * *"
          data-testid="scheduler-cron-input"
          spellCheck={false}
        />
        <div className="text-[11px] text-fg-subtle">
          {t('scheduler_page.cron_hint')}
        </div>
        {validation && (
          <div
            className={cn(
              'text-[11px]',
              validation.ok ? 'text-emerald-500' : 'text-danger',
            )}
            data-testid="scheduler-cron-validation"
          >
            {validation.ok ? (
              nextFireLabel ? (
                <>
                  {t('scheduler_page.next_fire')}: {nextFireLabel}
                  {!validation.is_cron && (
                    <span className="ml-2 text-fg-subtle">
                      ({t('scheduler_page.hermes_extended')})
                    </span>
                  )}
                </>
              ) : (
                <>
                  {t('scheduler_page.cron_valid')}
                  {!validation.is_cron && (
                    <span className="ml-2 text-fg-subtle">
                      ({t('scheduler_page.hermes_extended')})
                    </span>
                  )}
                </>
              )
            ) : (
              validation.error
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted" htmlFor="sched-prompt">
          {t('scheduler_page.field_prompt')}
        </label>
        <textarea
          id="sched-prompt"
          rows={4}
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('scheduler_page.field_prompt_placeholder')}
          data-testid="scheduler-prompt-input"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-testid="scheduler-enabled-input"
        />
        {t('scheduler_page.field_enabled')}
      </label>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={saving || !validation?.ok || !name.trim() || !prompt.trim()}
          data-testid="scheduler-save"
        >
          {saving && <Icon icon={Loader2} size="xs" className="animate-spin" />}
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
