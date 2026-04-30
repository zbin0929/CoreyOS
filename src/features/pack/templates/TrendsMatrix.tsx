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
import { usePackViewData } from '@/features/pack/usePackViewData';
import { cn } from '@/lib/cn';

interface TrendRow {
  name: string;
  values: Record<string, number>;
  delta?: number;
  spark?: number[];
}

function extractRows(data: unknown): TrendRow[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).rows)
      ? ((data as Record<string, unknown>).rows as unknown[])
      : [];
  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const values: Record<string, number> = {};
      const valuesObj =
        r.values && typeof r.values === 'object' && !Array.isArray(r.values)
          ? (r.values as Record<string, unknown>)
          : {};
      for (const [k, v] of Object.entries(valuesObj)) {
        if (typeof v === 'number') values[k] = v;
      }
      return {
        name: typeof r.name === 'string' ? r.name : '',
        values,
        delta: typeof r.delta === 'number' ? r.delta : undefined,
        spark: Array.isArray(r.spark)
          ? (r.spark as unknown[]).filter((n): n is number => typeof n === 'number')
          : undefined,
      };
    })
    .filter((r) => r.name.length > 0);
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <span className="text-xs text-fg-subtle">—</span>;
  const w = 64;
  const h = 16;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-gold-500">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TrendsMatrixTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metric = (options.metric as string) ?? '—';
  const periods = Array.isArray(options.periods)
    ? (options.periods as string[])
    : ['p1', 'p2', 'p3', 'p4'];

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const rows = extractRows(data);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-fg">{metric}</span>
        <span className="text-xs text-fg-subtle">
          {rows.length} rows × {periods.length} periods
        </span>
      </div>
      {error && (
        <p className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="bg-bg-elev-2 text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium">name</th>
            {periods.map((p) => (
              <th key={p} className="px-3 py-2 text-right font-medium">
                {p}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">trend</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2].map((i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="inline-block h-2 w-20 animate-pulse rounded bg-bg-elev-3" />
                </td>
                {periods.map((p) => (
                  <td key={p} className="px-3 py-2 text-right">
                    <span className="inline-block h-2 w-12 animate-pulse rounded bg-bg-elev-3" />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <span className="inline-block h-4 w-16 animate-pulse rounded bg-bg-elev-3" />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr className="border-t border-border">
              <td
                colSpan={periods.length + 2}
                className="px-3 py-6 text-center text-xs text-fg-subtle"
              >
                no rows
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => (
              <tr key={idx} className="border-t border-border text-fg">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                {periods.map((p) => (
                  <td key={p} className="px-3 py-2 text-right tabular-nums">
                    {p in r.values ? r.values[p]!.toLocaleString() : '—'}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {r.spark && <Sparkline values={r.spark} />}
                    {r.delta !== undefined && (
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          r.delta > 0 && 'text-success',
                          r.delta < 0 && 'text-danger',
                          r.delta === 0 && 'text-fg-subtle',
                        )}
                      >
                        {r.delta > 0 ? '+' : ''}
                        {r.delta.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
