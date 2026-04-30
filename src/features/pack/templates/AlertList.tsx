/**
 * AlertList view template.
 *
 * Pack manifest example:
 *
 * ```yaml
 * views:
 *   - id: inventory-alerts
 *     title: 库存预警
 *     template: AlertList
 *     data_source:
 *       static:
 *         items:
 *           - { severity: critical, title: "ASIN B07XYZ stock-out in 2d", detail: "FBA Center US-East" }
 *           - { severity: warning,  title: "ACoS spike on Holiday Q4",   detail: "+18% week over week" }
 * ```
 *
 * The data source returns either an array of items or
 * `{ items: [...] }`. Each item has `{ severity, title, detail? }`
 * with severity ∈ critical | warning | info | ok.
 */
import type { PackView } from '@/lib/ipc/pack';
import { cn } from '@/lib/cn';
import { usePackViewData } from '@/features/pack/usePackViewData';

type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface AlertItem {
  severity: Severity;
  title: string;
  detail?: string;
}

const DOT_CLASS: Record<Severity, string> = {
  critical: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  ok: 'bg-success',
};

function isSeverity(v: unknown): v is Severity {
  return v === 'critical' || v === 'warning' || v === 'info' || v === 'ok';
}

function extractItems(data: unknown): AlertItem[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)
      ? ((data as Record<string, unknown>).items as unknown[])
      : [];
  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      severity: isSeverity(r.severity) ? r.severity : 'info',
      title: typeof r.title === 'string' ? r.title : '',
      detail: typeof r.detail === 'string' ? r.detail : undefined,
    }))
    .filter((r) => r.title.length > 0);
}

export function AlertListTemplate({ view }: { view: PackView }) {
  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const items = extractItems(data);

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-bg-elev-1 p-4 text-sm text-fg-subtle">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elev-1 p-6 text-center text-sm text-fg-subtle">
        no alerts
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev-1">
      {items.map((item, idx) => (
        <li
          key={idx}
          className={cn(
            'flex items-start gap-3 px-3 py-2',
            idx > 0 && 'border-t border-border',
          )}
        >
          <span
            className={cn(
              'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
              DOT_CLASS[item.severity],
            )}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-fg">{item.title}</span>
            {item.detail && (
              <span className="text-xs text-fg-subtle">{item.detail}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
