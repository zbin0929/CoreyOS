/**
 * CompositeDashboard view template — grid container.
 *
 * The "战场地图" archetype: multiple sub-views laid out on a
 * grid in one screen. Each child is itself a view spec referring
 * to one of the other 11 templates. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: battleground
 *     title: 战场地图
 *     template: CompositeDashboard
 *     layout:
 *       - { x: 0, y: 0, w: 6, h: 4, view: { template: MetricsCard, ... } }
 *       - { x: 6, y: 0, w: 6, h: 4, view: { template: TrendsMatrix, ... } }
 *       - { x: 0, y: 4, w: 12, h: 6, view: { template: DataTable, ... } }
 * ```
 *
 * Stage 5d ships the grid scaffolding using the layout array.
 * Stage 5e recursively renders child templates so a full
 * dashboard composes from the existing 11 templates.
 */
import type { PackView } from '@/lib/ipc/pack';
import { usePackStore } from '@/lib/usePackStore';
import { MetricsCardTemplate } from '@/features/pack/templates/MetricsCard';
import { DataTableTemplate } from '@/features/pack/templates/DataTable';
import { AlertListTemplate } from '@/features/pack/templates/AlertList';
import { RadarChartTemplate } from '@/features/pack/templates/RadarChart';
import { TrendsMatrixTemplate } from '@/features/pack/templates/TrendsMatrix';
import { TimelineTemplate } from '@/features/pack/templates/Timeline';
import { TimeSeriesChartTemplate } from '@/features/pack/templates/TimeSeriesChart';

import { type ComponentType, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Calendar, Play } from 'lucide-react';
import { workflowRun } from '@/lib/ipc/runtime';
import { DateRangeContext, type DateRange } from '@/features/pack/useDateRange';

interface TemplateProps {
  view: PackView;
}

const CHILD_TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  MetricsCard: MetricsCardTemplate,
  DataTable: DataTableTemplate,
  AlertList: AlertListTemplate,
  RadarChart: RadarChartTemplate,
  TrendsMatrix: TrendsMatrixTemplate,
  Timeline: TimelineTemplate,
  TimeSeriesChart: TimeSeriesChartTemplate,
};

interface LayoutCell {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  span?: number;
  ref?: string;
  view?: {
    id?: string;
    title?: string;
    template?: string;
    icon?: string;
    metrics?: string[];
    columns?: string[];
    axes?: string[];
    data_source?: unknown;
  };
}

interface DashboardSummary {
  revenue: string;
  orders: string;
  alertCount: string;
  riskCount: string;
  riskLevel: 'high' | 'medium' | 'low';
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function resolveCell(cell: LayoutCell, packId: string, siblings: PackView[]): { template: string; staticData: Record<string, unknown> } | null {
  if (cell.ref) {
    const sv = siblings.find((s) => s.viewId === cell.ref && s.packId === packId);
    if (!sv) return null;
    const ds = toRecord(sv.dataSource);
    return { template: sv.template, staticData: toRecord(ds.static) };
  }
  const v = cell.view;
  if (!v || !v.template) return null;
  const root = toRecord(v.data_source);
  return { template: v.template, staticData: toRecord(root.static) };
}

function buildSummary(layout: LayoutCell[], packId: string, siblings: PackView[]): DashboardSummary {
  let revenue = '—';
  let orders = '—';
  let alertCount = 0;
  let riskCount = 0;

  for (const cell of layout) {
    const resolved = resolveCell(cell, packId, siblings);
    if (!resolved) continue;

    if (resolved.template === 'MetricsCard') {
      if (resolved.staticData.revenue !== undefined) revenue = String(resolved.staticData.revenue);
      if (resolved.staticData.orders !== undefined) orders = String(resolved.staticData.orders);
    }

    if (resolved.template === 'AlertList') {
      const items = Array.isArray(resolved.staticData.items) ? resolved.staticData.items : [];
      alertCount += items.length;
      riskCount += items.filter((item) => {
        const sev = toRecord(item).severity;
        return sev === 'critical' || sev === 'warning';
      }).length;
    }
  }

  return {
    revenue: formatValue(revenue),
    orders: formatValue(orders),
    alertCount: String(alertCount),
    riskCount: String(riskCount),
    riskLevel: riskCount >= 3 ? 'high' : riskCount >= 1 ? 'medium' : 'low',
  };
}

function formatValue(input: string): string {
  const n = Number(String(input).replace(/,/g, ''));
  if (Number.isNaN(n)) return String(input);
  return n.toLocaleString();
}

function buildChildView(cell: LayoutCell, parentPackId: string, parentPackTitle: string, siblingViews: PackView[]): PackView | null {
  if (cell.ref) {
    const found = siblingViews.find((sv) => sv.viewId === cell.ref && sv.packId === parentPackId);
    if (found) return found;
  }
  const v = cell.view;
  if (!v || !v.template) return null;
  return {
    packId: parentPackId,
    packTitle: parentPackTitle,
    viewId: v.id ?? `child-${v.template}`,
    title: v.title ?? v.template,
    icon: v.icon ?? 'LayoutGrid',
    navSection: 'hidden',
    template: v.template,
    dataSource: v.data_source ?? { static: {} },
    options: {
      metrics: v.metrics,
      columns: v.columns,
      axes: v.axes,
    },
    actions: [],
  };
}

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '近 7 天',
  '14d': '近 14 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
};

