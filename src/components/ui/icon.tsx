import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { type LucideIcon, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Unified icon wrapper around lucide-react.
 *
 * Enforces project-wide defaults so individual call sites don't diverge:
 *   - `strokeWidth=1.5` — matches the brand's "precision line" feel
 *     established by the Corey logo (thin-stroked geometry).
 *   - Discrete size tokens (`xs`|`sm`|`md`|`lg`|`xl`) so we stop
 *     hand-tuning `h-3.5 w-3.5` per-button. Numeric `size` is still
 *     supported for edge cases.
 *
 * Size token map (aligned with `docs/icon-audit.md`):
 *   xs → 12px   decorative / inline badges / nested chips
 *   sm → 14px   default for in-button and text-flow icons
 *   md → 16px   sidebar nav / topbar pills
 *   lg → 20px   empty-state small / section headers
 *   xl → 24-32px hero illustrations / onboarding surfaces
 */

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

const SIZE_MAP: Record<Exclude<IconSize, number>, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
};

export interface IconProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'size'> {
  /** The lucide-react icon component to render. */
  icon: LucideIcon;
  /** Size token or pixel value. Defaults to `sm` (14px). */
  size?: IconSize;
  /** Tailwind stroke-width; defaults to 1.5 for brand consistency. */
  strokeWidth?: number;
}

function resolveSize(size: IconSize | undefined): number {
  if (size === undefined) return SIZE_MAP.sm;
  if (typeof size === 'number') return size;
  return SIZE_MAP[size];
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { icon: LucideIconCmp, size, strokeWidth = 1.5, className, ...rest },
  ref,
) {
  const px = resolveSize(size);
  const props: LucideProps = {
    size: px,
    strokeWidth,
    // Inherit `currentColor` by default — callers set colour via
    // Tailwind `text-*` on a parent. Explicit `className` still wins.
    className: cn('shrink-0', className),
    'aria-hidden': rest['aria-hidden'] ?? true,
  };
  return <LucideIconCmp ref={ref} {...props} {...rest} />;
});
