/**
 * Pack view route entry — picks the right template based on the
 * view spec returned by `pack_views_list` and renders it under
 * the standard PageHeader chrome.
 *
 * Route shape: `/pack/$packId/$viewId`.
 *
 * Stage 5a ships:
 *   - End-to-end IPC + route + dispatch.
 *   - One concrete template (MetricsCard) so a delivered Pack
 *     with `template: MetricsCard` actually renders.
 *
 * Stages 5b through 5d add the remaining 11 templates and the
 * `actions:` button bar. Unknown templates show an explicit
 * "template not yet implemented" panel rather than 404, so a
 * Pack author can tell at a glance what's missing.
 */
import { type ComponentType, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageHeader } from '@/app/shell/PageHeader';
import { type PackView } from '@/lib/ipc/pack';
import { usePackStore } from '@/lib/usePackStore';
import { AlertListTemplate } from '@/features/pack/templates/AlertList';
import { CompositeDashboardTemplate } from '@/features/pack/templates/CompositeDashboard';
import { DataTableTemplate } from '@/features/pack/templates/DataTable';
import { FormRunnerTemplate } from '@/features/pack/templates/FormRunner';
import { MetricsCardTemplate } from '@/features/pack/templates/MetricsCard';
import { PivotTableTemplate } from '@/features/pack/templates/PivotTable';
import { RadarChartTemplate } from '@/features/pack/templates/RadarChart';
import { SkillPaletteTemplate } from '@/features/pack/templates/SkillPalette';
import { TimeSeriesChartTemplate } from '@/features/pack/templates/TimeSeriesChart';
import { TimelineTemplate } from '@/features/pack/templates/Timeline';
import { TrendsMatrixTemplate } from '@/features/pack/templates/TrendsMatrix';
import { WorkflowLauncherTemplate } from '@/features/pack/templates/WorkflowLauncher';
import { ActionPanel } from '@/features/pack/ActionPanel';

interface TemplateProps {
  view: PackView;
}

/** Template registry. Adding a new template = one entry here. */
const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  AlertList: AlertListTemplate,
  CompositeDashboard: CompositeDashboardTemplate,
  DataTable: DataTableTemplate,
  FormRunner: FormRunnerTemplate,
  MetricsCard: MetricsCardTemplate,
  PivotTable: PivotTableTemplate,
  RadarChart: RadarChartTemplate,
  SkillPalette: SkillPaletteTemplate,
  TimeSeriesChart: TimeSeriesChartTemplate,
  Timeline: TimelineTemplate,
  TrendsMatrix: TrendsMatrixTemplate,
  WorkflowLauncher: WorkflowLauncherTemplate,
};

export function PackRoute() {
  const { packId, viewId } = useParams({ strict: false }) as {
    packId: string;
    viewId: string;
  };

  const views = usePackStore((s) => s.views);
  const loading = usePackStore((s) => s.loading);
  const error = usePackStore((s) => s.error);
  const refresh = usePackStore((s) => s.refresh);

  useEffect(() => {
    if (views.length === 0) void refresh();
  }, [views.length, refresh]);

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Pack View" />
        <p className="mt-4 text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (loading && views.length === 0) {
    return (
      <div className="p-6">
        <PageHeader title="Pack View" />
        <p className="mt-4 text-sm text-fg-subtle">Loading…</p>
      </div>
    );
  }

  const view = views.find((v) => v.packId === packId && v.viewId === viewId);
  if (!view) {
    return (
      <div className="p-6">
        <PageHeader title="Pack View" />
        <p className="mt-4 text-sm text-fg-subtle">
          View <code>{packId}/{viewId}</code> not found. The pack may be
          disabled or the view id may have changed.
        </p>
      </div>
    );
  }

  const Template = TEMPLATES[view.template];

  const isFullWidth = view.template === 'CompositeDashboard';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
        <PageHeader
          title={view.title || view.viewId}
          subtitle={view.packTitle}
        />
        {Template ? (
          isFullWidth ? (
            <Template view={view} />
          ) : (
            <div className="rounded-xl border border-border/60 bg-bg-elev-1/40 p-4 shadow-sm">
              <Template view={view} />
            </div>
          )
        ) : (
          <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
            <p>
              Template <code>{view.template}</code> is not yet
              implemented.
            </p>
          </div>
        )}
        {view.actions.length > 0 && (
          <ActionPanel actions={view.actions} packId={view.packId} viewId={view.viewId} />
        )}
      </div>
    </div>
  );
}
