import { create } from 'zustand';
import {
  attachmentGc,
  dbAttachmentInsert,
  dbLoadAll,
  dbMessageUpsert,
  dbSessionDelete,
  dbSessionUpsert,
  dbToolCallAppend,
  type DbSessionWithMessages,
} from '@/lib/ipc';
import { useAppStatusStore } from './appStatus';

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
  /** T1.5 — attachments carried by this message. Only populated on user
   *  messages today (the composer stages files and hands them over on
   *  send). Hydrated from `DbAttachmentRow`. */
  attachments?: UiAttachment[];
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

/** UI-side attachment metadata. Mirrors `DbAttachmentRow` but uses
 *  camelCase like the rest of the zustand schema. `path` is an opaque
 *  on-disk location — the frontend never reads it. */
export interface UiAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  createdAt: number;
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
  /** `true` once `hydrateFromDb` has run. Prevents the Chat view from
   *  creating a throwaway session before we know what's on disk. */
  hydrated: boolean;

  // actions
  /** Called once on app start. Reads all sessions from SQLite into zustand. */
  hydrateFromDb: () => Promise<void>;

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

/** Fire-and-forget DB write. Logs to console on failure — data loss is
 *  acceptable here since zustand is the hot source of truth while the app
 *  is open; the DB is for persistence across restarts. */
function fireWrite(p: Promise<unknown>, label: string): void {
  p.catch((e) => {
    console.error(`db write failed [${label}]:`, e);
  });
}

