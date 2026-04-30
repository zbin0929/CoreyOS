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

export function TimeSeriesChartTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metric = (options.metric as string) ?? '—';
  const kind = (options.kind as string) ?? 'line';
  const range = (options.range as string) ?? '';

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
        {/* Y axis */}
        <div className="absolute inset-y-3 left-2 flex flex-col justify-between text-[10px] text-fg-subtle">
          <span>max</span>
          <span>—</span>
          <span>0</span>
        </div>
        {/* Plot area placeholder */}
        <div className="ml-8 grid h-full grid-cols-7 items-end gap-1">
          {[24, 32, 18, 40, 28, 36, 22].map((h, i) => (
            <div
              key={i}
              className="rounded-t bg-bg-elev-3"
              style={{ height: `${h * 2}px` }}
            />
          ))}
        </div>
      </div>
      <p className="border-t border-border bg-bg px-4 py-2 text-xs text-fg-subtle">
        stage 5c: data wiring lands in stage 5d
      </p>
    </div>
  );
}
