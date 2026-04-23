import { create } from 'zustand';
import { adapterList, type AdapterListEntry } from '@/lib/ipc';

/**
 * Agent registry store (T5.5a).
 *
 * Wraps the `adapter_list` IPC so the Topbar `AgentSwitcher` can read a
 * single reactive slice instead of juggling its own fetch + poll state.
 * Kept deliberately small: the store *doesn't* own the "active adapter"
 * selection yet — that's a T5.5b concern because selection drives
 * session routing + nav visibility, which touches half the app.
 *
 * Refresh model:
 *   - `refresh()` — one-shot probe.
 *   - `startBackgroundRefresh()` — 30 s poll plus an immediate probe on
 *     first call. Idempotent; calling again is a no-op.
 *   - `stopBackgroundRefresh()` — for Hot-Module-Reload cleanup.
 */

interface AgentsState {
  /** Populated once `refresh()` resolves; `null` before the first probe. */
  adapters: AdapterListEntry[] | null;
  /** Error from the last probe, if any. Cleared on success. */
  error: string | null;
  /** True between dispatch and resolution of the current probe. */
  loading: boolean;

  refresh: () => Promise<void>;
  startBackgroundRefresh: () => void;
  stopBackgroundRefresh: () => void;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  adapters: null,
  error: null,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const list = await adapterList();
      set({ adapters: list, error: null, loading: false });
    } catch (e) {
      // Keep the previous snapshot visible rather than wiping it — a
      // transient IPC hiccup shouldn't blank the switcher.
      set({
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      });
    }
  },

  startBackgroundRefresh: () => {
    void get().refresh();
    if (pollHandle !== null) return;
    pollHandle = setInterval(() => {
      void get().refresh();
    }, 30_000);
  },

  stopBackgroundRefresh: () => {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  },
}));
