import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Themed replacement for the native `<select>`. macOS styles native pickers
 * with system chrome we can't override — the dark "popup" button and its
 * system-font dropdown clash with the rest of our UI. This component
 * matches the `<input>` styling used by `combobox.tsx` (same border, same
 * bg, same focus ring) and uses `<button role="combobox">` semantics for
 * screen readers.
 *
 * Keyboard:
 *   - Enter / Space / Down on the trigger → open, focus active option
 *   - ArrowUp / ArrowDown → move active; wraps at ends
 *   - Enter → commit active; Esc → close without committing
 *   - Home / End → first / last
 *   - Type-ahead: any printable key focuses the next option whose label
 *     starts with the typed prefix (resets after 500ms idle)
 *
 * Closed on outside click. Does NOT use portals; dropdown is positioned
 * `absolute` directly below the trigger (same strategy as `combobox`).
 */
export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional secondary text shown in smaller type next to the label. */
  hint?: string;
}

export interface SelectProps<V extends string = string> {
  value: V;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  /** Shown when `value` doesn't match any option. */
  placeholder?: string;
  className?: string;
  id?: string;
  /** Forwarded to the trigger for e2e tests. */
  'data-testid'?: string;
  disabled?: boolean;
  /** Accessible label; mirrored to `aria-label` on the trigger. */
  ariaLabel?: string;
}

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  disabled,
  ariaLabel,
  ...rest
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  // Type-ahead buffer; reset after idleness so "ba" doesn't linger forever.
  const typeBufRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });

  const selected = options.find((o) => o.value === value);

  // Keep activeIdx honest if the options/value change while closed.
  useEffect(() => {
    if (open) return;
    const i = options.findIndex((o) => o.value === value);
    if (i >= 0) setActiveIdx(i);
  }, [value, options, open]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Scroll the active option into view as the user arrows through.
  useEffect(() => {
    if (!open || !listboxRef.current) return;
    const el = listboxRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % options.length);
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + options.length) % options.length);
        return;
      case 'Home':
        e.preventDefault();
        setActiveIdx(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIdx(options.length - 1);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIdx);
        return;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        return;
    }
    // Type-ahead: printable 1-char keys only, ignore modifiers.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const buf = typeBufRef.current;
      const text = now - buf.ts > 500 ? e.key : buf.text + e.key;
      typeBufRef.current = { text: text.toLowerCase(), ts: now };
      const i = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(typeBufRef.current.text),
      );
      if (i >= 0) setActiveIdx(i);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        data-testid={rest['data-testid']}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded border border-border',
          'bg-bg-elev-2 px-2 py-1.5 pr-8 text-left text-sm text-fg',
          'hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'transition-colors duration-fast',
        )}
      >
        <span className={cn('truncate', !selected && 'text-fg-subtle')}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2',
            'text-fg-subtle transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-activedescendant={`${listboxId}-opt-${activeIdx}`}
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-lg',
          )}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((opt, idx) => {
              const active = idx === activeIdx;
              const selectedNow = opt.value === value;
              return (
                <button
                  key={opt.value}
                  id={`${listboxId}-opt-${idx}`}
                  data-idx={idx}
                  type="button"
                  role="option"
                  aria-selected={selectedNow}
                  // mousedown (not click) so the trigger's blur doesn't race
                  // the commit — same trick combobox.tsx uses.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(idx);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition',
                    active ? 'bg-bg-elev-2 text-fg' : 'text-fg-muted',
                    selectedNow && !active && 'text-fg',
                  )}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 flex-none',
                      selectedNow ? 'opacity-100 text-gold-500' : 'opacity-0',
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{opt.label}</span>
                    {opt.hint && (
                      <span className="truncate text-[11px] text-fg-subtle">
                        {opt.hint}
                      </span>
                    )}
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
