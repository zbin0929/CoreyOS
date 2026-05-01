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
import { MetricsCardTemplate } from '@/features/pack/templates/MetricsCard';
import { DataTableTemplate } from '@/features/pack/templates/DataTable';
import { AlertListTemplate } from '@/features/pack/templates/AlertList';
import { RadarChartTemplate } from '@/features/pack/templates/RadarChart';
import { TrendsMatrixTemplate } from '@/features/pack/templates/TrendsMatrix';
import { TimelineTemplate } from '@/features/pack/templates/Timeline';
import { TimeSeriesChartTemplate } from '@/features/pack/templates/TimeSeriesChart';

import { type ComponentType } from 'react';

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

function buildChildView(cell: LayoutCell, parentPackId: string, parentPackTitle: string): PackView | null {
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

export function CompositeDashboardTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const layout = Array.isArray(options.layout) ? (options.layout as LayoutCell[]) : [];

  if (layout.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This CompositeDashboard view has no <code>layout:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {layout.map((cell, idx) => {
        const childView = buildChildView(cell, view.packId, view.packTitle);
        if (!childView) return null;

        const Template = CHILD_TEMPLATES[childView.template];
        const span = cell.span ?? cell.w ?? 12;

        return (
          <div
            key={idx}
            className={span < 12 ? `lg:col-span-${span}` : ''}
          >
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {childView.title}
            </div>
            {Template ? (
              <Template view={childView} />
            ) : (
              <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-4 text-xs text-fg-subtle">
                Template <code>{childView.template}</code> not available in dashboard
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
