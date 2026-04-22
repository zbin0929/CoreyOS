import { create } from 'zustand';

/**
 * T4.6 — a one-shot prompt that the Chat composer picks up on mount.
 *
 * Set from Runbooks (inline "Use" button or command palette) or anywhere
 * else that needs to "send the user to chat with this text primed". The
 * composer reads + clears on first render. We keep it module-level (not
 * persisted) because a stale draft surviving a reload would surprise the
 * user more than it would help.
 */
interface ComposerState {
  pendingDraft: string | null;
  setPendingDraft: (text: string | null) => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  pendingDraft: null,
  setPendingDraft: (text) => set({ pendingDraft: text }),
}));
