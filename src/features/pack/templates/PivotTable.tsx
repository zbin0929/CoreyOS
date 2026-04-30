/**
 * PivotTable view template.
 *
 * Multi-level row grouping — used for P&L statements, balance
 * sheets, hierarchical inventory. Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: profit-loss
 *     title: 损益表
 *     template: PivotTable
 *     data_source: { mcp: erp, method: profit_loss }
 *     row_groups: [category, product]
 *     columns: [current, prior, delta_pct]
 * ```
 *
 * Stage 5c is the layout shell. Stage 5d wires data + collapse /
 * expand interactions.
 */
import type { PackView } from '@/lib/ipc/pack';

export function PivotTableTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(options.columns)
    ? (options.columns as string[])
    : ['value'];
  const rowGroups = Array.isArray(options.row_groups)
    ? (options.row_groups as string[])
    : [];

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-fg">
          {rowGroups.length > 0
            ? `Pivot · ${rowGroups.join(' › ')}`
            : 'Pivot'}
        </span>
        <span className="text-xs text-fg-subtle">{columns.length} columns</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-bg-elev-2 text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium">row</th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Two top-level groups, each with two children — three
              levels of indentation cover the common P&L /
              category-product shape without committing to data. */}
          {[
            { indent: 0, bold: true },
            { indent: 1, bold: false },
            { indent: 1, bold: false },
            { indent: 0, bold: true },
            { indent: 1, bold: false },
          ].map((row, idx) => (
            <tr
              key={idx}
              className="border-t border-border text-fg-muted"
            >
              <td
                className="px-3 py-2"
                style={{ paddingLeft: `${0.75 + row.indent * 1.25}rem` }}
              >
                <span
                  className={`inline-block h-2 w-${row.bold ? 24 : 16} rounded bg-bg-elev-3`}
                />
              </td>
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 text-right">
                  <span className="inline-block h-2 w-12 rounded bg-bg-elev-3" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-bg px-3 py-2 text-xs text-fg-subtle">
        stage 5c: hierarchy + data + collapse interactions land in stage 5d
      </p>
    </div>
  );
}
