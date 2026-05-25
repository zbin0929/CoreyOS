import { type ComponentType, lazy, Suspense, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Maximize2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { type PackView } from '@/lib/ipc/pack';
import { usePackStore } from '@/lib/usePackStore';

interface TemplateProps {
  view: PackView;
}

const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  AlertList: lazy(() => import('@/features/pack/templates/AlertList').then((m) => ({ default: m.AlertListTemplate }))),
  CompositeDashboard: lazy(() => import('@/features/pack/templates/CompositeDashboard').then((m) => ({ default: m.CompositeDashboardTemplate }))),
  DataTable: lazy(() => import('@/features/pack/templates/DataTable').then((m) => ({ default: m.DataTableTemplate }))),
  FormRunner: lazy(() => import('@/features/pack/templates/FormRunner').then((m) => ({ default: m.FormRunnerTemplate }))),
  MetricsCard: lazy(() => import('@/features/pack/templates/MetricsCard').then((m) => ({ default: m.MetricsCardTemplate }))),
  PivotTable: lazy(() => import('@/features/pack/templates/PivotTable').then((m) => ({ default: m.PivotTableTemplate }))),
  RadarChart: lazy(() => import('@/features/pack/templates/RadarChart').then((m) => ({ default: m.RadarChartTemplate }))),
  SchemaConfig: lazy(() => import('@/features/pack/templates/SchemaConfig').then((m) => ({ default: m.SchemaConfigTemplate }))),
  SkillPalette: lazy(() => import('@/features/pack/templates/SkillPalette').then((m) => ({ default: m.SkillPaletteTemplate }))),
  TimeSeriesChart: lazy(() => import('@/features/pack/templates/TimeSeriesChart').then((m) => ({ default: m.TimeSeriesChartTemplate }))),
  Timeline: lazy(() => import('@/features/pack/templates/Timeline').then((m) => ({ default: m.TimelineTemplate }))),
  TrendsMatrix: lazy(() => import('@/features/pack/templates/TrendsMatrix').then((m) => ({ default: m.TrendsMatrixTemplate }))),
  WorkflowLauncher: lazy(() => import('@/features/pack/templates/WorkflowLauncher').then((m) => ({ default: m.WorkflowLauncherTemplate }))),
};

/**
 * Pack dashboard widget — renders Pack views inline on the Home page.
 * Views with `nav_section: home` are rendered directly using their
 * template, so the user sees data at a glance without clicking through.
 */
export function PackHomeWidgetsList() {
  const navigate = useNavigate();
  const views = usePackStore((s) => s.views);
  const refresh = usePackStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const homeViews = views.filter((v) => v.navSection === 'home');
  if (homeViews.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {homeViews.map((v) => {
        const Template = TEMPLATES[v.template];
        if (!Template) return null;
        return (
          <section
            key={`${v.packId}-${v.viewId}`}
            className="relative rounded-2xl border border-[var(--glass-border)] p-4 shadow-[var(--shadow-1)] transition-all duration-200 hover:border-[var(--glass-border-hover)]"
            style={{ background: 'var(--gradient-card)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                {v.title || v.viewId}
              </h2>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: `/pack/${v.packId}/${v.viewId}` })
                }
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
                title="展开全屏"
              >
                <Icon icon={Maximize2} size="xs" />
              </button>
            </div>
            <Suspense fallback={null}>
              <Template view={v} />
            </Suspense>
          </section>
        );
      })}
    </div>
  );
}
