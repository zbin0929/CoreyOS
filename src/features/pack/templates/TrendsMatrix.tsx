/**
 * TrendsMatrix view template.
 *
 * Sellerboard's killer product row × time-period matrix view —
 * each cell is a value plus its period-over-period delta with
 * a sparkline glyph. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: product-trends
 *     title: 产品趋势
 *     template: TrendsMatrix
 *     data_source: { mcp: amazon-sp, method: product_trends }
 *     metric: net_profit
 *     periods: [today, yesterday, mtd, last_month]
 * ```
 *
 * Stage 5c is the layout shell. Stage 5d wires data and the
 * sparkline / colour-coding logic.
 */
import type { PackView } from '@/lib/ipc/pack';

export function TrendsMatrixTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metric = (options.metric as string) ?? '—';
  const periods = Array.isArray(options.periods)
    ? (options.periods as string[])
    : ['p1', 'p2', 'p3', 'p4'];

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-fg">{metric}</span>
        <span className="text-xs text-fg-subtle">
          rows × {periods.length} periods
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-bg-elev-2 text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium">SKU</th>
            {periods.map((p) => (
              <th key={p} className="px-3 py-2 text-left font-medium">
                {p}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">trend</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3].map((row) => (
            <tr key={row} className="border-t border-border text-fg-muted">
              <td className="px-3 py-2 font-medium">
                <span className="inline-block h-2 w-20 rounded bg-bg-elev-3" />
              </td>
              {periods.map((p) => (
                <td key={p} className="px-3 py-2">
                  <span className="inline-block h-2 w-12 rounded bg-bg-elev-3" />
                </td>
              ))}
              <td className="px-3 py-2">
                <span className="inline-block h-3 w-16 rounded bg-bg-elev-3" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-bg px-3 py-2 text-xs text-fg-subtle">
        stage 5c: data + sparkline + colour-coding land in stage 5d
      </p>
    </div>
  );
}
