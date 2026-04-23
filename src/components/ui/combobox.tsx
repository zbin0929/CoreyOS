import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';

export interface ComboboxOption {
  value: string;
  label?: string;
  /** Small subtitle shown under the label, e.g. provider slug or "default". */
  hint?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /**
   * When `true`, users can type anything — non-matching values still commit.
   * When `false`, the input value is constrained to `options[].value`.
   */
  freeSolo?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
}

/**
 * Themed replacement for `<select>` + `<datalist>`. macOS styles native
 * pickers with system chrome we can't override, so we render our own input
 * + dropdown pair. Filters options by substring match on `value` and `label`.
 *
 * Keyboard: ArrowDown opens the list and moves the active row; Enter commits
 * the active row; Escape closes without committing; Tab closes.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  freeSolo = true,
  className,
  inputClassName,
  id,
}: ComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options against the current input. When the value exactly matches
  // one option, show the full list (so the user can browse) instead of
  // collapsing to a single-item dropdown.
  const q = value.trim().toLowerCase();
  const filtered = !q
    ? options
    : options.some((o) => o.value.toLowerCase() === q)
      ? options
      : options.filter(
          (o) =>
            o.value.toLowerCase().includes(q) ||
            (o.label ?? '').toLowerCase().includes(q),
        );

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Clamp the active index when filter results shrink.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  function commit(opt: ComboboxOption) {
    onChange(opt.value);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIdx(0);
        return;
      }
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      } else if (!freeSolo) {
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        className={cn(
          'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 pr-9 text-sm text-fg',
          'placeholder:text-fg-subtle',
          'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
          inputClassName,
        )}
      />
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-fg-subtle transition hover:text-fg"
        tabIndex={-1}
        aria-label={t('widgets.toggle_options')}
      >
        <Icon
          icon={ChevronDown}
          size="md"
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && filtered.length > 0 && (
        <div
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden',
            'rounded-md border border-border bg-bg-elev-1 shadow-lg',
          )}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((opt, idx) => {
              const active = idx === activeIdx;
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={(e) => {
                    // Prevent the input blur that would close the dropdown.
                    e.preventDefault();
                    commit(opt);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition',
                    active ? 'bg-bg-elev-2 text-fg' : 'text-fg-muted',
                    selected && !active && 'text-fg',
                  )}
                >
                  <Icon
                    icon={Check}
                    size="sm"
                    className={cn(
                      'flex-none',
                      selected ? 'opacity-100 text-gold-500' : 'opacity-0',
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{opt.label ?? opt.value}</span>
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
