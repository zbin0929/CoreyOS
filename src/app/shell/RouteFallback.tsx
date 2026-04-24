import { Loader2 } from 'lucide-react';

/**
 * Shared fallback for lazy routes. Kept minimal — a full skeleton
 * per page is more motion than the 100-300ms chunk-fetch warrants,
 * and every feature renders its own skeleton/empty-state once
 * mounted. Extracted from `app/routes.tsx` so that file only exports
 * the `router` object — Vite's Fast Refresh rule doesn't let a
 * module mix components with non-components without tripping a
 * warning on every hot reload.
 */
export function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-fg-subtle">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
    </div>
  );
}
