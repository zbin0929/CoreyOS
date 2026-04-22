import { useEffect, useState } from 'react';

/**
 * Single-breakpoint media-query hook. `true` when the viewport is
 * narrower than `maxPx` (default 720 — matches the Phase 3 T3.5
 * mobile threshold). Updates live on viewport resize / orientation
 * change, and is SSR-safe: initial state falls back to `false` when
 * `window` isn't available so components hydrate with the desktop
 * shape and re-render after mount.
 *
 * Why not reach for a media-query library? The one call site today
 * (Channels page drawer-vs-inline form) wants one breakpoint and
 * zero frills. 20 lines of `matchMedia` are cheaper than a
 * dependency and let the hook live next to the other tiny utilities
 * in `lib/`.
 */
export function useIsMobile(maxPx = 720): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${maxPx - 1}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${maxPx - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Align state with the query once on mount in case the initial
    // SSR fallback disagreed with the hydrated viewport.
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [maxPx]);

  return isMobile;
}
