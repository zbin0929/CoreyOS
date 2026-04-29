/**
 * Type-only companion to `stores/chat.ts` — split out so the store file
 * can focus on IPC + state-machine plumbing. Consumers keep importing
 * these from `@/stores/chat` via the re-exports at the bottom of
 * `chat.ts`; this module is internal to the stores package.
 */

export interface UiSuggestion {
  id: string;
  type: 'schedule' | 'workflow';
  title: string;
  subtitle?: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'done' | 'error';
  resultText?: string;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  suggestions?: UiSuggestion[];
  content: string;
  /** Reasoning / chain-of-thought tokens accumulated from the
   *  `chat:reasoning:*` stream. Present on assistant messages produced
   *  by reasoning-capable models (deepseek-reasoner, o1) and absent
   *  otherwise. Rendered as a collapsible panel ABOVE the main bubble
   *  body so the final answer stays the visual focus. */
  reasoning?: string;
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
  /** T6.1 — per-message 👍/👎 rating. Only set on assistant messages via
   *  the feedback buttons below each bubble. `undefined`/`null` =
   *  unrated. */
  feedback?: 'up' | 'down' | null;
  createdAt: number;
}

export interface UiToolCall {
  id: string;
  tool: string;
  emoji?: string | null;
  label?: string | null;
  at: number;
  args?: string | null;
  result?: string | null;
  duration_ms?: number | null;
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
  /** T5.5c — which adapter owns this session. Frozen at creation (matches
   *  the DB COALESCE in `upsert_session`); drives the unified inbox's
   *  per-row badge + adapter filter. Sessions created before T5.5c
   *  shipped land here as `'hermes'` (db v5 backfill). */
  adapterId: string;
  gatewayId?: string;
  gatewaySource?: string | null;
  /** v10 — per-session LLM-Profile pin. When set, chat send/retry
   *  routes this session's turns through `hermes:profile:<id>`
   *  (registered at boot / on-demand via `llmProfileEnsureAdapter`)
   *  regardless of the session's owning `adapterId`. Independent from
   *  `adapterId` so picking a profile in the chat model picker
   *  doesn't migrate the session across agents in the sidebar. */
  llmProfileId?: string | null;
}

export interface ChatState {
  /** `null` during the first render before a session is created. */
  currentId: string | null;
  sessions: Record<string, ChatSession>;
  /** Most-recently-used first. */
  orderedIds: string[];
  /** `true` once `hydrateFromDb` has run. Prevents the Chat view from
   *  creating a throwaway session before we know what's on disk. */
  hydrated: boolean;
  lastLearningAt: number | null;

  // actions
  /** Called once on app start. Reads all sessions from SQLite into zustand. */
  hydrateFromDb: () => Promise<void>;

  newSession: () => string;
  switchTo: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Set `null` to clear the override (revert to default). */
  setSessionModel: (id: string, model: string | null) => void;
  /** v10 — pin (or clear) the per-session LLM Profile routing. Passing
   *  `null` clears the pin so the next turn routes through the
   *  session's owning `adapterId` or the global AgentSwitcher choice.
   *  Does NOT touch `adapterId` (sidebar grouping stays put). The
   *  model argument, when non-null, is also stored as the session's
   *  model override so the composer shows the profile's model in the
   *  badge; pass `null` to leave the current model override as-is. */
  setSessionLlmProfile: (
    id: string,
    profileId: string | null,
    model: string | null,
  ) => void;

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
  /** T6.1 — stamp (or clear with `null`) a 👍/👎 rating on a message.
   *  Persists via `db_message_set_feedback` so reloads preserve it. */
  setMessageFeedback: (
    sessionId: string,
    msgId: string,
    value: 'up' | 'down' | null,
  ) => void;

  /** True when at least one session exists. Used to gate rendering. */
  hasSessions: () => boolean;

  importGatewayMessages: (
    sessionId: string,
    msgs: readonly { role: string; content: string; timestamp: number }[],
  ) => void;

  importGatewaySession: (gs: import('@/lib/ipc').GatewaySession) => string;

  lastTokenUsage: { prompt: number; completion: number } | null;
  setLastTokenUsage: (usage: { prompt: number; completion: number } | null) => void;
}
