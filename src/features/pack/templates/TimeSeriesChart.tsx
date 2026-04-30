/**
 * TimeSeriesChart view template.
 *
 * Renders a single line / bar chart over time. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: profit-trend
 *     title: 利润趋势
 *     template: TimeSeriesChart
 *     data_source: { mcp: amazon-sp, method: profit_by_day }
 *     metric: profit          # which series to plot
 *     range: last_30_days
 *     kind: line              # line | bar | area
 * ```
 *
 * Stage 5c ships the LAYOUT shell — a placeholder grid with axis
 * labels. Stage 5d wires the data fetch and uses a lightweight
 * renderer (no charting library, per architecture decision in
 * `docs/01-architecture.md`).
 */
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

interface SeriesPoint {
  x: string;
  y: number;
}

function extractPoints(data: unknown): SeriesPoint[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).points)
      ? ((data as Record<string, unknown>).points as unknown[])
      : [];
  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      x: typeof r.x === 'string' || typeof r.x === 'number' ? String(r.x) : '',
      y: typeof r.y === 'number' ? r.y : 0,
    }))
    .filter((p) => p.x.length > 0);
}

export function TimeSeriesChartTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metric = (options.metric as string) ?? '—';
  const kind = (options.kind as string) ?? 'line';
  const range = (options.range as string) ?? '';

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const points = extractPoints(data);
  const max = points.length > 0 ? Math.max(...points.map((p) => p.y), 1) : 1;

  return (
    <div className="rounded-md border border-border bg-bg-elev-1">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-fg">{metric}</span>
          <span className="text-xs uppercase tracking-wide text-fg-subtle">
            {kind}
          </span>
        </div>
        {range && <span className="text-xs text-fg-subtle">{range}</span>}
      </div>
      <div className="relative h-48 px-4 py-3">
        <div className="absolute inset-y-3 left-2 flex flex-col justify-between text-[10px] text-fg-subtle">
          <span>{max.toLocaleString()}</span>
          <span>—</span>
          <span>0</span>
        </div>
        <div
          className="ml-8 grid h-full items-end gap-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {loading ? (
            [24, 32, 18, 40, 28, 36, 22].map((h, i) => (
              <div
                key={i}
                className="animate-pulse rounded-t bg-bg-elev-3"
                style={{ height: `${h * 2}px` }}
              />
            ))
          ) : points.length === 0 ? (
            <span className="col-span-full self-center text-center text-xs text-fg-subtle">
              no data
            </span>
          ) : (
            points.map((p, i) => (
              <div
                key={i}
                className="rounded-t bg-gold-500"
                style={{ height: `${(p.y / max) * 100}%` }}
                title={`${p.x}: ${p.y.toLocaleString()}`}
              />
            ))
          )}
        </div>
      </div>
      {error && (
        <p className="border-t border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
