/**
 * MetricsCard view template.
 *
 * Renders a row of KPI cards. The Pack manifest declares it as:
 *
 * ```yaml
 * views:
 *   - id: profit-overview
 *     title: 利润总览
 *     template: MetricsCard
 *     metrics: [revenue, cost, profit, margin]
 *     data_source:
 *       static:
 *         revenue: 12345
 *         cost: 8000
 *         profit: 4345
 *         margin: "35.2%"
 * ```
 *
 * The `metrics` array names the keys to extract from the
 * data-source response. Stage 5e wires the data via
 * `usePackViewData` (resolves manifest `data_source` →
 * `pack_view_data` IPC).
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
  type LucideIcon,
} from 'lucide-react';
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

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

function metaFor(key: string): MetricMeta {
  if (META[key]) return META[key];
  return {
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: BarChart3,
    unit: '',
  };
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

export function MetricsCardTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metrics = Array.isArray(options.metrics)
    ? (options.metrics as string[])
    : [];

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
        <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((key, idx) => {
          const meta = metaFor(key);
          const val = dataObj[key];
          const delta = typeof dataObj[`${key}_delta`] === 'number'
            ? (dataObj[`${key}_delta`] as number)
            : null;
          return (
            <Card
              key={key}
              className="group flex flex-col gap-3 border-border bg-bg-elev-1 p-4 shadow-sm transition-shadow hover:shadow-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wide text-fg-subtle">
                  {meta.label}
                </span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${loading ? 'bg-bg-elev-2 text-fg-muted' : iconBgClass(key, val)}`}>
                  <Icon icon={meta.icon} size="sm" />
                </span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className={`text-2xl font-bold leading-none tracking-tight ${loading ? 'text-fg' : valueClass(key, val)}`}>
                    {loading ? '…' : formatCell(val)}
                  </span>
                  {delta !== null && !loading && (
                    <TrendBadge delta={delta} invert={meta.invertTrend} />
                  )}
                </div>
                {!loading && (
                  <span className="text-fg-muted/40 transition-opacity group-hover:opacity-100 opacity-60">
                    <MiniSparkline seed={idx + 1} />
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
