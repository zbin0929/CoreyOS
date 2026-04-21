import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { useChatStore } from '@/stores/chat';
import { useUIStore } from '@/stores/ui';
import { useAppStatusStore } from '@/stores/appStatus';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  // Kick off SQLite hydration exactly once at app startup — NOT inside
  // ChatRoute, because route-scoped effects can re-fire on remount and
  // racing hydrate calls have historically caused infinite-loop regressions.
  useEffect(() => {
    const s = useChatStore.getState();
    if (!s.hydrated) void s.hydrateFromDb();
  }, []);

  // Resolve the current default model + start the gateway-health poll so the
  // topbar badge flips from "unknown" to online/offline within a second of
  // boot. Cleanup on unmount (StrictMode double-mount is fine — start is
  // idempotent, and the cleanup just clears our single interval).
  useEffect(() => {
    useAppStatusStore.getState().startBackgroundRefresh();
    return () => useAppStatusStore.getState().stopBackgroundRefresh();
  }, []);

  // Apply theme on mount
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        root.dataset.theme = mql.matches ? 'dark' : 'light';
      };
      apply();
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    root.dataset.theme = theme;
    return undefined;
  }, [theme]);

  // Global shortcut: ⌘⇧L toggles theme
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleTheme]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
