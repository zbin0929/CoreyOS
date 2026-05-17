/**
 * MetricsCard view template.
 *
 * Renders a row of KPI cards. The Pack manifest declares it in one
 * of two forms:
 *
 * **Legacy (string keys looked up in the built-in META table):**
 *
 * ```yaml
 * template: MetricsCard
 * metrics: [revenue, cost, profit, margin]
 * data_source:
 *   static: { revenue: 12345, cost: 8000, profit: 4345, margin: "35.2%" }
 * ```
 *
 * **Inline meta (Pack supplies its own label / icon / stripe color
 * / value formatter / subtitle):**
 *
 * ```yaml
 * template: MetricsCard
 * metrics:
 *   - key: ups_fuel              # also used as data lookup key
 *     label: UPS 燃油
 *     icon: Fuel                 # Lucide icon name
 *     stripe: amber              # carrier-style left color bar
 *     format: "{rate}%"          # mustache against the per-key data object
 *     subtitle: "{effective_date} ~ {valid_to}"
 * data_source:
 *   static:
 *     ups_fuel:
 *       rate: 18.75
 *       effective_date: 2026-05-12
 *       valid_to: 2026-05-19
 * ```
 *
 * The two forms can be mixed in one view. Inline meta wins when
 * present.
 */
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import {
  DollarSign,
  ShoppingCart,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  Package,
  BarChart3,
  Percent,
  Fuel,
  Truck,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';
import { fillTemplate } from '@/features/pack/templates/SchemaConfig/expr';

interface MetricMeta {
  label: string;
  icon: LucideIcon;
  unit: string;
  invertTrend?: boolean;
}

const META: Record<string, MetricMeta> = {
  revenue: { label: '销售额', icon: DollarSign, unit: '$' },
  orders: { label: '订单量', icon: ShoppingCart, unit: '件' },
  acos: { label: 'ACOS', icon: Target, unit: '', invertTrend: true },
  profit_margin: { label: '利润率', icon: Percent, unit: '' },
  cost: { label: '成本', icon: Package, unit: '$' },
  profit: { label: '利润', icon: TrendingUp, unit: '$' },
  margin: { label: '毛利率', icon: BarChart3, unit: '' },
  sessions: { label: '会话数', icon: BarChart3, unit: '' },
  page_views: { label: '页面浏览', icon: BarChart3, unit: '' },
  organic_traffic_pct: { label: '自然流量占比', icon: TrendingUp, unit: '' },
  paid_traffic_pct: { label: '广告流量占比', icon: Target, unit: '', invertTrend: true },
  impressions: { label: '曝光量', icon: BarChart3, unit: '' },
  clicks: { label: '点击量', icon: BarChart3, unit: '' },
  add_to_cart: { label: '加购数', icon: ShoppingCart, unit: '' },
  conversions: { label: '下单数', icon: ShoppingCart, unit: '' },
  ctr: { label: 'CTR', icon: Percent, unit: '' },
  cvr: { label: 'CVR', icon: Percent, unit: '' },
};

/**
 * Lucide icons available to Pack manifest authors via `icon: <Name>`.
 * Anything outside this list falls back to `BarChart3`. Add to the
 * registry as new Pack use-cases need them — keep it intentional
 * so a manifest typo can't import an unbounded icon set.
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  DollarSign,
  ShoppingCart,
  Target,
  TrendingUp,
  TrendingDown,
  Package,
  BarChart3,
  Percent,
  Fuel,
  Truck,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
};

/** Tailwind classes for the carrier-style left color stripe. */
const STRIPE_BG: Record<string, string> = {
  amber: 'bg-amber-500',
  purple: 'bg-purple-600',
  red: 'bg-red-600',
  blue: 'bg-blue-600',
  green: 'bg-success',
  gold: 'bg-gold-500',
  gray: 'bg-gray-500',
};
const STRIPE_TEXT: Record<string, string> = {
  amber: 'text-amber-600',
  purple: 'text-purple-600',
  red: 'text-red-600',
  blue: 'text-blue-600',
  green: 'text-success',
  gold: 'text-gold-500',
  gray: 'text-gray-600',
};

interface InlineMetricMeta {
  /** Lookup key inside the data-source response. */
  key: string;
  label?: string;
  /** Lucide icon name resolved against `ICON_REGISTRY`. */
  icon?: string;
  /** Stripe color key resolved against `STRIPE_BG` / `STRIPE_TEXT`. */
  stripe?: string;
  /** Mustache template applied against the value object. Use
   *  `{value}` to refer to the raw value when it's a primitive. */
  format?: string;
  /** Mustache template for the subtitle / context line. */
  subtitle?: string;
  unit?: string;
  invertTrend?: boolean;
}

function isInlineMeta(v: unknown): v is InlineMetricMeta {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { key?: unknown }).key === 'string');
}

function metaFor(key: string): MetricMeta {
  if (META[key]) return META[key];
  return {
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: BarChart3,
    unit: '',
  };
}

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return BarChart3;
  return ICON_REGISTRY[name] ?? BarChart3;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function valueClass(key: string, value: unknown): string {
  if (typeof value === 'string' && value.includes('%')) {
    const num = Number(value.replace('%', ''));
    if (!Number.isNaN(num)) {
      if (key === 'acos') {
        if (num >= 40) return 'text-danger';
        if (num >= 25) return 'text-warning';
        return 'text-success';
      }
      if (key === 'profit_margin' || key === 'margin') {
        if (num < 10) return 'text-danger';
        if (num < 20) return 'text-warning';
        return 'text-success';
      }
      return 'text-fg';
    }
  }
  if (key === 'profit' && typeof value === 'number') {
    if (value < 0) return 'text-danger';
    if (value < 1000) return 'text-warning';
    return 'text-success';
  }
  return 'text-fg';
}

