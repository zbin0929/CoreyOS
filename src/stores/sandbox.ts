/**
 * Sandbox state + consent queue.
 *
 * Two responsibilities:
 * 1. Cache the current sandbox mode + roots for the Settings UI.
 * 2. Surface a queue of ConsentRequired prompts so any IPC wrapper can
 *    `requestConsent(path)` and either get back a decision (Allow/Deny) or
 *    wait for the user to interact with the modal mounted at app root.
 *
 * The Rust backend never blocks on consent — it returns `ConsentRequired`
 * synchronously, and the frontend resolves it by calling `sandbox_grant_once`
 * or `sandbox_add_root` and retrying the original IPC.
 */
import { create } from 'zustand';
import {
  sandboxGetState,
  sandboxAddRoot,
  sandboxRemoveRoot,
  sandboxGrantOnce,
  sandboxSetEnforced,
  sandboxClearSessionGrants,
  type SandboxStateDto,
  type SandboxAccessMode,
  type SandboxRoot,
} from '@/lib/ipc';

export type ConsentDecision =
  | { kind: 'grant_once' }
  | { kind: 'add_root'; mode: SandboxAccessMode; label?: string }
  | { kind: 'deny' };

export interface ConsentRequest {
  id: string;
  path: string;
  resolve: (d: ConsentDecision) => void;
}

interface SandboxStoreState {
  hydrated: boolean;
  mode: SandboxStateDto['mode'];
  roots: SandboxRoot[];
  sessionGrants: string[];
  configPath: string;

  /** Queue of pending consent prompts. The `ConsentModal` consumes the
   *  head of this queue and renders one prompt at a time. */
  pending: ConsentRequest[];

  refresh: () => Promise<void>;
  addRoot: (args: { path: string; label: string; mode: SandboxAccessMode }) => Promise<void>;
  removeRoot: (path: string) => Promise<void>;
  setEnforced: () => Promise<void>;
  clearSessionGrants: () => Promise<void>;

  /** Open a consent prompt and await the user's decision. The caller is
   *  responsible for acting on the decision (calling `sandboxGrantOnce` /
   *  `sandboxAddRoot` and retrying). */
  requestConsent: (path: string) => Promise<ConsentDecision>;
  /** Resolve the head of the queue. Called by the modal. */
  resolvePending: (id: string, decision: ConsentDecision) => void;
}

let reqSeq = 0;

export const useSandboxStore = create<SandboxStoreState>()((set, get) => ({
  hydrated: false,
  mode: 'dev_allow',
  roots: [],
  sessionGrants: [],
  configPath: '',
  pending: [],

  refresh: async () => {
    try {
      const st = await sandboxGetState();
      set({
        hydrated: true,
        mode: st.mode,
        roots: st.roots,
        sessionGrants: st.session_grants,
        configPath: st.config_path,
      });
    } catch {
      // leave whatever was cached
    }
  },

  addRoot: async (args) => {
    await sandboxAddRoot(args);
    await get().refresh();
  },

  removeRoot: async (path) => {
    await sandboxRemoveRoot(path);
    await get().refresh();
  },

  setEnforced: async () => {
    await sandboxSetEnforced();
    await get().refresh();
  },

  clearSessionGrants: async () => {
    await sandboxClearSessionGrants();
    await get().refresh();
  },

  requestConsent: (path) =>
    new Promise<ConsentDecision>((resolve) => {
      const id = `c${++reqSeq}`;
      set((s) => ({ pending: [...s.pending, { id, path, resolve }] }));
    }),

  resolvePending: (id, decision) => {
    const req = get().pending.find((p) => p.id === id);
    if (!req) return;
    req.resolve(decision);
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  },
}));

/**
 * Wrap any IPC call so a `SandboxConsentRequired` rejection opens a consent
 * modal and, on approval, retries the call. `deny` surfaces the original
 * error back to the caller so the UI can show a "denied" state.
 */
export async function withSandboxConsent<T>(
  run: () => Promise<T>,
  path: string,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const { asSandboxConsentRequired } = await import('@/lib/ipc');
    const parsed = asSandboxConsentRequired(e);
    if (!parsed) throw e;
    const store = useSandboxStore.getState();
    const decision = await store.requestConsent(parsed.path || path);
    if (decision.kind === 'grant_once') {
      await sandboxGrantOnce(parsed.path || path);
    } else if (decision.kind === 'add_root') {
      await sandboxAddRoot({
        path: parsed.path || path,
        label: decision.label ?? 'Workspace',
        mode: decision.mode,
      });
      await store.refresh();
    } else {
      throw e;
    }
    return run();
  }
}
