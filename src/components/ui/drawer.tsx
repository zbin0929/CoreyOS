import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

/**
 * Minimal bottom-sheet drawer used by the Channels page on narrow
 * viewports (Phase 3 · T3.5). Deliberately not a full Dialog primitive:
 * we only need one corner of the Radix feature matrix, so 70 lines of
 * focused code beats pulling in `@radix-ui/react-dialog` plus its
 * transition + focus-trap surface area.
 *
 * What this delivers:
 *   - Fixed-bottom panel that slides in from below (CSS transform,
 *     120ms easing), capped at 88vh so the user can always see a
 *     sliver of the backdrop and knows how to dismiss it.
 *   - Click-outside (on the backdrop) and ESC close — both call
 *     `onClose`, the same contract the form's Cancel button uses.
 *   - `document.body` scroll lock while open. Prevents the awkward
 *     double-scroll on iOS / Android where the sheet moves AND the
 *     underlying page moves.
 *   - Rendered via a portal into `document.body` so it escapes the
 *     parent card's `overflow-hidden` clipping.
 *
 * What's intentionally missing:
 *   - Swipe-to-dismiss. Nice-to-have; not load-bearing for a form
 *     that already has a Cancel button.
 *   - Focus trap. The drawer content is a single form; Tab still
 *     cycles sensibly within it. If we grow more complex content we
 *     can revisit.
 *   - Mount / unmount transitions on the backdrop itself. The fade
 *     would be nice but adds state complexity for ~50ms of polish.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  testId,
  side = 'bottom',
  widthClass,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** data-testid on the sheet itself. Parent chooses naming so
   *  multiple drawers on one page stay distinguishable. */
  testId?: string;
  /** 'bottom' (default) = mobile sheet; 'right' = desktop side-panel.
   *  Used by `/models` and `/agents` to keep the card grid visible
   *  while focused-editing a single card. */
  side?: 'bottom' | 'right';
  /** Tailwind width classes for right-side drawers. Defaults to
   *  `w-full max-w-xl` which reads well on desktop without
   *  monopolising the viewport. Ignored for bottom sheets. */
  widthClass?: string;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC handler + body scroll lock. Both opt out cleanly on unmount
  // so a stray close doesn't leave the page stuck unscrollable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const isSide = side === 'right';
  return createPortal(
    <div
      // The backdrop. Clicking it closes; clicking the sheet itself
      // is caught by its stopPropagation so a misclick on a form
      // control doesn't nuke the user's edits.
      className={cn(
        'fixed inset-0 z-50 flex bg-black/50',
        isSide ? 'justify-end' : 'items-end',
      )}
      onClick={onClose}
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex flex-col overflow-hidden border-border bg-bg-elev-1 shadow-2',
          isSide
            ? cn(
                // Side drawer = full-height right panel; width picked
                // by the caller (defaults to w-full max-w-xl).
                'h-full border-l',
                widthClass ?? 'w-full max-w-xl',
                // Slide-in from the right.
                'animate-[drawerRight_180ms_cubic-bezier(0.2,0.8,0.2,1)]',
              )
            : cn(
                // Bottom sheet = capped at 88vh with top rounding.
                'w-full max-h-[88vh] rounded-t-lg border-t',
                'animate-[drawerUp_180ms_cubic-bezier(0.2,0.8,0.2,1)]',
              ),
        )}
        data-testid={testId}
      >
        {/* Grab handle — only on bottom sheets where it cues "slide". */}
        {!isSide && (
          <div className="flex justify-center py-2">
            <span className="h-1 w-10 rounded-full bg-border-strong/60" />
          </div>
        )}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          {title ? (
            <h2 className="truncate text-sm font-medium text-fg">{title}</h2>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label={t('widgets.close')}
            data-testid={testId ? `${testId}-close` : undefined}
          >
            <Icon icon={X} size="md" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
