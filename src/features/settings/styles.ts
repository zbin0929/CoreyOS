import { cn } from '@/lib/cn';

/**
 * Common input styling for the gateway/sandbox forms in Settings.
 * Defined once so the visual rhythm matches across sections; the
 * BrowserLLM section uses its own h-8 chips so it intentionally
 * doesn't import this.
 *
 * Lives in its own file (rather than next to `Section`/`Field` in
 * `shared.tsx`) so React Fast Refresh can keep working on the
 * components without being tripped up by mixed const/component exports.
 */
export const inputCls = cn(
  'w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
);
