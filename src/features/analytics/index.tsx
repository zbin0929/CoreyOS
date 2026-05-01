import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Boxes, Coins, RefreshCcw, ThumbsUp, Wrench } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  analyticsSummary,
  ipcErrorMessage,
  type AnalyticsSummaryDto,
  type NamedCount,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/cn';

import {
  ActivityChart,
  Card,
  EmptyRow,
  ErrorBox,
  FeedbackStrip,
  HBarList,
  KpiStrip,
  SkeletonGrid,
} from './charts';
import { padLast30Days } from './utils';

/**
 * Analytics route (Phase 2 Sprint 1).
 *
 * Renders a single-shot rollup from `analytics_summary` — four KPIs, a
 * 30-day activity sparkline, top models, and top tools. Charts are custom
 * SVG (no Recharts etc.) so they respect the design tokens and add zero
 * bundle weight. Re-fetches on mount and on "Refresh" click.
 *
 * Subcomponents live in `charts.tsx` (all visual leaves — KpiStrip,
 * Card, ActivityChart, HBarList, FeedbackStrip, SkeletonGrid, ErrorBox,
 * EmptyRow). Pure helpers in `utils.ts`.
 */

type DateRange = 7 | 30 | 90 | 0;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: AnalyticsSummaryDto }
  | { kind: 'err'; message: string };

export function AnalyticsRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const [range, setRange] = useState<DateRange>(30);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await analyticsSummary(range || undefined);
      setState({ kind: 'loaded', data });
    } catch (e) {
      setState({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }, [range]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('analytics.title')}
              content={t('analytics.help_page')}
              testId="analytics-help"
            />
            <div className="flex items-center gap-1 rounded-md border border-border bg-bg-elev-1 px-1 py-0.5 text-xs">
              {([7, 30, 90, 0] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRange(d)}
                  className={cn(
                    'rounded px-2 py-0.5 transition-colors',
                    range === d ? 'bg-bg-elev-2 font-medium text-fg' : 'text-fg-subtle hover:text-fg',
                  )}
                >
                  {d === 0 ? t('analytics.range.all') : t('analytics.range.days', { d })}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={load} disabled={state.kind === 'loading'}>
              <Icon icon={RefreshCcw} size="sm" className={cn(state.kind === 'loading' && 'animate-spin')} />
              <span className="ml-1.5">{t('analytics.refresh')}</span>
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {state.kind === 'loading' && <SkeletonGrid />}
          {state.kind === 'err' && <ErrorBox message={state.message} onRetry={load} />}
          {state.kind === 'loaded' && <Dashboard data={state.data} />}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsSummaryDto }) {
  const { totals, messages_per_day, tokens_per_day, model_usage, tool_usage, adapter_usage } =
    data;
  const { t } = useTranslation();
  // T5.6 — remap raw adapter ids (`hermes` / `claude_code` / `aider`)
  // to their display names using the live registry snapshot. Falls
  // back to the raw id when the registry hasn't loaded yet so first
  // paint still renders something sensible.
  const adapters = useAgentsStore((s) => s.adapters);
  const adapterNameById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const a of adapters ?? []) out[a.id] = a.name;
    return out;
  }, [adapters]);
  const adapterUsageNamed = useMemo<NamedCount[]>(
    () =>
      adapter_usage.map((row) => ({
        name: adapterNameById[row.name] ?? row.name,
        count: row.count,
      })),
    [adapter_usage, adapterNameById],
  );

  const daily = useMemo(() => padLast30Days(messages_per_day), [messages_per_day]);
  const dailyTokens = useMemo(() => padLast30Days(tokens_per_day), [tokens_per_day]);
  const hasAnyActivity = totals.messages > 0;
  const hasAnyTokens = totals.total_tokens > 0;

  return (
    <div className="flex flex-col gap-6">
      <KpiStrip totals={totals} />

      {!hasAnyActivity && (
        <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-4 py-10 text-center text-sm text-fg-muted">
          {t('analytics.empty')}
        </div>
      )}

      <Card
        title={t('analytics.chart.activity.title')}
        subtitle={t('analytics.chart.activity.subtitle')}
        icon={Activity}
      >
        <ActivityChart
          data={daily}
          ariaLabel={t('analytics.chart.activity.title')}
          unit="message"
        />
      </Card>

      <Card
        title={t('analytics.chart.tokens.title')}
        subtitle={t('analytics.chart.tokens.subtitle')}
        icon={Coins}
      >
        {hasAnyTokens ? (
          <ActivityChart
            data={dailyTokens}
            ariaLabel={t('analytics.chart.tokens.title')}
            unit="token"
          />
        ) : (
          <EmptyRow hint={t('analytics.chart.tokens.empty')} />
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card
          title={t('analytics.chart.models.title')}
          subtitle={t('analytics.chart.models.subtitle')}
          icon={BarChart3}
        >
          {model_usage.length === 0 ? (
            <EmptyRow hint={t('analytics.chart.models.empty')} />
          ) : (
            <HBarList items={model_usage} />
          )}
        </Card>

        <Card
          title={t('analytics.chart.tools.title')}
          subtitle={t('analytics.chart.tools.subtitle')}
          icon={Wrench}
        >
          {tool_usage.length === 0 ? (
            <EmptyRow hint={t('analytics.chart.tools.empty')} />
          ) : (
            <HBarList items={tool_usage} />
          )}
        </Card>
      </div>

      {/* T5.6 — adapter usage. Standalone row (not in the 2-col grid)
          because it's a different axis of the same sessions: while
          Top Models slices by `session.model`, this slices by
          `session.adapter_id`. Placed last so the new signal is
          obvious without displacing the historical layout. */}
      <Card
        title={t('analytics.chart.adapters.title')}
        subtitle={t('analytics.chart.adapters.subtitle')}
        icon={Boxes}
      >
        {adapterUsageNamed.length === 0 ? (
          <EmptyRow hint={t('analytics.chart.adapters.empty')} />
        ) : (
          <HBarList items={adapterUsageNamed} />
        )}
      </Card>

      {/* T6.1 — lifetime 👍/👎 rollup. Lives at the end so the core
          activity/tokens/models/adapters charts stay in their
          historical slots. */}
      <Card
        title={t('analytics.chart.feedback.title')}
        subtitle={t('analytics.chart.feedback.subtitle')}
        icon={ThumbsUp}
      >
        <FeedbackStrip
          up={totals.feedback_up}
          down={totals.feedback_down}
          totalMessages={totals.messages}
        />
      </Card>

      <footer className="pt-2 text-center text-[11px] text-fg-subtle">
        {t('analytics.generated_at', {
          when: new Date(data.generated_at).toLocaleString(),
        })}
      </footer>
    </div>
  );
}
