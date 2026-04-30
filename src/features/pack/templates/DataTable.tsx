/**
 * DataTable view template.
 *
 * Pack manifest example:
 *
 * ```yaml
 * views:
 *   - id: ad-monitor
 *     title: 广告守卫
 *     template: DataTable
 *     data_source: { mcp: amazon-sp, method: list_underperforming_ads }
 *     columns: [campaign, acos, spend, sales]
 * ```
 *
 * Stage 5b ships the LAYOUT only — column headers come from the
 * manifest, rows are a placeholder skeleton. Stage 5c wires
 * `data_source` to MCP fetch + result formatting.
 */
import type { PackView } from '@/lib/ipc/pack';

export function DataTableTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(options.columns)
    ? (options.columns as string[])
    : [];

  if (columns.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This DataTable view has no <code>columns:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      <table className="w-full text-sm">
        <thead className="bg-bg-elev-2 text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/*
           * Three skeleton rows so the layout shows the real
           * structure even before the data source is wired
           * (stage 5c). Once pack_view_data lands, this body
           * gets replaced with the real records, with the same
           * column ordering and column-keyed cell renderers.
           */}
          {[0, 1, 2].map((row) => (
            <tr
              key={row}
              className="border-t border-border text-fg-muted"
            >
              {columns.map((c) => (
                <td key={c} className="px-3 py-2">
                  <span className="inline-block h-2 w-12 rounded bg-bg-elev-3" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-bg px-3 py-2 text-xs text-fg-subtle">
        stage 5b: data_source wiring lands in stage 5c
      </p>
    </div>
  );
}
