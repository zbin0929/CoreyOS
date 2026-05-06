import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, Workflow as WorkflowIcon, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { workflowHistoryList, type WorkflowRunSummary } from '@/lib/ipc';

import { EmptyHint, WidgetCard } from './shared';

const VISIBLE = 5;

/** Last 5 completed workflow runs (any status) — gives users a
 *  one-click jump back into the run that produced an artifact. */
export function RecentWorkflowsWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<WorkflowRunSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    workflowHistoryList(undefined, VISIBLE)
      .then((list) => {
        if (alive) setRows(list);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <WidgetCard
      id="recent_workflows"
      title={t('home.widget_recent_workflows', { defaultValue: '最近运行' })}
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void navigate({ to: '/tasks' })}
        >
          {t('home.view_all')}
          <Icon icon={ArrowRight} size="xs" />
        </Button>
      }
    >
      {loaded && rows.length === 0 ? (
        <EmptyHint
          icon={WorkflowIcon}
          text={t('home.widget_recent_workflows_empty', {
            defaultValue: '尚未运行过任何工作流',
          })}
        />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => {
            const ok = r.status === 'completed';
            const failed = r.status === 'failed' || r.status === 'cancelled';
            const stamp = r.updated_at ?? r.started_at;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void navigate({ to: '/tasks' })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-bg-elev-2"
                >
                  <span
                    className={
                      ok
                        ? 'flex h-6 w-6 flex-none items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500'
                        : failed
                          ? 'flex h-6 w-6 flex-none items-center justify-center rounded-md bg-danger/10 text-danger'
                          : 'flex h-6 w-6 flex-none items-center justify-center rounded-md bg-fg-subtle/10 text-fg-subtle'
                    }
                  >
                    <Icon icon={failed ? XCircle : CheckCircle2} size="xs" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {r.workflow_id}
                  </span>
                  <span className="text-[10px] text-fg-subtle">
                    {stamp ? new Date(stamp).toLocaleDateString() : '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