/** Serialize one hydrated SQL row into our zustand schema. */
function sessionFromDb(s: DbSessionWithMessages): ChatSession {
  return {
    id: s.id,
    title: s.title,
    model: s.model,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    messages: s.messages.map((m) => ({
      id: m.id,
      role: (m.role === 'user' ? 'user' : 'assistant') as UiMessage['role'],
      content: m.content,
      error: m.error ?? undefined,
      createdAt: m.created_at,
      toolCalls:
        m.tool_calls.length > 0
          ? m.tool_calls.map<UiToolCall>((t) => ({
              id: t.id,
              tool: t.tool,
              emoji: t.emoji,
              label: t.label,
              at: t.at,
            }))
          : undefined,
      attachments:
        m.attachments && m.attachments.length > 0
          ? m.attachments.map<UiAttachment>((a) => ({
              id: a.id,
              name: a.name,
              mime: a.mime,
              size: a.size,
              path: a.path,
              createdAt: a.created_at,
            }))
          : undefined,
    })),
  };
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

export const useChatStore = create<ChatState>()((set, get) => ({
  currentId: null,
  sessions: {},
  orderedIds: [],
  hydrated: false,

  hydrateFromDb: async () => {
    // Idempotent guard: if a previous call already completed (or is in-flight
    // but the flag hasn't flipped yet), don't re-enter. Safe under React
    // StrictMode's double-mount in dev.
    if (get().hydrated) return;
    try {
      const rows = await dbLoadAll();
      // Re-check after the await in case a concurrent call beat us.
      if (get().hydrated) return;
      const sessions: Record<string, ChatSession> = {};
      const orderedIds: string[] = [];
      for (const row of rows) {
        sessions[row.id] = sessionFromDb(row);
        orderedIds.push(row.id);
      }
      set({
        sessions,
        orderedIds,
        // Restore the MRU session if one exists; otherwise null so the UI
        // creates a fresh one.
        currentId: orderedIds[0] ?? null,
        hydrated: true,
      });

      // T1.5e — opportunistic orphan GC. Collect every attachment path
      // the DB believes is live and ask the backend to sweep the rest.
      // Fire-and-forget; a failure here is non-fatal and shouldn't
      // delay the UI — we just log to the console and move on. Done
      // AFTER set() so even a slow GC never blocks the first paint.
      const livePaths: string[] = [];
      for (const row of rows) {
        for (const m of row.messages) {
          if (m.attachments) {
            for (const a of m.attachments) livePaths.push(a.path);
          }
        }
      }
      fireWrite(
        attachmentGc(livePaths).then((report) => {
          if (report.removed_count > 0 || report.failed.length > 0) {
            console.info('[attachments.gc]', report);
          }
        }),
        'attachmentGc',
      );
    } catch (e) {
      console.error('db hydrate failed:', e);
      // Still mark as hydrated so the UI unblocks — users start fresh.
      set({ hydrated: true });
    }
  },

  newSession: () => {
    const id = newId('s');
    const now = Date.now();
    // Stamp the current default model onto the session row so Analytics can
    // group by `model` instead of lumping everything under `unknown`. This
    // reads the cached value populated by `appStatus.refreshModel` at boot;
    // if the app hasn't resolved a model yet we still write `null` (which
    // SQL's `COALESCE(NULLIF(...), 'unknown')` catches cleanly).
    const defaultModel = useAppStatusStore.getState().currentModel;
    const session: ChatSession = {
      id,
      title: 'New chat',
      model: defaultModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      sessions: { ...s.sessions, [id]: session },
      orderedIds: [id, ...s.orderedIds],
      currentId: id,
    }));
    fireWrite(
      dbSessionUpsert({
        id,
        title: session.title,
        model: defaultModel,
        created_at: now,
        updated_at: now,
      }),
      'newSession',
    );
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
    fireWrite(dbSessionDelete(id), 'deleteSession');
  },

  renameSession: (id, title) => {
    const now = Date.now();
    let nextTitle: string | null = null;
    set((s) => {
      const sess = s.sessions[id];
      if (!sess) return s;
      nextTitle = title.trim() || sess.title;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...sess, title: nextTitle, updatedAt: now },
        },
      };
    });
    const sess = get().sessions[id];
    if (sess && nextTitle !== null) {
      fireWrite(
        dbSessionUpsert({
          id,
          title: nextTitle,
          model: sess.model ?? null,
          created_at: sess.createdAt,
          updated_at: now,
        }),
        'renameSession',
      );
    }
  },

  setSessionModel: (id, model) => {
    const now = Date.now();
    set((s) => {
      const sess = s.sessions[id];
      if (!sess) return s;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...sess, model, updatedAt: now },
        },
      };
    });
    const sess = get().sessions[id];
    if (sess) {
      fireWrite(
        dbSessionUpsert({
          id,
          title: sess.title,
          model,
          created_at: sess.createdAt,
          updated_at: now,
        }),
        'setSessionModel',
      );
    }
  },

  appendMessage: (sessionId, msg) => {
    let position = 0;
    let sessSnapshot: ChatSession | null = null;
    let nextTitle = '';
    const updatedAt = Date.now();
    set((s) => {
      const sess = s.sessions[sessionId];
      if (!sess) return s;
      const nextMessages = [...sess.messages, msg];
      nextTitle =
        sess.title === 'New chat' ? deriveTitle(nextMessages) : sess.title;
      position = sess.messages.length;
      const nextOrder = [
        sessionId,
        ...s.orderedIds.filter((x) => x !== sessionId),
      ];
      const updatedSess: ChatSession = {
        ...sess,
        messages: nextMessages,
        title: nextTitle,
        updatedAt,
      };
      sessSnapshot = updatedSess;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: updatedSess,
        },
        orderedIds: nextOrder,
      };
    });
    if (sessSnapshot) {
      const sess = sessSnapshot as ChatSession;
      fireWrite(
        dbSessionUpsert({
          id: sessionId,
          title: sess.title,
          model: sess.model ?? null,
          created_at: sess.createdAt,
          updated_at: sess.updatedAt,
        }),
        'appendMessage.session',
      );
      fireWrite(
        dbMessageUpsert({
          id: msg.id,
          session_id: sessionId,
          role: msg.role,
          content: msg.content,
          error: msg.error ?? null,
          position,
          created_at: msg.createdAt,
        }),
        'appendMessage.message',
      );
      // T1.5 — persist each attachment row now that its parent message
      // exists. Done inline (not via a separate store action) so a crash
      // mid-batch can't leave the DB with a message minus its chips;
      // fire-and-forget lets individual inserts fail without blocking
      // the chat stream that's already underway.
      if (msg.attachments && msg.attachments.length > 0) {
        for (const a of msg.attachments) {
          fireWrite(
            dbAttachmentInsert({
              id: a.id,
              message_id: msg.id,
              name: a.name,
              mime: a.mime,
              size: a.size,
              path: a.path,
              created_at: a.createdAt,
            }),
            'appendMessage.attachment',
          );
        }
      }
    }
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
    fireWrite(
      dbToolCallAppend({
        id: call.id,
        message_id: msgId,
        tool: call.tool,
        emoji: call.emoji ?? null,
        label: call.label ?? null,
        at: call.at,
      }),
      'appendToolCall',
    );
  },

  patchMessage: (sessionId, msgId, patch) => {
    // Track the final state of the message so we can mirror it to the DB
    // outside the setter.
    let updated: UiMessage | null = null;
    let position = -1;
    set((s) => {
      const sess = s.sessions[sessionId];
      if (!sess) return s;
      let touched = false;
      const nextMessages = sess.messages.map((m, idx) => {
        if (m.id !== msgId) return m;
        touched = true;
        const merged = { ...m, ...patch };
        updated = merged;
        position = idx;
        return merged;
      });
      if (!touched) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...sess, messages: nextMessages, updatedAt: Date.now() },
        },
      };
    });
    // Only mirror content/error/role — `pending` is a UI-only flag and isn't
    // stored. Skip the write if the message doesn't exist.
    if (updated) {
      const u = updated as UiMessage;
      fireWrite(
        dbMessageUpsert({
          id: u.id,
          session_id: sessionId,
          role: u.role,
          content: u.content,
          error: u.error ?? null,
          position,
          created_at: u.createdAt,
        }),
        'patchMessage',
      );
    }
  },

  hasSessions: () => get().orderedIds.length > 0,
}));

export const newMessageId = () => newId('m');
