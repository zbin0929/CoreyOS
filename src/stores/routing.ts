import { create } from 'zustand';
import { routingRuleList, type RoutingRule } from '@/lib/ipc';

/**
 * T6.4 — tiny store holding the current user-defined routing-rule
 * list. The Chat composer reads this on every keystroke (via the
 * pure `resolveRoutedRule` helper) to preview which adapter will
 * handle the next turn; the Settings panel writes to it after each
 * upsert/delete so the composer updates without a page reload.
 *
 * Kept intentionally minimal: no loading flag, no error pipe — the
 * composer falls back to the session's own adapter_id if the list
 * ever fails to load (the pure resolver treats `null` as "no rules").
 */
interface RoutingState {
  rules: RoutingRule[] | null;
  hydrate: () => Promise<void>;
  /** Replace the in-memory list wholesale. Called from the Settings
   *  panel after it persists changes via the IPC layer. */
  setRules: (next: RoutingRule[]) => void;
}

export const useRoutingStore = create<RoutingState>()((set) => ({
  rules: null,
  hydrate: async () => {
    try {
      const { rules } = await routingRuleList();
      set({ rules });
    } catch (e) {
      // Silent: non-Tauri contexts (Storybook) and users who have
      // never opened Settings both land here. Composer treats null
      // as "no routing rules", which is the correct behaviour.
      if (typeof console !== 'undefined') {
        console.warn('[routing] hydrate failed, continuing with no rules:', e);
      }
      set({ rules: [] });
    }
  },
  setRules: (next) => set({ rules: next }),
}));
