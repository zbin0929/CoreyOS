import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-user customization layer for the Home page.
 *
 * Each Home widget has a `defaultVisible` flag in `widgets/catalog.ts`;
 * this store records the user's overrides:
 *   - `hidden` — IDs the user explicitly hid (overrides `defaultVisible: true`)
 *   - `extra`  — IDs the user explicitly enabled (overrides `defaultVisible: false`)
 *
 * Visibility resolution lives in `widgets/catalog.ts#isWidgetVisible`.
 *
 * `editing` is transient (not persisted) — the edit mode is reset on
 * every reload so users don't accidentally leave the page in a
 * "configure" state.
 */
interface HomeLayoutState {
  hidden: string[];
  extra: string[];
  editing: boolean;

  hide: (id: string) => void;
  show: (id: string) => void;
  setEditing: (editing: boolean) => void;
  reset: () => void;
}

export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist(
    (set) => ({
      hidden: [],
      extra: [],
      editing: false,

      hide: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id) ? s.hidden : [...s.hidden, id],
          extra: s.extra.filter((x) => x !== id),
        })),
      show: (id) =>
        set((s) => ({
          hidden: s.hidden.filter((x) => x !== id),
          extra: s.extra.includes(id) ? s.extra : [...s.extra, id],
        })),
      setEditing: (editing) => set({ editing }),
      reset: () => set({ hidden: [], extra: [] }),
    }),
    {
      name: 'caduceus.home-layout',
      partialize: (s) => ({ hidden: s.hidden, extra: s.extra }),
    },
  ),
);

export function useIsWidgetVisible(
  id: string,
  defaultVisible: boolean,
): boolean {
  const hidden = useHomeLayoutStore((s) => s.hidden);
  const extra = useHomeLayoutStore((s) => s.extra);
  if (hidden.includes(id)) return false;
  if (extra.includes(id)) return true;
  return defaultVisible;
}
