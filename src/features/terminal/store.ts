import { create } from 'zustand';

import type { Tab, XtermBundle } from './types';

/**
 * Terminal state hoisted out of the route component so tabs + their
 * xterm instances + the backend ptys survive when the user navigates
 * away and back. Without this store the route's unmount cleanup would
 * kill every pty the moment the user clicks on another nav item —
 * terrible UX if you're mid-ssh session.
 *
 * Two halves:
 *   - reactive `tabs` / `activeKey` (zustand) drive the tab strip.
 *   - the `bundles` / `hosts` / `pending` maps below are NOT reactive:
 *     xterm owns its own DOM/WASM state and mixing it into React
 *     identity leads to pain. Treat them as a mutable singleton the
 *     route talks to imperatively.
 *
 * The bundles survive unmount by design. The route re-parents each
 * existing `term` onto a fresh host div on remount (xterm supports
 * `term.open(newHost)` multiple times), and the Tauri `pty:data:*`
 * listener keeps writing into the buffer regardless of mount state.
 */
export interface TerminalStoreState {
  tabs: Tab[];
  activeKey: string | null;
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setActiveKey: (key: string | null | ((prev: string | null) => string | null)) => void;
}

export const useTerminalStore = create<TerminalStoreState>((set) => ({
  tabs: [],
  activeKey: null,
  setTabs: (updater) =>
    set((s) => ({
      tabs: typeof updater === 'function' ? updater(s.tabs) : updater,
    })),
  setActiveKey: (key) =>
    set((s) => ({
      activeKey: typeof key === 'function' ? key(s.activeKey) : key,
    })),
}));

/** Shared, mutable (non-reactive) singletons. */
export const terminalBundles = new Map<string, XtermBundle>();
export const terminalHosts = new Map<string, HTMLDivElement>();
/** Tabs whose xterm hasn't been created yet (newly opened). */
export const terminalPendingInit = new Set<string>();
/** Tabs whose existing xterm bundle needs to be re-parented onto a
 *  freshly mounted host div (after a route remount). */
export const terminalPendingReattach = new Set<string>();
/** Monotonic counter for default `shell N` labels. Survives unmount so
 *  closing tab 2 and opening a new one gives `shell 3`, matching the
 *  original component behaviour. */
export const terminalLabelCounter = { value: 0 };
