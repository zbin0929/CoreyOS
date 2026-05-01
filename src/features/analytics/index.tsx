import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, BarChart3, Boxes, Coins, Download, PiggyBank, RefreshCcw, ThumbsUp, Wrench } from 'lucide-react';

import { PageHeader } from '@/app/shell/PageHeader';
import { InfoHint } from '@/components/ui/info-hint';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  analyticsSummary,
  analyticsLatencyStats,
  analyticsErrorStats,
  analyticsCostBreakdown,
  budgetList,
  ipcErrorMessage,
  type AnalyticsSummaryDto,
  type BudgetRow,
  type CostBreakdown,
  type ErrorStats,
  type LatencyStats,
  type NamedCount,
} from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/cn';

import { exportAnalyticsCsv } from './useExport';

import {
  ActivityChart,
  BudgetProgress,
  Card,
  EmptyRow,
  ErrorBox,
  FeedbackStrip,
  HBarList,
  KpiStrip,
  RadarChart,
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
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [errors, setErrors] = useState<ErrorStats | null>(null);
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [data, lat, err, cst, bgs] = await Promise.all([
        analyticsSummary(range || undefined),
        analyticsLatencyStats(range || undefined),
        analyticsErrorStats(range || undefined),
        analyticsCostBreakdown(range || undefined),
        budgetList(),
      ]);
      setState({ kind: 'loaded', data });
      setLatency(lat);
      setErrors(err);
      setCost(cst);
      setBudgets(bgs);
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
          {state.kind === 'loaded' && <Dashboard data={state.data} latency={latency} errors={errors} cost={cost} budgets={budgets} onExport={() => exportAnalyticsCsv(state.data, cost, latency, errors)} />}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ data, latency, errors, cost, budgets, onExport }: { data: AnalyticsSummaryDto; latency: LatencyStats | null; errors: ErrorStats | null; cost: CostBreakdown | null; budgets: BudgetRow[]; onExport: () => void }) {
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

  const radarAxes = useMemo(() => {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const latencyScore = latency && latency.avg_ms > 0 ? clamp(1 - latency.avg_ms / 10000) : 0;
    const costEfficiency = cost && cost.total_usd > 0 ? clamp(1 - cost.total_usd / 50) : 1;
    const reliability = errors && errors.total_messages > 0 ? 1 - errors.error_rate : 1;
    const toolUsage = totals.tool_calls > 0 ? clamp(totals.tool_calls / totals.messages) : 0;
    const feedbackScore = totals.feedback_up + totals.feedback_down > 0
      ? totals.feedback_up / (totals.feedback_up + totals.feedback_down)
      : 0;
    const activity = clamp(totals.active_days / 30);
    return [
      { key: 'latency', value: latencyScore },
      { key: 'cost_efficiency', value: costEfficiency },
      { key: 'reliability', value: reliability },
      { key: 'tool_usage', value: toolUsage },
      { key: 'feedback', value: feedbackScore },
      { key: 'activity', value: activity },
    ];
  }, [totals, latency, errors, cost]);

  return (
    <div className="flex flex-col gap-6">
      <KpiStrip totals={totals} latency={latency} errors={errors} />

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onExport}>
          <Icon icon={Download} size="sm" />
          <span className="ml-1.5">{t('analytics.export')}</span>
        </Button>
      </div>

      {!hasAnyActivity && (
        <div className="rounded-md border border-dashed border-border bg-bg-elev-1 px-4 py-10 text-center text-sm text-fg-muted">
          {t('analytics.empty')}
        </div>
      )}

      {hasAnyActivity && (
        <Card
          title={t('analytics.chart.radar.title')}
          subtitle={t('analytics.chart.radar.subtitle')}
          icon={Activity}
        >
          <RadarChart axes={radarAxes} />
        </Card>
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

      {budgets.length > 0 && (
        <Card
          title={t('analytics.chart.budgets.title')}
          subtitle={t('analytics.chart.budgets.subtitle')}
          icon={PiggyBank}
        >
          <BudgetProgress budgets={budgets} spentCents={Math.round((cost?.total_usd ?? 0) * 100)} />
        </Card>
      )}

      {errors && errors.top_error_types.length > 0 && (
        <Card
          title={t('analytics.chart.errors.title')}
          subtitle={t('analytics.chart.errors.subtitle')}
          icon={AlertTriangle}
        >
          <HBarList items={errors.top_error_types} />
        </Card>
      )}

      <footer className="pt-2 text-center text-[11px] text-fg-subtle">
        {t('analytics.generated_at', {
          when: new Date(data.generated_at).toLocaleString(),
        })}
      </footer>
    </div>
  );
}
