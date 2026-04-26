import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Pause, Play, Trash2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { SchedulerJob } from '@/lib/ipc';

export function JobCard({
  job,
  onEdit,
  onShowRuns,
  onToggle,
  onDelete,
}: {
  job: SchedulerJob;
  onEdit: () => void;
  onShowRuns: () => void;
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
            onClick={onShowRuns}
            title={t('scheduler_page.show_runs')}
            data-testid={`scheduler-runs-${job.id}`}
          >
            <Icon icon={Clock} size="xs" />
          </Button>
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
