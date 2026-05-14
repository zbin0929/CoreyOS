import { AlertCircle, Loader2, RefreshCw, Terminal as TerminalIcon, X } from 'lucide-react';

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
  onRestart,
}: {
  tabs: Tab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onRestart: (key: string) => void;
}) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-1"
      data-testid="terminal-tabs"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const isExited = tab.state.kind === 'exited';
        return (
          <div
            key={tab.key}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition',
              active
                ? 'border-border-strong bg-bg-elev-2 text-fg'
                : 'border-border bg-bg-elev-1 text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
              isExited && 'border-danger/50 bg-danger/5',
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
              ) : tab.state.kind === 'exited' ? (
                <Icon icon={RefreshCw} size="xs" className="text-amber-500" />
              ) : (
                <Icon icon={TerminalIcon} size="xs" className="text-fg-subtle" />
              )}
              <span className="max-w-[140px] truncate">{tab.label}</span>
            </button>
            {isExited ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestart(tab.key);
                }}
                aria-label={`Restart ${tab.label}`}
                className="rounded p-0.5 text-amber-500 hover:bg-amber-500/10"
                data-testid={`terminal-tab-restart-${tab.key}`}
              >
                <Icon icon={RefreshCw} size="xs" className="animate-spin-once" />
              </button>
            ) : (
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
            )}
          </div>
        );
      })}
    </div>
  );
}
