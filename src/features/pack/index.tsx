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
import { useEffect, useState, type ComponentType } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageHeader } from '@/app/shell/PageHeader';
import { packViewsList, type PackView } from '@/lib/ipc/pack';
import { AlertListTemplate } from '@/features/pack/templates/AlertList';
import { DataTableTemplate } from '@/features/pack/templates/DataTable';
import { MetricsCardTemplate } from '@/features/pack/templates/MetricsCard';
import { PivotTableTemplate } from '@/features/pack/templates/PivotTable';
import { TimeSeriesChartTemplate } from '@/features/pack/templates/TimeSeriesChart';
import { TrendsMatrixTemplate } from '@/features/pack/templates/TrendsMatrix';

interface TemplateProps {
  view: PackView;
}

/** Template registry. Adding a new template = one entry here. */
const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  AlertList: AlertListTemplate,
  DataTable: DataTableTemplate,
  MetricsCard: MetricsCardTemplate,
  PivotTable: PivotTableTemplate,
  TimeSeriesChart: TimeSeriesChartTemplate,
  TrendsMatrix: TrendsMatrixTemplate,
};

export function PackRoute() {
  const { packId, viewId } = useParams({ strict: false }) as {
    packId: string;
    viewId: string;
  };

  const [views, setViews] = useState<PackView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    packViewsList().then(
      (vs) => {
        if (!cancelled) setViews(vs);
      },
      (err) => {
        if (!cancelled) setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Pack View" />
        <p className="mt-4 text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (views === null) {
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

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PageHeader
        title={view.title || view.viewId}
        subtitle={view.packTitle}
      />
      {Template ? (
        <Template view={view} />
      ) : (
        <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
          <p>
            Template <code>{view.template}</code> is not yet
            implemented. Stage 5b through 5d add the remaining 11
            templates.
          </p>
        </div>
      )}
    </div>
  );
}
