import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, ListChecks, Loader2, PauseCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useTasksStore } from '@/stores/tasks';

import { EmptyHint, WidgetCard } from './shared';

const VISIBLE = 5;

/** Live count of running + paused workflow runs, with the top 5
 *  rows inline. Reads from the polling `useTasksStore`. */
export function TasksActiveWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const active = useTasksStore((s) => s.active);
  const refresh = useTasksStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = active.slice(0, VISIBLE);

  return (
    <WidgetCard
      id="tasks_active"
      title={t('home.widget_tasks_active', { defaultValue: '正在运行的任务' })}
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
      {rows.length === 0 ? (
        <EmptyHint
          icon={ListChecks}
          text={t('home.widget_tasks_empty', {
            defaultValue: '当前没有运行中的任务',
          })}
        />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => {
            const isPaused = r.status === 'paused';
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void navigate({ to: '/tasks' })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-bg-elev-2"
                >
                  <span
                    className={
                      isPaused
                        ? 'flex h-6 w-6 flex-none items-center justify-center rounded-md bg-amber-500/10 text-amber-500'
                        : 'flex h-6 w-6 flex-none items-center justify-center rounded-md bg-blue-500/10 text-blue-500'
                    }
                  >
                    <Icon
                      icon={isPaused ? PauseCircle : Loader2}
                      size="xs"
                      className={isPaused ? '' : 'animate-spin'}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {r.workflow_id}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    {r.status}
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
