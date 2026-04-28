import { create } from 'zustand';

import {
  attachmentGc,
  dbAttachmentInsert,
  dbLoadAll,
  dbMessageSetFeedback,
  dbMessageUpsert,
  dbSessionDelete,
  dbSessionUpsert,
  dbToolCallAppend,
  gatewaySessionMessages,
  type GatewaySession,
} from '@/lib/ipc';

import { useAgentsStore } from './agents';
import { useAppStatusStore } from './appStatus';
import { deriveTitle, fireWrite, newId, sessionFromDb } from './chatPersist';
import type {
  ChatSession,
  ChatState,
  UiMessage,
} from './chatTypes';

// Re-export the zustand-facing types so `@/stores/chat` consumers keep
// a single import surface. Split into sibling files for navigability.
export type {
  ChatSession,
  ChatState,
  UiAttachment,
  UiMessage,
  UiSuggestion,
  UiToolCall,
} from './chatTypes';

export const useChatStore = create<ChatState>()((set, get) => ({
  currentId: null,
  sessions: {},
  orderedIds: [],
  hydrated: false,
  lastLearningAt: null,
  lastTokenUsage: null,

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
    // T5.5c — stamp the active adapter so the unified inbox can badge
    // + filter. Fallback to the registry default's id (usually
    // `'hermes'`); if the registry hasn't loaded yet, fall back to a
    // hard-coded `'hermes'` so offline-boot sessions still land in a
    // valid bucket (they'll be merged with real Hermes sessions on
    // next hydration).
    const agents = useAgentsStore.getState();
    const adapterId =
      agents.activeId ??
      agents.adapters?.find((a) => a.is_default)?.id ??
      agents.adapters?.[0]?.id ??
      'hermes';
    const session: ChatSession = {
      id,
      title: 'New chat',
      model: defaultModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
      adapterId,
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
        adapter_id: adapterId,
        // Fresh sessions never carry a profile pin. Must be explicit:
        // the Rust upsert replaces this column each call, so omitting
        // it would NULL-out any future flip until the next
        // setSessionLlmProfile write.
        llm_profile_id: null,
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
          adapter_id: sess.adapterId,
          // Preserve the profile pin — Rust’s upsert REPLACES this
          // column each write, so forgetting it would silently drop the
          // user’s profile selection on every rename.
          llm_profile_id: sess.llmProfileId ?? null,
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
          adapter_id: sess.adapterId,
          // Preserve the profile pin; see renameSession for why.
          llm_profile_id: sess.llmProfileId ?? null,
        }),
        'setSessionModel',
      );
    }
  },

  setSessionLlmProfile: (id, profileId, model) => {
    const now = Date.now();
    set((s) => {
      const sess = s.sessions[id];
      if (!sess) return s;
      // Null-coalesce on model: callers pass null to mean "leave the
      // existing model override alone". This matters when the user is
      // clearing a profile by picking a gateway model — they've
      // already called setSessionModel separately for that, and this
      // call is only meant to drop the profile pin.
      const nextModel = model !== null ? model : (sess.model ?? null);
      return {
        sessions: {
          ...s.sessions,
          [id]: {
            ...sess,
            llmProfileId: profileId,
            model: nextModel,
            updatedAt: now,
          },
        },
      };
    });
    const sess = get().sessions[id];
    if (sess) {
      fireWrite(
        dbSessionUpsert({
          id,
          title: sess.title,
          model: sess.model ?? null,
          created_at: sess.createdAt,
          updated_at: now,
          adapter_id: sess.adapterId,
          llm_profile_id: profileId,
        }),
        'setSessionLlmProfile',
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
          adapter_id: sess.adapterId,
          // Preserve the profile pin; see renameSession for why.
          llm_profile_id: sess.llmProfileId ?? null,
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

  setMessageFeedback: (sessionId, msgId, value) => {
    set((s) => {
      const sess = s.sessions[sessionId];
      if (!sess) return s;
      let touched = false;
      const nextMessages = sess.messages.map((m) => {
        if (m.id !== msgId) return m;
        touched = true;
        return { ...m, feedback: value };
      });
      if (!touched) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...sess, messages: nextMessages },
        },
      };
    });
    // Persist via the dedicated IPC so the row's UPDATE doesn't touch
    // content/position (the streaming path owns those).
    fireWrite(
      dbMessageSetFeedback({ messageId: msgId, feedback: value }),
      'setMessageFeedback',
    );
  },

  hasSessions: () => get().orderedIds.length > 0,

  importGatewaySession: (gs: GatewaySession): string => {
    const existing = get().orderedIds.find(
      (id) => get().sessions[id]?.gatewayId === gs.id,
    );
    if (existing) {
      get().switchTo(existing);
      return existing;
    }
    const id = get().newSession();
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: {
          ...s.sessions[id]!,
          title: gs.title || `Gateway: ${gs.source ?? 'unknown'}`,
          gatewayId: gs.id,
          gatewaySource: gs.source,
          adapterId: 'hermes',
        },
      },
    }));
    fireWrite(dbSessionUpsert({ id, title: gs.title || `Gateway: ${gs.source ?? 'unknown'}`, model: gs.model ?? null, created_at: Date.now(), updated_at: Date.now(), adapter_id: 'hermes' }), 'importGatewaySession');
    gatewaySessionMessages(gs.id).then((msgs) => {
      for (const m of msgs) {
        const msgId = newId('m');
        const msg: UiMessage = {
          id: msgId,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          createdAt: m.timestamp,
          pending: false,
        };
        get().appendMessage(id, msg);
      }
    });
    return id;
  },

  setLastTokenUsage: (usage) => set({ lastTokenUsage: usage }),
}));

export const newMessageId = () => newId('m');
