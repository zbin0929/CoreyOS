import { cn } from '@/lib/cn';

/**
 * Common input styling for the legacy single-model config form. Lives
 * in its own file so React Fast Refresh keeps working on the
 * component-only modules that use it.
 */
export const inputCls = cn(
  'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);
