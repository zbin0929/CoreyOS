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
import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, CheckCircle, ChevronDown, ChevronRight, Bell } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import type { PackView } from '@/lib/ipc/pack';
import { cn } from '@/lib/cn';
import { usePackViewData } from '@/features/pack/usePackViewData';
import type { LucideIcon } from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface AlertItem {
  severity: Severity;
  title: string;
  detail?: string;
  time?: string;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '紧急',
  warning: '预警',
  info: '提示',
  ok: '正常',
};

const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  ok: CheckCircle,
};

const ICON_CLASS: Record<Severity, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  ok: 'text-success',
};

const BADGE_CLASS: Record<Severity, string> = {
  critical: 'bg-danger/10 text-danger border-danger/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  info: 'bg-info/10 text-info border-info/30',
  ok: 'bg-success/10 text-success border-success/30',
};

const ROW_CLASS: Record<Severity, string> = {
  critical: 'bg-danger/[0.03] hover:bg-danger/[0.06]',
  warning: 'bg-warning/[0.03] hover:bg-warning/[0.06]',
  info: 'bg-transparent hover:bg-info/[0.03]',
  ok: 'bg-transparent hover:bg-success/[0.03]',
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
  const severityRank: Record<Severity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    ok: 3,
  };

  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      severity: isSeverity(r.severity) ? r.severity : 'info',
      title: typeof r.title === 'string' ? r.title : '',
      detail: typeof r.detail === 'string' ? r.detail : undefined,
      time: typeof r.time === 'string' ? r.time : undefined,
    }))
    .filter((r) => r.title.length > 0)
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

function AlertRow({ item, defaultOpen }: { item: AlertItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDetail = Boolean(item.detail);

  return (
    <li
      className={cn(
        'rounded-lg px-3 py-2.5 transition-colors',
        ROW_CLASS[item.severity],
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => hasDetail && setOpen(!open)}
        disabled={!hasDetail}
      >
        <span className={cn('mt-0.5 shrink-0', ICON_CLASS[item.severity])}>
          <Icon icon={SEVERITY_ICON[item.severity]} size="sm" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium', BADGE_CLASS[item.severity])}>
              {SEVERITY_LABEL[item.severity]}
            </span>
            <span className="truncate text-sm font-medium text-fg">{item.title}</span>
          </div>
          {open && item.detail && (
            <span className="text-xs leading-relaxed text-fg-subtle">{item.detail}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.time && (
            <span className="text-[10px] text-fg-disabled">{item.time}</span>
          )}
          {hasDetail && (
            <span className="text-fg-muted">
              <Icon icon={open ? ChevronDown : ChevronRight} size="xs" />
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

export function AlertListTemplate({ view }: { view: PackView }) {
  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const items = extractItems(data);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elev-1 p-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-md bg-bg-elev-2/40 px-3 py-3">
            <span className="h-4 w-4 animate-pulse rounded bg-bg-elev-3/60" />
            <span className="h-3 w-40 animate-pulse rounded bg-bg-elev-3/60" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg-elev-1 p-8 text-fg-subtle shadow-sm">
        <Icon icon={Bell} size="lg" className="text-fg-disabled" />
        <span className="text-xs">暂无告警</span>
      </div>
    );
  }

  const criticalCount = items.filter((i) => i.severity === 'critical').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;

  return (
    <div className="flex flex-col gap-2">
      {(criticalCount > 0 || warningCount > 0) && (
        <div className="flex items-center gap-3 text-[11px]">
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 text-danger">
              <Icon icon={AlertCircle} size="xs" />
              {criticalCount} 紧急
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-warning">
              <Icon icon={AlertTriangle} size="xs" />
              {warningCount} 预警
            </span>
          )}
          <span className="text-fg-muted">
            共 {items.length} 条
          </span>
        </div>
      )}
      <ul className="flex flex-col gap-1 rounded-lg border border-border bg-bg-elev-1 p-1.5 shadow-sm">
        {items.map((item, idx) => (
          <AlertRow key={idx} item={item} defaultOpen={item.severity === 'critical'} />
        ))}
      </ul>
    </div>
  );
}