export function CompositeDashboardTemplate({ view }: { view: PackView }) {
  const siblingViews = usePackStore((s) => s.views);
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const options = (view.options ?? {}) as Record<string, unknown>;
  const layout = Array.isArray(options.layout) ? (options.layout as LayoutCell[]) : [];
  const summary = buildSummary(layout, view.packId, siblingViews);

  if (layout.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This CompositeDashboard view has no <code>layout:</code> declared.</p>
      </div>
    );
  }

  function cellTemplate(c: LayoutCell): string | null {
    const resolved = resolveCell(c, view.packId, siblingViews);
    return resolved?.template ?? null;
  }
  const kpiCells = layout.filter((c) => cellTemplate(c) === 'MetricsCard');
  const alertCells = layout.filter((c) => cellTemplate(c) === 'AlertList');
  const otherCells = layout.filter((c) => {
    const t = cellTemplate(c);
    return t && t !== 'MetricsCard' && t !== 'AlertList';
  });

  function renderSection(title: string, cells: LayoutCell[]) {
    if (cells.length === 0) return null;
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-fg-muted">{title}</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {cells.map((cell, idx) => {
            const childView = buildChildView(cell, view.packId, view.packTitle, siblingViews);
            if (!childView) return null;
            const Template = CHILD_TEMPLATES[childView.template];
            const span = Math.max(1, Math.min(12, cell.span ?? cell.w ?? 12));
            return (
              <div
                key={idx}
                className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border/60 bg-bg-elev-1/60 p-3 shadow-sm transition-shadow hover:shadow-1"
                style={{ gridColumn: `span ${span} / span ${span}` }}
              >
                <div className="px-0.5 text-sm font-medium text-fg-subtle">
                  {childView.title}
                </div>
                {Template ? (
                  <Template view={childView} />
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-4 text-xs text-fg-subtle">
                    Template <code>{childView.template}</code> not available
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <DateRangeContext.Provider value={dateRange}>
    <div className="flex flex-col gap-5">
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium ${riskBannerClass(summary.riskLevel)}`}>
        <span className="flex-1">{riskBannerText(summary.riskLevel)}</span>
        <div className="flex shrink-0 gap-2">
          {actionButtons(summary.riskLevel).map((btn) => (
            <ActionTrigger key={btn.workflow} label={btn.label} workflow={btn.workflow} packId={view.packId} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5 self-end">
        <Icon icon={Calendar} size="sm" className="text-fg-muted" />
        {(Object.entries(DATE_RANGE_LABELS) as [DateRange, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setDateRange(key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              dateRange === key
                ? 'bg-gold-500/15 text-gold-500'
                : 'text-fg-muted hover:bg-bg-elev-2 hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryItem label="今日销售额" value={summary.revenue} tone="low" />
        <SummaryItem label="订单量" value={summary.orders} tone="low" />
        <SummaryItem label="告警总数" value={summary.alertCount} tone="warning" />
        <SummaryItem label="风险项" value={summary.riskCount} tone="danger" />
      </div>

      <div className="rounded-xl border border-border/60 bg-bg-elev-1/40 px-4 py-2.5 text-sm text-fg">
        <span className="font-medium text-fg-subtle">今日建议：</span>{' '}
        <span>{actionHint(summary.riskLevel)}</span>
      </div>

      {kpiCells.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {kpiCells.map((cell, idx) => {
            const childView = buildChildView(cell, view.packId, view.packTitle, siblingViews);
            if (!childView) return null;
            const Template = CHILD_TEMPLATES[childView.template];
            if (!Template) return null;
            const span = Math.max(1, Math.min(12, cell.span ?? cell.w ?? 12));
            return (
              <div
                key={idx}
                className="flex flex-col gap-2"
                style={{ gridColumn: `span ${span} / span ${span}` }}
              >
                <Template view={childView} />
              </div>
            );
          })}
        </div>
      )}

      {renderSection('风险管控', alertCells)}
      {renderSection('数据分析', otherCells)}
    </div>
    </DateRangeContext.Provider>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'low' | 'warning' | 'danger';
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-success';
  const wrapperClass =
    tone === 'danger'
      ? 'border-danger/30 bg-danger/5'
      : tone === 'warning'
        ? 'border-warning/30 bg-warning/5'
        : 'border-success/30 bg-success/5';
  return (
    <div className={`rounded-xl border px-4 py-3 transition-shadow hover:shadow-1 ${wrapperClass}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function riskBannerClass(level: 'high' | 'medium' | 'low'): string {
  if (level === 'high') return 'border-danger/30 bg-danger/10 text-danger';
  if (level === 'medium') return 'border-warning/30 bg-warning/10 text-warning';
  return 'border-success/30 bg-success/10 text-success';
}

function riskBannerText(level: 'high' | 'medium' | 'low'): string {
  if (level === 'high') return '高风险：存在多个紧急项，建议优先处理告警中心与库存风险。';
  if (level === 'medium') return '中风险：有待处理风险项，建议今日完成巡检与优化。';
  return '低风险：当前整体健康，按计划进行日常监控即可。';
}

function actionHint(level: 'high' | 'medium' | 'low'): string {
  if (level === 'high') return '先处理红色告警 Top 3，再执行广告降 ACOS 和库存补货。';
  if (level === 'medium') return '先清理黄色预警并复盘昨日转化，避免风险升级。';
  return '维持当前投放节奏，重点关注新增差评与库存消耗曲线。';
}

interface ActionDef {
  label: string;
  workflow: string;
}

function actionButtons(level: 'high' | 'medium' | 'low'): ActionDef[] {
  if (level === 'high') {
    return [
      { label: '广告巡检', workflow: 'ad_daily_check' },
      { label: '库存补货', workflow: 'inventory_alert' },
    ];
  }
  if (level === 'medium') {
    return [
      { label: '差评处理', workflow: 'review_alert' },
      { label: '广告巡检', workflow: 'ad_daily_check' },
    ];
  }
  return [
    { label: '差评处理', workflow: 'review_alert' },
  ];
}

function ActionTrigger({ label, workflow, packId }: { label: string; workflow: string; packId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      await workflowRun(workflow, { packId });
      setDone(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || done}
        onClick={() => void onClick()}
      >
        <Icon icon={Play} size="xs" />
        {done ? '已触发' : label}
      </Button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
