import { Wrench } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { UiToolCall } from '@/stores/chat';

/**
 * Small strip of tool-call pills rendered ABOVE the assistant's prose. Each
 * pill shows what the agent did (e.g. `terminal · pwd`). Hermes bakes the
 * tool's OUTPUT into the subsequent text, so we don't need an expandable
 * output panel here — the pill is a signal, not a full trace viewer.
 */
export function ToolCallsStrip({ calls }: { calls: UiToolCall[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {calls.map((c) => (
        <div
          key={c.id}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-2 px-2 py-1',
            'text-[11px] text-fg-muted',
          )}
          title={c.label ?? c.tool}
        >
          {c.emoji ? (
            <span className="text-sm leading-none">{c.emoji}</span>
          ) : (
            <Icon icon={Wrench} size="xs" className="text-fg-subtle" />
          )}
          <span className="font-semibold text-fg">{c.tool}</span>
          {c.label && (
            <>
              <span className="text-fg-subtle">·</span>
              <code className="max-w-[240px] truncate font-mono text-[11px]">
                {c.label}
              </code>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
