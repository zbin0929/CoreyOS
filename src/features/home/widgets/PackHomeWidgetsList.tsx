import { type ComponentType, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Maximize2 } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { type PackView } from '@/lib/ipc/pack';
import { usePackStore } from '@/lib/usePackStore';
import { AlertListTemplate } from '@/features/pack/templates/AlertList';
import { CompositeDashboardTemplate } from '@/features/pack/templates/CompositeDashboard';
import { DataTableTemplate } from '@/features/pack/templates/DataTable';
import { FormRunnerTemplate } from '@/features/pack/templates/FormRunner';
import { MetricsCardTemplate } from '@/features/pack/templates/MetricsCard';
import { PivotTableTemplate } from '@/features/pack/templates/PivotTable';
import { RadarChartTemplate } from '@/features/pack/templates/RadarChart';
import { SchemaConfigTemplate } from '@/features/pack/templates/SchemaConfig';
import { SkillPaletteTemplate } from '@/features/pack/templates/SkillPalette';
import { TimeSeriesChartTemplate } from '@/features/pack/templates/TimeSeriesChart';
import { TimelineTemplate } from '@/features/pack/templates/Timeline';
import { TrendsMatrixTemplate } from '@/features/pack/templates/TrendsMatrix';
import { WorkflowLauncherTemplate } from '@/features/pack/templates/WorkflowLauncher';

interface TemplateProps {
  view: PackView;
}

const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  AlertList: AlertListTemplate,
  CompositeDashboard: CompositeDashboardTemplate,
  DataTable: DataTableTemplate,
  FormRunner: FormRunnerTemplate,
  MetricsCard: MetricsCardTemplate,
  PivotTable: PivotTableTemplate,
  RadarChart: RadarChartTemplate,
  SchemaConfig: SchemaConfigTemplate,
  SkillPalette: SkillPaletteTemplate,
  TimeSeriesChart: TimeSeriesChartTemplate,
  Timeline: TimelineTemplate,
  TrendsMatrix: TrendsMatrixTemplate,
  WorkflowLauncher: WorkflowLauncherTemplate,
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
            <Template view={v} />
          </section>
        );
      })}
    </div>
  );
}
