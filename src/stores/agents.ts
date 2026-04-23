import { create } from 'zustand';
import { adapterList, type AdapterListEntry } from '@/lib/ipc';

/**
 * Agent registry store (T5.5a + T5.5b).
 *
 * Wraps the `adapter_list` IPC so the Topbar `AgentSwitcher` can read a
 * single reactive slice instead of juggling its own fetch + poll state.
 *
 * T5.5b adds the **active adapter** slice: a user-chosen id that drives
 * chat routing (IPC `chat_send` / `chat_stream_start` forward it), Sidebar
 * nav filtering (hide Channels/Skills when the active adapter doesn't
 * claim the capability), and the pill label in the topbar. Persisted to
 * `localStorage` so the selection survives reloads.
 *
 * Refresh model:
 *   - `refresh()` — one-shot probe.
 *   - `startBackgroundRefresh()` — 10 s poll plus an immediate probe on
 *     first call. Idempotent; calling again is a no-op.
 *   - `stopBackgroundRefresh()` — for Hot-Module-Reload cleanup.
 */

const ACTIVE_ID_STORAGE_KEY = 'corey.active_adapter_id';

/** Read the persisted active id. Swallows storage failures (Safari private
 *  mode, SSR, etc.) so the app never crashes on a missing quota. */
function readPersistedActiveId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersistedActiveId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_ID_STORAGE_KEY);
    else window.localStorage.setItem(ACTIVE_ID_STORAGE_KEY, id);
  } catch {
    // ignore — persistence is a nice-to-have, not a correctness property
  }
}

interface AgentsState {
  /** Populated once `refresh()` resolves; `null` before the first probe. */
  adapters: AdapterListEntry[] | null;
  /** Error from the last probe, if any. Cleared on success. */
  error: string | null;
  /** True between dispatch and resolution of the current probe. */
  loading: boolean;

  /**
   * User-selected adapter id. `null` means "follow the registry default"
   * (i.e. whichever row has `is_default=true`). Persisted to
   * `localStorage` so reloads keep the selection. Readers should prefer
   * `getActiveEntry()` below instead of pattern-matching this field —
   * it falls back to the default when `null` or when the persisted id
   * no longer exists in the registry.
   */
  activeId: string | null;

  refresh: () => Promise<void>;
  startBackgroundRefresh: () => void;
  stopBackgroundRefresh: () => void;

  /** Set (or clear, with `null`) the active adapter. Persists immediately. */
  setActive: (id: string | null) => void;

  /** Resolve the effective active entry:
   *   1. `activeId` if it matches a registered adapter;
   *   2. otherwise the registry's default adapter;
   *   3. otherwise the first registered adapter;
   *   4. otherwise `null` (no adapters at all). */
  getActiveEntry: () => AdapterListEntry | null;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  adapters: null,
  error: null,
  loading: false,
  activeId: readPersistedActiveId(),

  setActive: (id) => {
    writePersistedActiveId(id);
    set({ activeId: id });
  },

  getActiveEntry: () => {
    const { adapters, activeId } = get();
    if (!adapters || adapters.length === 0) return null;
    if (activeId) {
      const match = adapters.find((a) => a.id === activeId);
      if (match) return match;
      // Persisted id no longer valid (adapter was removed). Fall through.
    }
    return adapters.find((a) => a.is_default) ?? adapters[0] ?? null;
  },

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
    // 10s — matches `useAppStatusStore`. With the AgentSwitcher dropdown
    // showing uptime in seconds, a 30s cadence makes the counter look
    // frozen; 10s is cheap (fan-out health probes across ~3 adapters)
    // and gives the user a visible "still alive" signal.
    pollHandle = setInterval(() => {
      void get().refresh();
    }, 10_000);
  },

  stopBackgroundRefresh: () => {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  },
}));
