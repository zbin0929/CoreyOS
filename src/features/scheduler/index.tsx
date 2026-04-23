import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  schedulerDeleteJob,
  schedulerListJobs,
  schedulerUpsertJob,
  schedulerValidateCron,
  type SchedulerJob,
  type SchedulerValidateResult,
} from '@/lib/ipc';

/**
 * Scheduler page (2026-04-23) — cron-driven prompt runs.
 *
 * MVP scope:
 *  - List all scheduled jobs with status (enabled, last run).
 *  - Create / edit / delete jobs.
 *  - Live cron-expression validation with "next fire at" preview.
 *  - Enable/disable toggle without needing to reopen the editor.
 *
 * Deferred:
 *  - Natural-language → cron translation (requires LLM round-trip).
 *  - Per-job run history table (DB only persists last_run_* today).
 *  - Per-job adapter picker (currently hard-coded to Hermes).
 */

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; job: SchedulerJob };

export function SchedulerRoute() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SchedulerJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const jobs = await schedulerListJobs();
      setRows(jobs);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('scheduler_page.title')}
        subtitle={t('scheduler_page.subtitle')}
        actions={
          mode.kind === 'list' && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setMode({ kind: 'new' })}
              data-testid="scheduler-new"
            >
              <Icon icon={Plus} size="sm" />
              {t('scheduler_page.new')}
            </Button>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span>{error}</span>
            </div>
          )}

          {(mode.kind === 'new' || mode.kind === 'edit') && (
            <JobEditor
              initial={mode.kind === 'edit' ? mode.job : undefined}
              onCancel={() => setMode({ kind: 'list' })}
              onSaved={async () => {
                setMode({ kind: 'list' });
                await load();
              }}
            />
          )}

          {mode.kind === 'list' &&
            (rows === null ? (
              <div className="flex items-center gap-2 text-fg-muted">
                <Icon icon={Loader2} size="md" className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={t('scheduler_page.empty_title')}
                description={t('scheduler_page.empty_desc')}
              />
            ) : (
              <ul className="flex flex-col gap-2" data-testid="scheduler-list">
                {rows.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    onEdit={() => setMode({ kind: 'edit', job: j })}
                    onToggle={async () => {
                      try {
                        await schedulerUpsertJob({
                          id: j.id,
                          name: j.name,
                          cron_expression: j.cron_expression,
                          prompt: j.prompt,
                          adapter_id: j.adapter_id,
                          enabled: !j.enabled,
                        });
                        await load();
                      } catch (e) {
                        setError(ipcErrorMessage(e));
                      }
                    }}
                    onDelete={async () => {
                      try {
                        await schedulerDeleteJob(j.id);
                        await load();
                      } catch (e) {
                        setError(ipcErrorMessage(e));
                      }
                    }}
                  />
                ))}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Card ─────────────────────────

function JobCard({
  job,
  onEdit,
  onToggle,
  onDelete,
}: {
  job: SchedulerJob;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const lastRunLabel = job.last_run_at
    ? new Date(job.last_run_at * 1000).toLocaleString()
    : t('scheduler_page.never_run');

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border p-3',
        job.enabled
          ? 'border-border bg-bg-elev-1'
          : 'border-border/50 bg-bg-elev-1/50',
      )}
      data-testid={`scheduler-row-${job.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'text-sm font-medium',
                job.enabled ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {job.name}
            </span>
            {!job.enabled && (
              <span className="rounded bg-bg-elev-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                {t('scheduler_page.disabled')}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-fg-muted">
            {job.cron_expression}
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-fg-subtle">{job.prompt}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggle}
            title={job.enabled ? t('scheduler_page.pause') : t('scheduler_page.resume')}
            data-testid={`scheduler-toggle-${job.id}`}
          >
            <Icon icon={job.enabled ? Pause : Play} size="xs" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            data-testid={`scheduler-edit-${job.id}`}
          >
            {t('common.edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            data-testid={`scheduler-delete-${job.id}`}
          >
            <Icon icon={Trash2} size="xs" className="text-danger" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
        {job.last_run_ok === true && (
          <Icon icon={CheckCircle2} size="xs" className="text-emerald-500" />
        )}
        {job.last_run_ok === false && (
          <Icon icon={XCircle} size="xs" className="text-danger" />
        )}
        <span>
          {t('scheduler_page.last_run')}: {lastRunLabel}
        </span>
        {job.last_run_error && (
          <span className="truncate text-danger" title={job.last_run_error}>
            · {job.last_run_error}
          </span>
        )}
      </div>
    </li>
  );
}

// ───────────────────────── Editor ─────────────────────────

function JobEditor({
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
            {validation.ok
              ? nextFireLabel
                ? `${t('scheduler_page.next_fire')}: ${nextFireLabel}`
                : t('scheduler_page.cron_valid')
              : validation.error}
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
