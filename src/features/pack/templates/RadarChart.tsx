/**
 * RadarChart view template — multi-axis health score.
 *
 * The 麦多AI "六维诊断" view. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: six-dim-diagnosis
 *     title: 六维诊断
 *     template: RadarChart
 *     axes: [sales, inventory, traffic, ads, rating, returns]
 *     data_source:
 *       static:
 *         scores: { sales: 0.85, inventory: 0.72, traffic: 0.91, ads: 0.6, rating: 0.95, returns: 0.4 }
 * ```
 *
 * `axes` from `options` is the list of axis labels (in order).
 * Data source returns `{ scores: { axis_name: 0..1 } }` or a flat
 * `{ axis_name: 0..1 }`. Missing axes default to 0.
 */
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

const PLOT_RADIUS = 80;

function extractScores(data: unknown): Record<string, number> {
  const root =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const candidate =
    root.scores && typeof root.scores === 'object' && !Array.isArray(root.scores)
      ? (root.scores as Record<string, unknown>)
      : root;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (typeof v === 'number') out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}

function polygonPoints(axes: string[], scores: Record<string, number>): string {
  // Each axis at angle: -π/2 + i * 2π/n (top-aligned).
  const n = axes.length;
  const cx = 100;
  const cy = 100;
  return axes
    .map((axis, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const r = (scores[axis] ?? 0) * PLOT_RADIUS;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function RadarChartTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const axes = Array.isArray(options.axes)
    ? (options.axes as string[])
    : ['axis 1', 'axis 2', 'axis 3', 'axis 4', 'axis 5', 'axis 6'];

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const scores = extractScores(data);
  const points = loading ? '100,40 150,75 140,140 60,140 50,75' : polygonPoints(axes, scores);

  return (
    <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-bg-elev-1 p-4 lg:grid-cols-[1fr_220px]">
      <div className="flex aspect-square items-center justify-center rounded-md bg-bg-elev-2">
        <svg viewBox="0 0 200 200" className="h-3/4 w-3/4 text-gold-500" aria-hidden>
          {[0.33, 0.66, 1].map((scale) => (
            <circle
              key={scale}
              cx="100"
              cy="100"
              r={PLOT_RADIUS * scale}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="1"
            />
          ))}
          <polygon
            points={points}
            fill="currentColor"
            fillOpacity={loading ? '0.05' : '0.2'}
            stroke="currentColor"
            strokeOpacity={loading ? '0.4' : '0.8'}
            strokeWidth="1.5"
          />
        </svg>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {error && (
          <li className="text-xs text-danger">{error}</li>
        )}
        {axes.map((a, idx) => (
          <li
            key={a}
            className="flex items-center justify-between border-b border-border py-1 text-fg-muted last:border-b-0"
          >
            <span>{`${idx + 1}. ${a}`}</span>
            <span className="text-xs text-fg-subtle">
              {loading
                ? '…'
                : a in scores
                  ? `${Math.round(scores[a]! * 100)}%`
                  : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
