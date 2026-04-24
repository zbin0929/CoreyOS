import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  Boxes,
  Coins,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  RefreshCcw,
  Calendar,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { analyticsSummary, type AnalyticsSummaryDto, type NamedCount, ipcErrorMessage } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/cn';

/**
 * Analytics route (Phase 2 Sprint 1).
 *
 * Renders a single-shot rollup from `analytics_summary` — four KPIs, a
 * 30-day activity sparkline, top models, and top tools. Charts are custom
 * SVG (no Recharts etc.) so they respect the design tokens and add zero
 * bundle weight. Re-fetches on mount and on "Refresh" click.
 */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: AnalyticsSummaryDto }
  | { kind: 'err'; message: string };

export function AnalyticsRoute() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  async function load() {
    setState({ kind: 'loading' });
    try {
      const data = await analyticsSummary();
      setState({ kind: 'loaded', data });
    } catch (e) {
      setState({ kind: 'err', message: ipcErrorMessage(e) });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={state.kind === 'loading'}>
            <Icon icon={RefreshCcw} size="sm" className={cn(state.kind === 'loading' && 'animate-spin')} />
            <span className="ml-1.5">{t('analytics.refresh')}</span>
          </Button>
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

// ───────────────────────── Dashboard ─────────────────────────

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

// ───────────────────────── KPI strip ─────────────────────────

function KpiStrip({ totals }: { totals: AnalyticsSummaryDto['totals'] }) {
  const { t } = useTranslation();
  const cards = [
    { key: 'sessions', label: t('analytics.kpi.sessions'), value: totals.sessions, icon: MessageSquare },
    { key: 'messages', label: t('analytics.kpi.messages'), value: totals.messages, icon: MessageSquare },
    { key: 'tool_calls', label: t('analytics.kpi.tool_calls'), value: totals.tool_calls, icon: Wrench },
    { key: 'active_days', label: t('analytics.kpi.active_days'), value: totals.active_days, icon: Calendar },
    { key: 'total_tokens', label: t('analytics.kpi.total_tokens'), value: totals.total_tokens, icon: Coins },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cards.map(({ key, label, value, icon: IconCmp }) => (
        <div
          key={key}
          data-testid={`analytics-kpi-${key}`}
          className="rounded-md border border-border bg-bg-elev-1 px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-fg-subtle">{label}</span>
            <Icon icon={IconCmp} size="sm" className="text-fg-subtle" />
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
            {formatNumber(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Card shell ─────────────────────────

interface CardProps {
  title: string;
  subtitle?: string;
  icon?: typeof Activity;
  children: React.ReactNode;
}

function Card({ title, subtitle, icon: IconCmp, children }: CardProps) {
  return (
    <section className="rounded-md border border-border bg-bg-elev-1">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
            {IconCmp && <Icon icon={IconCmp} size="sm" className="text-fg-subtle" />}
            {title}
          </div>
          {subtitle && <span className="text-xs text-fg-subtle">{subtitle}</span>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ───────────────────────── Activity (30-day) chart ─────────────────────────

const ACTIVITY_W = 720;
const ACTIVITY_H = 140;
// Left padding must fit the widest Y-tick label rendered at text-[10px].
// We now compact labels via `formatNumber` ("13220" → "13k", "1230000" → "1.2M"),
// so the widest realistic label is ~5 chars (e.g. "1.5M"). 40px leaves a
// safe margin before the chart area starts at `ACTIVITY_PAD.l`.
const ACTIVITY_PAD = { t: 12, r: 8, b: 22, l: 40 };

function ActivityChart({
  data,
  ariaLabel = 'Activity',
  unit = 'message',
}: {
  data: Array<{ date: string; count: number }>;
  ariaLabel?: string;
  /** Singular unit noun for tooltips ("message" / "token"). Plural is
   *  auto-derived as `${unit}s`. */
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const innerW = ACTIVITY_W - ACTIVITY_PAD.l - ACTIVITY_PAD.r;
  const innerH = ACTIVITY_H - ACTIVITY_PAD.t - ACTIVITY_PAD.b;
  const stepX = innerW / Math.max(1, data.length - 1);

  const pts = data.map((d, i) => {
    const x = ACTIVITY_PAD.l + i * stepX;
    const y = ACTIVITY_PAD.t + innerH - (d.count / max) * innerH;
    return { x, y, d };
  });

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1]!.x.toFixed(1)},${(ACTIVITY_PAD.t + innerH).toFixed(1)} L${pts[0]!.x.toFixed(1)},${(ACTIVITY_PAD.t + innerH).toFixed(1)} Z`;

  // Y-axis ticks (0, mid, max) — honest, un-fancy.
  const yTicks = [0, Math.round(max / 2), max];

  // X labels: every 5 days to keep it clean.
  const xLabels = data.filter((_, i) => i % 5 === 0 || i === data.length - 1);

  return (
    <svg
      viewBox={`0 0 ${ACTIVITY_W} ${ACTIVITY_H}`}
      role="img"
      aria-label={ariaLabel}
      className="w-full"
    >
      {/* horizontal grid lines */}
      {yTicks.map((tick) => {
        const y = ACTIVITY_PAD.t + innerH - (tick / max) * innerH;
        return (
          <g key={tick}>
            <line
              x1={ACTIVITY_PAD.l}
              x2={ACTIVITY_W - ACTIVITY_PAD.r}
              y1={y}
              y2={y}
              className="stroke-border/60"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={ACTIVITY_PAD.l - 6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-fg-subtle text-[10px] tabular-nums"
            >
              {formatNumber(tick)}
            </text>
          </g>
        );
      })}

      {/* filled area under the line */}
      <path d={areaPath} className="fill-gold-500/10" />
      {/* the line itself */}
      <path d={linePath} className="stroke-gold-500" strokeWidth={1.5} fill="none" />

      {/* dots, with hover tooltip via <title> */}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.d.count > 0 ? 2 : 0}
          className="fill-gold-500"
        >
          <title>
            {p.d.date} — {formatNumber(p.d.count)} {unit}{p.d.count === 1 ? '' : 's'}
          </title>
        </circle>
      ))}

      {/* X axis labels */}
      {xLabels.map((d) => {
        const idx = data.findIndex((x) => x.date === d.date);
        const x = ACTIVITY_PAD.l + idx * stepX;
        const label = d.date.slice(5); // MM-DD
        return (
          <text
            key={d.date}
            x={x}
            y={ACTIVITY_H - 6}
            textAnchor="middle"
            className="fill-fg-subtle text-[10px] tabular-nums"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ───────────────────────── Horizontal bars ─────────────────────────

function HBarList({ items }: { items: Array<{ name: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const pct = (item.count / max) * 100;
        return (
          <li key={item.name} className="flex items-center gap-3 text-sm">
            <span className="min-w-[120px] max-w-[180px] truncate text-fg" title={item.name}>
              {item.name}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-bg-elev-2">
              <div
                className="h-full bg-gold-500/70 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-fg-muted">
              {formatNumber(item.count)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * T6.1 — two-cell lifetime feedback strip. Shows the 👍/👎 counts and
 * a coverage pct against lifetime messages so users can tell whether
 * the ratio is meaningful (10% coverage ≠ 0.1% coverage).
 */
function FeedbackStrip({
  up,
  down,
  totalMessages,
}: {
  up: number;
  down: number;
  totalMessages: number;
}) {
  const { t } = useTranslation();
  const rated = up + down;
  const coverage = totalMessages > 0 ? (rated / totalMessages) * 100 : 0;
  const ratio = rated > 0 ? (up / rated) * 100 : null;

  if (rated === 0) {
    return (
      <EmptyRow hint={t('analytics.chart.feedback.empty')} />
    );
  }

  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-stretch"
      data-testid="analytics-feedback-strip"
    >
      <div className="flex-1 rounded-md border border-border bg-bg-elev-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">
            {t('analytics.chart.feedback.up')}
          </span>
          <Icon icon={ThumbsUp} size="sm" className="text-emerald-500" />
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
          {formatNumber(up)}
        </div>
      </div>
      <div className="flex-1 rounded-md border border-border bg-bg-elev-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">
            {t('analytics.chart.feedback.down')}
          </span>
          <Icon icon={ThumbsDown} size="sm" className="text-danger" />
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
          {formatNumber(down)}
        </div>
      </div>
      <div className="flex-1 rounded-md border border-border bg-bg-elev-2 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-fg-subtle">
          {t('analytics.chart.feedback.ratio')}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
          {ratio === null ? '—' : `${ratio.toFixed(0)}%`}
        </div>
        <div className="mt-0.5 text-[11px] text-fg-subtle">
          {t('analytics.chart.feedback.coverage', {
            pct: coverage.toFixed(1),
            rated: formatNumber(rated),
            total: formatNumber(totalMessages),
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyRow({ hint }: { hint: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-xs text-fg-subtle">{hint}</div>
  );
}

// ───────────────────────── Skeletons / errors ─────────────────────────

function SkeletonGrid() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-md border border-border bg-bg-elev-1" />
        ))}
      </div>
      <div className="h-[190px] animate-pulse rounded-md border border-border bg-bg-elev-1" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-[240px] animate-pulse rounded-md border border-border bg-bg-elev-1" />
        <div className="h-[240px] animate-pulse rounded-md border border-border bg-bg-elev-1" />
      </div>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 p-4">
      <div className="mb-2 text-sm font-medium text-danger">{t('analytics.error_title')}</div>
      <p className="mb-3 text-xs text-fg-muted">{message}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        {t('analytics.retry')}
      </Button>
    </div>
  );
}

// ───────────────────────── Utilities ─────────────────────────

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Turn a sparse `{date, count}[]` from the backend into a dense 30-day
 * series ending TODAY (UTC). Missing days get count=0 so the line chart
 * still renders a full timeline.
 */
function padLast30Days(sparse: Array<{ date: string; count: number }>) {
  const byDate = new Map(sparse.map((d) => [d.date, d.count]));
  const out: Array<{ date: string; count: number }> = [];
  const today = new Date();
  // Use UTC to stay consistent with the backend's `date(created_at/1000,'unixepoch')`.
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: byDate.get(iso) ?? 0 });
  }
  return out;
}
