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
 *     data_source: { mcp: amazon-sp, method: competitor_events }
 * ```
 *
 * Each event becomes a dot on the rail with title + detail.
 * Stage 5d ships the layout shell; stage 5e wires the data
 * fetch so real competitor events show up.
 */
import type { PackView } from '@/lib/ipc/pack';

const SAMPLE_EVENTS = [
  { time: '2h ago', title: 'placeholder · event 1', detail: 'Stage 5d shell — data lands in 5e.' },
  { time: '6h ago', title: 'placeholder · event 2', detail: 'Each row will pull time / title / detail from MCP.' },
  { time: '1d ago', title: 'placeholder · event 3', detail: 'Click to drill into the underlying record.' },
];

export function TimelineTemplate({ view: _view }: { view: PackView }) {
  return (
    <ol className="relative ml-3 flex flex-col gap-4 border-l border-border pl-6">
      {SAMPLE_EVENTS.map((e, idx) => (
        <li key={idx} className="relative">
          <span className="absolute -left-[1.625rem] top-1.5 inline-block h-2 w-2 rounded-full bg-bg-elev-3 ring-2 ring-bg-elev-1" />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              {e.time}
            </span>
            <span className="text-sm font-medium text-fg">{e.title}</span>
            <span className="text-xs text-fg-subtle">{e.detail}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
