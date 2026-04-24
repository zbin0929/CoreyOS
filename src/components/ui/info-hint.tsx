import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';

/**
 * Tiny inline `?` button that pops a scoped explanation on click.
 *
 * Used for field-level help text that's too long for a `title=` on
 * hover but too short to warrant a full doc link. ~30–300 chars is
 * the sweet spot; beyond that, prefer a dedicated doc page.
 *
 * Design choices:
 *   - **Click-to-open**, not hover. Hover tooltips lose on touch
 *     devices, in screen reader workflows, and when the user wants
 *     to select the text. A click-target + visible button survives
 *     all three.
 *   - **Portal-rendered popover** so parent `overflow-hidden` /
 *     transforms never clip the bubble.
 *   - **ESC + outside-click close**. No backdrop — this is inline
 *     help, not a modal.
 *   - **Zero state outside** of what the portal needs. If the caller
 *     unmounts the button the popover tears down cleanly.
 */
export function InfoHint({
  content,
  testId,
  className,
  title,
}: {
  /** The body of the popover. Plain text or inline React children. */
  content: React.ReactNode;
  testId?: string;
  className?: string;
  /** Optional short label — shown as the popover's heading when the
   *  content is long enough that a caption helps. Also mirrored into
   *  `aria-label` on the trigger button. */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the popover under the trigger, anchored right so long
  // content doesn't push off-screen on narrow viewports.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 320) });
  }, [open]);

  // ESC + outside-click close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      // Popover has its own class marker; clicks inside it don't close.
      const pop = document.querySelector('[data-info-hint-popover]');
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          'inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-fg-subtle',
          'hover:bg-bg-elev-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'transition-colors',
          className,
        )}
        aria-label={title ?? 'Show help'}
        aria-expanded={open}
        data-testid={testId}
      >
        <Icon icon={HelpCircle} size="xs" />
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-info-hint-popover
              role="tooltip"
              className={cn(
                'fixed z-[60] w-80 rounded-md border border-border bg-bg-elev-1 p-3 text-xs text-fg shadow-lg',
                'animate-[drawerUp_120ms_ease-out]',
              )}
              style={{ top: pos.top, left: pos.left }}
              data-testid={testId ? `${testId}-popover` : undefined}
            >
              {title && (
                <div className="mb-1.5 font-semibold text-fg">{title}</div>
              )}
              <div className="leading-relaxed text-fg-muted">{content}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
