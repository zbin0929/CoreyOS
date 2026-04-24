import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * T-polish — open/close state + global `?` hotkey for `ShortcutsDialog`.
 * Split out of the component file so Vite Fast Refresh can HMR the
 * dialog without nuking the store's singleton (and the open state
 * that goes with it).
 */

interface ShortcutsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useShortcutsStore = create<ShortcutsState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

/**
 * Global `?` key handler. Mirrors the safety rails in
 * `useNavShortcuts`: ignore when focus is on a text input /
 * contenteditable so you can still type a literal `?` in a chat
 * composer.
 */
export function useShortcutsHotkey(): void {
  const toggle = useShortcutsStore((s) => s.toggle);
  const setOpen = useShortcutsStore((s) => s.setOpen);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      // `?` is Shift+/ on most layouts; treat as a trigger.
      if (e.key !== '?') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, setOpen]);
}
