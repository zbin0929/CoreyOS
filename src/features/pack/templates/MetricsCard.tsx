/**
 * MetricsCard view template.
 *
 * Renders a row of KPI cards. The Pack manifest declares it as:
 *
 * ```yaml
 * views:
 *   - id: profit-overview
 *     title: 利润总览
 *     template: MetricsCard
 *     metrics: [revenue, cost, profit, margin]
 *     data_source:
 *       static:
 *         revenue: 12345
 *         cost: 8000
 *         profit: 4345
 *         margin: "35.2%"
 * ```
 *
 * The `metrics` array names the keys to extract from the
 * data-source response. Stage 5e wires the data via
 * `usePackViewData` (resolves manifest `data_source` →
 * `pack_view_data` IPC).
 */
import { Card } from '@/components/ui/card';
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function MetricsCardTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metrics = Array.isArray(options.metrics)
    ? (options.metrics as string[])
    : [];

  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const dataObj: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This MetricsCard view has no <code>metrics:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((key) => (
          <Card
            key={key}
            className="flex flex-col gap-1 border-border bg-bg-elev-1 p-4"
          >
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              {key}
            </span>
            <span className="text-2xl font-semibold text-fg">
              {loading ? '…' : formatCell(dataObj[key])}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
