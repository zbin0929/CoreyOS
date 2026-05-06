import { useTranslation } from 'react-i18next';
import { Activity, CalendarClock, MessageSquare, Zap } from 'lucide-react';

import { useHomeLayoutStore } from '@/stores/homeLayout';
import { Icon } from '@/components/ui/icon';
import { EyeOff } from 'lucide-react';

import { useDashboard } from '../useDashboard';
import { MetricChip } from './shared';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Four chip-style metrics. Doesn't use `WidgetCard` because it's
 * intentionally bare — the chips are the chrome — but we still
 * support the edit-mode hide affordance via a small floating
 * button.
 */
export function MetricsTodayWidget() {
  const { t } = useTranslation();
  const editing = useHomeLayoutStore((s) => s.editing);
  const hide = useHomeLayoutStore((s) => s.hide);
  const { todayMessages, todayTokens, totalSessions, activeCronJobs } =
    useDashboard();
  return (
    <div
      className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-widget-id="metrics_today"
    >
      {editing && (
        <button
          type="button"
          onClick={() => hide('metrics_today')}
          className="absolute -top-3 right-0 inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-bg-elev-1 px-2 text-[10px] text-fg-subtle shadow transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          data-testid="widget-hide-metrics_today"
        >
          <Icon icon={EyeOff} size="xs" />
          <span>隐藏</span>
        </button>
      )}
      <MetricChip
        icon={MessageSquare}
        label={t('home.metric_messages_today')}
        value={String(todayMessages)}
        color="blue"
      />
      <MetricChip
        icon={Zap}
        label={t('home.metric_tokens_today')}
        value={fmtTokens(todayTokens)}
        color="amber"
      />
      <MetricChip
        icon={Activity}
        label={t('home.metric_total_sessions')}
        value={String(totalSessions)}
        color="emerald"
      />
      <MetricChip
        icon={CalendarClock}
        label={t('home.metric_cron_jobs')}
        value={String(activeCronJobs.length)}
        color="violet"
      />
    </div>
  );
}
