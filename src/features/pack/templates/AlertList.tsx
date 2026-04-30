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
 *     data_source: { mcp: amazon-sp, method: list_inventory_alerts }
 *     severities: [critical, warning, info]
 * ```
 *
 * Renders a vertical list of items, each with a severity dot
 * (red / yellow / blue / green) and an optional action button.
 * Stage 5b ships placeholder items; stage 5c plumbs real data.
 */
import type { PackView } from '@/lib/ipc/pack';
import { cn } from '@/lib/cn';

type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface PreviewItem {
  severity: Severity;
  title: string;
  detail: string;
}

const SAMPLE_ITEMS: PreviewItem[] = [
  {
    severity: 'critical',
    title: 'placeholder · critical issue',
    detail: 'Stage 5b: data_source wiring lands in stage 5c.',
  },
  {
    severity: 'warning',
    title: 'placeholder · warning',
    detail: 'Each row will pull severity / title / detail from MCP.',
  },
  {
    severity: 'info',
    title: 'placeholder · info',
    detail: 'Action buttons land in stage 5d (decision-return mode).',
  },
];

const DOT_CLASS: Record<Severity, string> = {
  critical: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  ok: 'bg-success',
};

export function AlertListTemplate({ view: _view }: { view: PackView }) {
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev-1">
      {SAMPLE_ITEMS.map((item, idx) => (
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
            <span className="text-xs text-fg-subtle">{item.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
