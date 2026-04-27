import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';

/**
 * Push the resolved theme (light/dark — never 'system') to the native
 * Tauri window so the OS-drawn title bar, traffic-light buttons, and
 * scrollbars stop looking out of place against a freshly-toggled app
 * theme. Web-only environments (vitest, storybook, `pnpm dev` without
 * tauri) just no-op; we lazy-import so those environments don't need
 * the Tauri runtime in scope.
 */
async function syncNativeWindowTheme(theme: 'dark' | 'light') {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(theme);
  } catch {
    /* not running under Tauri, or plugin unavailable — ignore. */
  }
}

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'caduceus.ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  let resolved: 'dark' | 'light';
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    resolved = prefersDark ? 'dark' : 'light';
  } else {
    resolved = theme;
  }
  root.dataset.theme = resolved;
  void syncNativeWindowTheme(resolved);
}
