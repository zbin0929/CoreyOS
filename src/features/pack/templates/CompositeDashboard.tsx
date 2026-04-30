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

interface LayoutCell {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  view?: {
    title?: string;
    template?: string;
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
    <div
      className="grid auto-rows-[60px] gap-3"
      style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}
    >
      {layout.map((cell, idx) => {
        const cs = (cell.x ?? 0) + 1;
        const ce = cs + (cell.w ?? 12);
        const rs = (cell.y ?? 0) + 1;
        const re = rs + (cell.h ?? 4);
        return (
          <div
            key={idx}
            className="flex flex-col rounded-md border border-border bg-bg-elev-1 p-3"
            style={{
              gridColumn: `${cs} / ${ce}`,
              gridRow: `${rs} / ${re}`,
            }}
          >
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              {cell.view?.template ?? 'placeholder'}
            </span>
            <span className="text-sm font-medium text-fg">
              {cell.view?.title ?? `cell ${idx + 1}`}
            </span>
            <span className="mt-auto text-xs text-fg-subtle">
              stage 5d: child rendering lands in stage 5e
            </span>
          </div>
        );
      })}
    </div>
  );
}
