/**
 * Timeline view template — vertical chronological feed.
 *
 * Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: competitor-radar
 *     title: 战场雷达
 *     template: Timeline
 *     data_source:
 *       static:
 *         events:
 *           - { time: "2h ago", title: "Competitor opened Coupon", detail: "ASIN B0CC..." }
 * ```
 *
 * Data source returns either an array of events or
 * `{ events: [...] }`. Each event: `{ time?, title, detail? }`.
 */
import type { PackView } from '@/lib/ipc/pack';
import { usePackViewData } from '@/features/pack/usePackViewData';

interface TimelineEvent {
  time?: string;
  title: string;
  detail?: string;
}

function extractEvents(data: unknown): TimelineEvent[] {
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).events)
      ? ((data as Record<string, unknown>).events as unknown[])
      : [];
  return arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      time: typeof r.time === 'string' ? r.time : undefined,
      title: typeof r.title === 'string' ? r.title : '',
      detail: typeof r.detail === 'string' ? r.detail : undefined,
    }))
    .filter((r) => r.title.length > 0);
}

export function TimelineTemplate({ view }: { view: PackView }) {
  const { data, loading, error } = usePackViewData(view.packId, view.viewId);
  const events = extractEvents(data);

  if (loading) {
    return <p className="text-sm text-fg-subtle">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elev-1 p-6 text-center text-sm text-fg-subtle">
        no events
      </div>
    );
  }

  return (
    <ol className="relative ml-3 flex flex-col gap-4 border-l border-border pl-6">
      {events.map((e, idx) => (
        <li key={idx} className="relative">
          <span className="absolute -left-[1.625rem] top-1.5 inline-block h-2 w-2 rounded-full bg-gold-500 ring-2 ring-bg-elev-1" />
          <div className="flex flex-col gap-0.5">
            {e.time && (
              <span className="text-xs uppercase tracking-wide text-fg-subtle">
                {e.time}
              </span>
            )}
            <span className="text-sm font-medium text-fg">{e.title}</span>
            {e.detail && (
              <span className="text-xs text-fg-subtle">{e.detail}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
