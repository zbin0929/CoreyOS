import { AlertCircle, Loader2, Terminal as TerminalIcon, X } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

import type { Tab } from './types';

/** Horizontal pill row: one chip per tab, each with label + ×.
 *  Active tab gets the elev-2 background so it reads as selected. */
export function TabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-1"
      data-testid="terminal-tabs"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition',
              active
                ? 'border-border-strong bg-bg-elev-2 text-fg'
                : 'border-border bg-bg-elev-1 text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
            )}
            data-testid={`terminal-tab-${tab.key}`}
            data-active={active ? 'true' : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.key)}
              className="inline-flex items-center gap-1.5"
            >
              {tab.state.kind === 'starting' ? (
                <Icon icon={Loader2} size="xs" className="animate-spin" />
              ) : tab.state.kind === 'error' ? (
                <Icon icon={AlertCircle} size="xs" className="text-danger" />
              ) : (
                <Icon icon={TerminalIcon} size="xs" className="text-fg-subtle" />
              )}
              <span className="max-w-[140px] truncate">{tab.label}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
              }}
              aria-label={`Close ${tab.label}`}
              className="rounded p-0.5 text-fg-subtle hover:bg-bg-elev-3 hover:text-danger"
              data-testid={`terminal-tab-close-${tab.key}`}
            >
              <Icon icon={X} size="xs" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
