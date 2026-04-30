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
 *     columns: [campaign, acos, spend, sales]
 *     data_source:
 *       static:
 *         rows:
 *           - { campaign: "Holiday Q4", acos: "32%", spend: 1200, sales: 3750 }
 *           - { campaign: "Brand defence", acos: "8%", spend: 200, sales: 2500 }
 * ```
 *
 * The data source is expected to return either a top-level array
 * of row objects, or `{ rows: [...] }`. Each row object is keyed
 * by the column name.
 */
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null && !Array.isArray(r),
    );
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      return obj.rows.filter(
        (r): r is Record<string, unknown> =>
          typeof r === 'object' && r !== null && !Array.isArray(r),
      );
    }
  }
  return [];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function DataTableTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(options.columns)
    ? (options.columns as string[])
    : [];

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const rows = extractRows(data);

  if (columns.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This DataTable view has no <code>columns:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elev-1">
      {error && (
        <p className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
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
          {loading ? (
            // Skeleton rows during the IPC roundtrip.
            [0, 1, 2].map((row) => (
              <tr key={`skel-${row}`} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2">
                    <span className="inline-block h-2 w-12 animate-pulse rounded bg-bg-elev-3" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr className="border-t border-border">
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-xs text-fg-subtle"
              >
                no rows
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx} className="border-t border-border text-fg">
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