function iconBgClass(key: string, value: unknown): string {
  const vc = valueClass(key, value);
  if (vc === 'text-danger') return 'bg-danger/10 text-danger';
  if (vc === 'text-warning') return 'bg-warning/10 text-warning';
  if (vc === 'text-success') return 'bg-success/10 text-success';
  return 'bg-gold-500/10 text-gold-500';
}

function MiniSparkline({ seed }: { seed: number }) {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const hash = Math.sin(seed * 9301 + i * 49297) * 0.5 + 0.5;
    return hash * 20 + 4;
  });
  const d = pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${i * 10},${28 - y}`).join(' ');
  return (
    <svg viewBox="0 0 60 28" className="h-6 w-16" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
    </svg>
  );
}

function TrendBadge({ delta, invert }: { delta: number; invert?: boolean }) {
  const positive = invert ? delta < 0 : delta > 0;
  const neutral = delta === 0;
  const color = neutral ? 'text-fg-muted' : positive ? 'text-success' : 'text-danger';
  const bg = neutral ? 'bg-bg-elev-2' : positive ? 'bg-success/10' : 'bg-danger/10';
  const TrendIcon = neutral ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${color} ${bg}`}>
      <Icon icon={TrendIcon} size="xs" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

/** Normalize one entry in `options.metrics` to its inline-meta form. */
function normalizeMetric(entry: unknown): InlineMetricMeta | null {
  if (typeof entry === 'string') return { key: entry };
  if (isInlineMeta(entry)) return entry;
  return null;
}

/** Pull the per-metric data slice, supporting the legacy primitive
 *  shape AND the new "value object" shape used by inline meta. */
function lookupDataSlice(dataObj: Record<string, unknown>, key: string): {
  raw: unknown;
  ctx: Record<string, unknown>;
} {
  const raw = dataObj[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { raw, ctx: { value: raw, ...(raw as Record<string, unknown>) } };
  }
  return { raw, ctx: { value: raw } };
}

/** Match inner grid columns to metric count so a single-metric
 *  card doesn't render at 1/4 width inside a narrow
 *  CompositeDashboard cell. Strings are spelled out literally
 *  so Tailwind's JIT scanner picks them up. */
function metricGridCols(count: number): string {
  if (count <= 1) return '';
  if (count === 2) return 'sm:grid-cols-2';
  if (count === 3) return 'sm:grid-cols-2 lg:grid-cols-3';
  return 'sm:grid-cols-2 lg:grid-cols-4';
}

export function MetricsCardTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const rawMetrics = Array.isArray(options.metrics) ? (options.metrics as unknown[]) : [];
  const metrics = rawMetrics
    .map(normalizeMetric)
    .filter((m): m is InlineMetricMeta => m !== null);

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const dataObj: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This MetricsCard view has no <code>metrics:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className={`grid grid-cols-1 gap-3 ${metricGridCols(metrics.length)}`}>
        {metrics.map((spec, idx) => {
          const baseMeta = metaFor(spec.key);
          const { raw, ctx } = lookupDataSlice(dataObj, spec.key);
          const label = spec.label ?? baseMeta.label;
          const IconComp = spec.icon ? resolveIcon(spec.icon) : baseMeta.icon;
          const display = spec.format
            ? loading
              ? '…'
              : fillTemplate(spec.format, ctx) || '—'
            : loading
              ? '…'
              : formatCell(raw);
          const subtitle = spec.subtitle && !loading ? fillTemplate(spec.subtitle, ctx) : '';
          const stripeBg = spec.stripe ? STRIPE_BG[spec.stripe] : undefined;
          const stripeText = spec.stripe ? STRIPE_TEXT[spec.stripe] : undefined;
          const valColor = stripeText ?? (loading ? 'text-fg' : valueClass(spec.key, raw));
          const iconWrapClass = loading
            ? 'bg-bg-elev-2 text-fg-muted'
            : stripeBg
              ? `${stripeBg} text-white`
              : iconBgClass(spec.key, raw);
          const delta = typeof dataObj[`${spec.key}_delta`] === 'number'
            ? (dataObj[`${spec.key}_delta`] as number)
            : null;
          return (
            <Card
              key={spec.key}
              className="group relative flex flex-col gap-3 overflow-hidden border-border bg-bg-elev-1 p-4 shadow-sm transition-shadow hover:shadow-1"
            >
              {stripeBg && (
                <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${stripeBg}`} />
              )}
              <div className={stripeBg ? 'pl-2' : undefined}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-wide text-fg-subtle">
                    {label}
                  </span>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconWrapClass}`}
                  >
                    <Icon icon={IconComp} size="sm" />
                  </span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <span className={`text-2xl font-bold leading-none tracking-tight tabular-nums ${valColor}`}>
                      {display}
                    </span>
                    {subtitle && (
                      <span className="text-[10px] text-fg-subtle line-clamp-1">{subtitle}</span>
                    )}
                    {delta !== null && !loading && (
                      <TrendBadge delta={delta} invert={spec.invertTrend ?? baseMeta.invertTrend} />
                    )}
                  </div>
                  {!loading && !spec.subtitle && (
                    <span className="text-fg-muted/40 transition-opacity group-hover:opacity-100 opacity-60">
                      <MiniSparkline seed={idx + 1} />
                    </span>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
