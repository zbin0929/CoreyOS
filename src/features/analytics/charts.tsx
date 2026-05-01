import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock,
  Coins,
  DollarSign,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { AnalyticsSummaryDto, ErrorStats, LatencyStats } from '@/lib/ipc';
import { cn } from '@/lib/cn';

import { formatNumber } from './utils';

// ───────────────────────── KPI strip ─────────────────────────

export function KpiStrip({ totals, latency, errors }: { totals: AnalyticsSummaryDto['totals']; latency: LatencyStats | null; errors: ErrorStats | null }) {
  const { t } = useTranslation();
  const hasLatency = latency && latency.avg_ms > 0;
  const hasErrors = errors && errors.error_rate > 0;
  const cards = [
    { key: 'sessions', label: t('analytics.kpi.sessions'), value: totals.sessions, icon: MessageSquare },
    { key: 'messages', label: t('analytics.kpi.messages'), value: totals.messages, icon: MessageSquare },
    { key: 'tool_calls', label: t('analytics.kpi.tool_calls'), value: totals.tool_calls, icon: Wrench },
    { key: 'active_days', label: t('analytics.kpi.active_days'), value: totals.active_days, icon: Calendar },
    { key: 'total_tokens', label: t('analytics.kpi.total_tokens'), value: totals.total_tokens, icon: Coins },
    {
      key: 'cost',
      label: t('analytics.kpi.estimated_cost'),
      display: `$${totals.estimated_cost_usd.toFixed(2)} / ¥${totals.estimated_cost_cny.toFixed(2)}`,
      icon: DollarSign,
    },
    ...(hasLatency
      ? [{
          key: 'latency',
          label: t('analytics.kpi.avg_latency'),
          display: latency.avg_ms >= 1000 ? `${(latency.avg_ms / 1000).toFixed(1)}s` : `${latency.avg_ms}ms`,
          icon: Clock,
        }]
      : []),
    ...(hasErrors
      ? [{
          key: 'error_rate',
          label: t('analytics.kpi.error_rate'),
          display: `${(errors.error_rate * 100).toFixed(1)}%`,
          icon: AlertTriangle,
          highlight: errors.error_rate > 0.05 ? 'text-red-500' : undefined,
        }]
      : []),
  ];
  const cols = 6 + (hasLatency ? 1 : 0) + (hasErrors ? 1 : 0);
  return (
    <div className={cn('grid grid-cols-2 gap-3', `md:grid-cols-${cols}`)}>
      {cards.map(({ key, label, value, display, icon: IconCmp, highlight }) => (
        <div
          key={key}
          data-testid={`analytics-kpi-${key}`}
          className="rounded-md border border-border bg-bg-elev-1 px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-fg-subtle">{label}</span>
            <Icon icon={IconCmp} size="sm" className={highlight ?? 'text-fg-subtle'} />
          </div>
          <div className={cn('mt-1 text-2xl font-semibold tabular-nums', highlight ?? 'text-fg')}>
            {display ?? formatNumber(value)}
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

export function Card({ title, subtitle, icon: IconCmp, children }: CardProps) {
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

export function ActivityChart({
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

export function HBarList({ items }: { items: Array<{ name: string; count: number }> }) {
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
export function FeedbackStrip({
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

export function EmptyRow({ hint }: { hint: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-xs text-fg-subtle">{hint}</div>
  );
}

// ───────────────────────── Skeletons / errors ─────────────────────────

export function SkeletonGrid() {
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

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
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
