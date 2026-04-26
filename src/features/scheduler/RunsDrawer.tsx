import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { SchedulerJob, SchedulerRunInfo } from '@/lib/ipc';

import { formatBytes } from './formatBytes';

export function RunsDrawer({
  job,
  runs,
  error,
  onClose,
}: {
  job: SchedulerJob;
  runs: SchedulerRunInfo[] | null;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      data-testid="scheduler-runs-drawer"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon icon={Clock} size="md" className="text-fg-muted" />
          <span className="text-sm font-medium text-fg">
            {t('scheduler_page.runs_title', { name: job.name })}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          data-testid="scheduler-runs-close"
        >
          <Icon icon={XCircle} size="xs" />
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <Icon icon={AlertCircle} size="xs" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {runs === null ? (
        <div className="flex items-center gap-2 text-fg-muted">
          <Icon icon={Loader2} size="md" className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-fg-subtle">
          {t('scheduler_page.runs_empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((r) => (
            <li
              key={r.name}
              className="rounded-md border border-border/50 bg-bg-elev-2 p-2 text-xs"
              data-testid={`scheduler-run-${r.name}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-fg-muted">{r.name}</span>
                <span className="text-fg-subtle">
                  {new Date(r.modified_at * 1000).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-fg-subtle">
                {t('scheduler_page.run_size', { size: formatBytes(r.size_bytes) })}
              </div>
              <div className="mt-1 max-h-24 overflow-y-auto rounded border border-border/30 bg-bg-elev-3 p-1.5 text-[11px] text-fg-subtle">
                <pre className="whitespace-pre-wrap break-words">{r.preview}</pre>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
