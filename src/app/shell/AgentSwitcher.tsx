import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import type { AdapterListEntry } from '@/lib/ipc';

/**
 * Topbar adapter picker (T5.5a).
 *
 * Reads the live registry from `useAgentsStore` and renders a pill with
 * the default adapter's name + a health dot. Clicking opens a dropdown
 * listing every registered adapter with its own health dot, uptime,
 * and last-error tooltip.
 *
 * T5.5a is read-only — it surfaces the registry. T5.5b will add:
 *   - an "Active" selection (currently just shows default)
 *   - capability-gated nav (hide Channels/Skills when e.g. Claude Code
 *     is active)
 *   - unified inbox across adapters
 */
export function AgentSwitcher() {
  const adapters = useAgentsStore((s) => s.adapters);
  const loading = useAgentsStore((s) => s.loading);
  const refresh = useAgentsStore((s) => s.refresh);
  const activeId = useAgentsStore((s) => s.activeId);
  const setActive = useAgentsStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Instant refresh when the dropdown opens — the 10s background poll
  // would otherwise leave the uptime/latency up to 10s stale at the
  // moment the user is actually looking at it.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Active entry resolution: prefer the persisted user selection, fall
  // back to the registry's default, then to the first entry. Mirrors
  // `useAgentsStore.getActiveEntry` but inline so this component
  // re-renders reactively when `activeId` or `adapters` changes.
  const active = (() => {
    if (!adapters || adapters.length === 0) return null;
    if (activeId) {
      const hit = adapters.find((a) => a.id === activeId);
      if (hit) return hit;
    }
    return adapters.find((a) => a.is_default) ?? adapters[0] ?? null;
  })();
  const activeOk = active?.health?.ok === true;

  // First boot: no adapters loaded yet. Render a muted placeholder so the
  // pill's position stays stable; a full skeleton would be visual noise.
  if (!adapters) {
    return (
      <div
        className={cn(
          'flex h-7 shrink-0 items-center gap-2 rounded px-2 text-xs',
          'border border-border bg-bg-elev-2/50 text-fg-subtle',
        )}
        data-testid="agent-switcher-loading"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-fg-subtle/60" />
        <span>{loading ? 'Loading agents…' : 'No agents'}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0" data-testid="agent-switcher">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-7 shrink-0 items-center gap-2 rounded px-2 text-xs',
          'border border-border bg-bg-elev-2/50 text-fg transition-colors',
          'hover:border-border-strong hover:bg-bg-elev-2',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={activeDescription(active)}
        data-testid="agent-switcher-trigger"
      >
        <HealthDot ok={activeOk} pending={loading} />
        <span className="max-w-[140px] truncate font-medium">
          {active?.name ?? 'Agents'}
        </span>
        <span className="text-fg-subtle">{adapters.length}</span>
        <Icon icon={ChevronDown} size="xs" className="text-fg-subtle" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Registered agents"
          className={cn(
            'absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-2',
          )}
          data-testid="agent-switcher-list"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle">
            <span>Registered agents</span>
            <span className="font-mono">{adapters.length}</span>
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {adapters.map((a) => (
              <AgentRow
                key={a.id}
                entry={a}
                active={active?.id === a.id}
                onSelect={() => {
                  setActive(a.id);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
          {activeId !== null && (
            <button
              type="button"
              onClick={() => setActive(null)}
              className={cn(
                'flex w-full items-center justify-center border-t border-border px-3 py-1.5',
                'text-[11px] text-fg-subtle transition-colors hover:bg-bg-elev-2 hover:text-fg',
              )}
              data-testid="agent-switcher-clear"
            >
              Clear selection (follow default)
            </button>
          )}
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-fg-subtle">
            Auto-refreshes every 10s. Chat routes to the active adapter.
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({
  entry,
  active,
  onSelect,
}: {
  entry: AdapterListEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const ok = entry.health?.ok === true;
  return (
    <li
      className={cn(
        'group flex items-start gap-2 px-3 py-2 text-xs transition-colors',
        'cursor-pointer hover:bg-bg-elev-2',
        active && 'bg-bg-elev-2',
      )}
      data-testid={`agent-row-${entry.id}`}
      data-active={active || undefined}
      title={rowDescription(entry)}
      onClick={onSelect}
      role="option"
      aria-selected={active}
    >
      <HealthDot ok={ok} pending={false} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-fg">{entry.name}</span>
          {active && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-500">
              active
            </span>
          )}
          {entry.is_default && (
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-gold-500">
              default
            </span>
          )}
        </div>
        <code className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">
          {entry.id}
        </code>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
          {entry.health?.version && <span>v{entry.health.version}</span>}
          {entry.health?.uptime_ms !== null && entry.health?.uptime_ms !== undefined && (
            <span>up {formatUptime(entry.health.uptime_ms)}</span>
          )}
          {entry.health?.latency_ms !== null && entry.health?.latency_ms !== undefined && (
            <span>{entry.health.latency_ms}ms</span>
          )}
        </div>
        {entry.health?.last_error && (
          <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            last error: {entry.health.last_error}
          </div>
        )}
        {entry.health_error && (
          <div className="mt-1 rounded border border-danger/30 bg-danger/5 px-1.5 py-0.5 text-[10px] text-danger">
            probe failed: {entry.health_error}
          </div>
        )}
      </div>
    </li>
  );
}

function HealthDot({
  ok,
  pending,
  className,
}: {
  ok: boolean;
  pending: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 flex-none rounded-full',
        pending && 'animate-pulse bg-fg-subtle/60',
        !pending && ok && 'bg-emerald-500',
        !pending && !ok && 'bg-danger',
        className,
      )}
    />
  );
}

function activeDescription(entry: AdapterListEntry | null): string {
  if (!entry) return 'No agents registered';
  const bits = [entry.name];
  if (entry.health?.ok) bits.push('online');
  else if (entry.health) bits.push('unhealthy');
  else bits.push('unreachable');
  return bits.join(' · ');
}

function rowDescription(entry: AdapterListEntry): string {
  const parts = [entry.name, entry.id];
  if (entry.health?.message) parts.push(entry.health.message);
  return parts.join(' · ');
}

function formatUptime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
