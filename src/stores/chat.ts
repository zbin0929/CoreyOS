import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** True while waiting on the first delta. */
  pending?: boolean;
  /** Frontend-only error text (shown inline as a red bubble). */
  error?: string;
  /** Tool-progress markers emitted by the agent during this turn. */
  toolCalls?: UiToolCall[];
  createdAt: number;
}

export interface UiToolCall {
  /** Stable id so React can key the list. */
  id: string;
  tool: string;
  emoji?: string | null;
  label?: string | null;
  at: number;
}

export interface ChatSession {
  id: string;
  /** Auto-derived from the first user message; falls back to `New chat`. */
  title: string;
  messages: UiMessage[];
  createdAt: number;
  updatedAt: number;
  /**
   * Per-session model override. `null` (or missing) means "use the gateway's
   * configured default" (read from Settings).
   */
  model?: string | null;
}

interface ChatState {
  /** `null` during the first render before a session is created. */
  currentId: string | null;
  sessions: Record<string, ChatSession>;
  /** Most-recently-used first. */
  orderedIds: string[];

  // actions
  newSession: () => string;
  switchTo: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Set `null` to clear the override (revert to default). */
  setSessionModel: (id: string, model: string | null) => void;

  /** Append a fully-formed message (user or assistant). */
  appendMessage: (sessionId: string, msg: UiMessage) => void;
  /** Patch a message's fields (content accumulation, pending → false, etc). */
  patchMessage: (
    sessionId: string,
    msgId: string,
    patch: Partial<Omit<UiMessage, 'id'>>,
  ) => void;
  /** Append a tool-progress marker to a message (race-free vs content updates). */
  appendToolCall: (sessionId: string, msgId: string, call: UiToolCall) => void;

  /** True when at least one session exists. Used to gate rendering. */
  hasSessions: () => boolean;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fallback heuristic title from the first user message — used until the LLM
 * title generator returns (async, see ipc.ts `generateTitle`).
 * Keeps it short and stops at the first sentence/clause boundary.
 */
function deriveTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return 'New chat';
  const normalized = firstUser.content.trim().replace(/\s+/g, ' ');
  // Split on common sentence enders (EN + CN).
  const match = normalized.match(/^[^.!?。！？\n]{1,30}/);
  const head = match ? match[0] : normalized.slice(0, 30);
  return head.length < normalized.length ? head + '…' : head;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      currentId: null,
      sessions: {},
      orderedIds: [],

      newSession: () => {
        const id = newId('s');
        const now = Date.now();
        const session: ChatSession = {
          id,
          title: 'New chat',
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          sessions: { ...s.sessions, [id]: session },
          orderedIds: [id, ...s.orderedIds],
          currentId: id,
        }));
        return id;
      },

      switchTo: (id) => {
        const state = get();
        if (!state.sessions[id]) return;
        set({ currentId: id });
      },

      deleteSession: (id) => {
        set((s) => {
          if (!s.sessions[id]) return s;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _removed, ...rest } = s.sessions;
          const nextOrder = s.orderedIds.filter((x) => x !== id);
          const nextCurrent =
            s.currentId === id ? (nextOrder[0] ?? null) : s.currentId;
          return {
            sessions: rest,
            orderedIds: nextOrder,
            currentId: nextCurrent,
          };
        });
      },

      renameSession: (id, title) => {
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...sess, title: title.trim() || sess.title, updatedAt: Date.now() },
            },
          };
        });
      },

      setSessionModel: (id, model) => {
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...sess, model, updatedAt: Date.now() },
            },
          };
        });
      },

      appendMessage: (sessionId, msg) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const nextMessages = [...sess.messages, msg];
          const nextTitle =
            sess.title === 'New chat' ? deriveTitle(nextMessages) : sess.title;
          const updatedAt = Date.now();
          // Bump to top of the MRU list.
          const nextOrder = [
            sessionId,
            ...s.orderedIds.filter((x) => x !== sessionId),
          ];
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...sess,
                messages: nextMessages,
                title: nextTitle,
                updatedAt,
              },
            },
            orderedIds: nextOrder,
          };
        });
      },

      appendToolCall: (sessionId, msgId, call) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          let touched = false;
          const nextMessages = sess.messages.map((m) => {
            if (m.id !== msgId) return m;
            touched = true;
            return { ...m, toolCalls: [...(m.toolCalls ?? []), call] };
          });
          if (!touched) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, messages: nextMessages, updatedAt: Date.now() },
            },
          };
        });
      },

      patchMessage: (sessionId, msgId, patch) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          let touched = false;
          const nextMessages = sess.messages.map((m) => {
            if (m.id !== msgId) return m;
            touched = true;
            return { ...m, ...patch };
          });
          if (!touched) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, messages: nextMessages, updatedAt: Date.now() },
            },
          };
        });
      },

      hasSessions: () => get().orderedIds.length > 0,
    }),
    {
      name: 'caduceus.chat.v1',
      // Full state is persisted; payload is small for Sprint 2 (pure text).
      partialize: (s) => ({
        currentId: s.currentId,
        sessions: s.sessions,
        orderedIds: s.orderedIds,
      }),
    },
  ),
);

export const newMessageId = () => newId('m');
