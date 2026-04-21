import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { modelList, type ModelInfo } from '@/lib/ipc';

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; models: ModelInfo[] }
  | { kind: 'err' };

export interface ModelPickerProps {
  /** The currently active model id — session override OR the gateway default. */
  activeId: string;
  /** Whether the session has an explicit override set. */
  hasOverride: boolean;
  /** `null` clears the override (revert to gateway default). */
  onPick: (modelId: string | null) => void;
}

/**
 * Compact inline picker shown above the composer. Fetches models lazily when
 * opened (not on mount) so idle chat sessions don't hit the gateway.
 */
export function ModelPicker({ activeId, hasOverride, onPick }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ kind: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Fetch once per open, unless we already have data.
    if (list.kind !== 'ok') {
      setList({ kind: 'loading' });
      try {
        const models = await modelList();
        setList({ kind: 'ok', models });
      } catch {
        setList({ kind: 'err' });
      }
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs',
          'bg-bg-elev-1 text-fg transition',
          'hover:border-gold-500/40 hover:bg-bg-elev-2',
        )}
        title={hasOverride ? 'Session model' : 'Using gateway default'}
      >
        <code className="font-mono">{activeId}</code>
        {hasOverride && (
          <span className="rounded-sm bg-gold-500/15 px-1 text-[10px] font-semibold text-gold-600">
            SESSION
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute bottom-full left-0 mb-1 w-72 max-w-[80vw] overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-lg',
            'z-50',
          )}
        >
          {/* Header + reset row */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Model for this session
            </span>
            {hasOverride && (
              <button
                type="button"
                onClick={() => {
                  onPick(null);
                  setOpen(false);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] text-fg-subtle transition hover:bg-bg-elev-2 hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {list.kind === 'loading' && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            )}
            {list.kind === 'err' && (
              <div className="px-3 py-2 text-xs text-danger">
                Failed to load. Check Settings.
              </div>
            )}
            {list.kind === 'ok' && list.models.length === 0 && (
              <div className="px-3 py-2 text-xs text-fg-muted">
                No models returned by the gateway.
              </div>
            )}
            {list.kind === 'ok' &&
              list.models.map((m) => {
                const active = m.id === activeId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onPick(m.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition',
                      active ? 'bg-gold-500/10 text-fg' : 'text-fg-muted hover:bg-bg-elev-2 hover:text-fg',
                    )}
                  >
                    <Check
                      className={cn('h-3 w-3 flex-none', active ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <code className="truncate font-mono">{m.id}</code>
                      <span className="truncate text-[10px] text-fg-subtle">
                        {m.provider}
                        {m.is_default && ' · default'}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
