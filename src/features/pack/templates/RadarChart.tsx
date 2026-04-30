/**
 * RadarChart view template — multi-axis health score.
 *
 * The 麦多AI "六维诊断" view (六个维度: 销售/库存/流量/广告/评分/退货).
 * Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: six-dim-diagnosis
 *     title: 六维诊断
 *     template: RadarChart
 *     data_source: { mcp: amazon-sp, method: six_dim_diagnosis }
 *     axes: [sales, inventory, traffic, ads, rating, returns]
 * ```
 *
 * Stage 5d ships an axis-label legend + a placeholder polygon.
 * Stage 5e wires the data + computes the polygon vertices.
 */
import type { PackView } from '@/lib/ipc/pack';

export function RadarChartTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const axes = Array.isArray(options.axes)
    ? (options.axes as string[])
    : ['axis 1', 'axis 2', 'axis 3', 'axis 4', 'axis 5', 'axis 6'];

  return (
    <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-bg-elev-1 p-4 lg:grid-cols-[1fr_220px]">
      {/* Plot area */}
      <div className="flex aspect-square items-center justify-center rounded-md bg-bg-elev-2">
        <svg
          viewBox="0 0 200 200"
          className="h-3/4 w-3/4 text-fg-subtle"
          aria-hidden
        >
          {/* Concentric reference rings */}
          {[0.33, 0.66, 1].map((scale) => (
            <circle
              key={scale}
              cx="100"
              cy="100"
              r={80 * scale}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="1"
            />
          ))}
          {/* Placeholder polygon — real vertices land in stage 5e */}
          <polygon
            points="100,40 150,75 140,140 60,140 50,75"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="currentColor"
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
        </svg>
      </div>
      {/* Axis legend */}
      <ul className="flex flex-col gap-1 text-sm">
        {axes.map((a, idx) => (
          <li
            key={a}
            className="flex items-center justify-between border-b border-border py-1 text-fg-muted last:border-b-0"
          >
            <span>{`${idx + 1}. ${a}`}</span>
            <span className="text-xs text-fg-subtle">—</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
