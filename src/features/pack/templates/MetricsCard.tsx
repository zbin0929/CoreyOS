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
 *     data_source: { mcp: amazon-sp, method: profit_summary }
 * ```
 *
 * The `metrics` array names the keys to extract from the
 * data source's response. Stage 5a is a stub: we don't yet wire
 * `data_source` to MCP — the Pack loader will inject a real fetch
 * in stage 5b. For now the card displays placeholder values so
 * the route is browsable end-to-end.
 */
import { Card } from '@/components/ui/card';
import type { PackView } from '@/lib/ipc/pack';

export function MetricsCardTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const metrics = Array.isArray(options.metrics)
    ? (options.metrics as string[])
    : [];

  if (metrics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This MetricsCard view has no <code>metrics:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((key) => (
        <Card
          key={key}
          className="flex flex-col gap-1 border-border bg-bg-elev-1 p-4"
        >
          <span className="text-xs uppercase tracking-wide text-fg-subtle">
            {key}
          </span>
          <span className="text-2xl font-semibold text-fg">—</span>
          <span className="text-xs text-fg-subtle">
            stage 5a: data wiring lands in stage 5b
          </span>
        </Card>
      ))}
    </div>
  );
}
