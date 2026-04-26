import { cn } from '@/lib/cn';

/**
 * Common input styling used by the create / rename / clone inputs and
 * by the import modal. Extracted from the route file so each component
 * can stay a Fast-Refresh-friendly single-export module.
 */
export const inputCls = cn(
  'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);
