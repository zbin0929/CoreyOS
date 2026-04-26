import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, Loader2, Plus } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  ipcErrorMessage,
  schedulerDeleteJob,
  schedulerListJobs,
  schedulerListRuns,
  schedulerUpsertJob,
  type SchedulerJob,
  type SchedulerRunInfo,
} from '@/lib/ipc';

import { JobCard } from './JobCard';
import { JobEditor } from './JobEditor';
import { RunsDrawer } from './RunsDrawer';

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
 *
 * Subcomponents live in siblings: `JobCard.tsx`, `JobEditor.tsx`,
 * `RunsDrawer.tsx`; the lone byte-format helper is in `formatBytes.ts`.
 */

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; job: SchedulerJob }
  | { kind: 'runs'; job: SchedulerJob };

export function SchedulerRoute() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SchedulerJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [runs, setRuns] = useState<SchedulerRunInfo[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);

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
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('scheduler_page.title')}
              content={t('scheduler_page.help_page')}
              testId="scheduler-help"
            />
            {mode.kind === 'list' && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setMode({ kind: 'new' })}
                data-testid="scheduler-new"
              >
                <Icon icon={Plus} size="sm" />
                {t('scheduler_page.new')}
              </Button>
            )}
          </div>
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

          {mode.kind === 'runs' && (
            <RunsDrawer
              job={mode.job}
              runs={runs}
              error={runsError}
              onClose={() => setMode({ kind: 'list' })}
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
                    onShowRuns={async () => {
                      setMode({ kind: 'runs', job: j });
                      setRuns(null);
                      setRunsError(null);
                      try {
                        const r = await schedulerListRuns(j.id);
                        setRuns(r);
                      } catch (e) {
                        setRunsError(ipcErrorMessage(e));
                      }
                    }}
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
