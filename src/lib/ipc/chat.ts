import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ───────────────────────── Chat ─────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessageDto {
  role: ChatRole;
  content: string;
  /** T1.5b — optional multimodal attachment pointers. The Rust adapter
   *  reads the paths, base64-encodes the bytes, and assembles an OpenAI
   *  `content` array for vision-capable providers. Non-image MIMEs
   *  degrade to a `[attached: foo.pdf]` text marker. Omit entirely for
   *  plain-text turns so the wire stays minimal. */
  attachments?: ChatMessageAttachment[];
}

/** Thin reference to a staged attachment — matches the Rust
 *  `ChatAttachmentRef` DTO. Paths are whatever `attachment_stage_*`
 *  returned; the frontend treats them as opaque. */
export interface ChatMessageAttachment {
  path: string;
  mime: string;
  name: string;
}

export interface ChatSendArgs {
  messages: ChatMessageDto[];
  model?: string;
  cwd?: string;
  adapter_id?: string;
  model_supports_vision?: boolean;
}

export interface ChatSendReply {
  content: string;
}

/**
 * Non-streaming chat. Caller owns the history and sends the whole array on
 * each turn.
 */
export function chatSend(args: ChatSendArgs): Promise<ChatSendReply> {
  return invoke<ChatSendReply>('chat_send', { args });
}

// ───────────────────────── Streaming chat ─────────────────────────

export interface ChatStreamDone {
  finish_reason: string | null;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export interface ChatStreamHandle {
  /** Cancel listeners and ask backend to abort the running stream task. */
  cancel: () => Promise<void>;
}

/** Agent-annotated tool-progress marker. Emitted by Hermes as a
 *  `hermes.tool.progress` SSE event when the agent kicks off a tool call
 *  (terminal, file_read, web_search, etc.). The tool's OUTPUT lands in
 *  subsequent `onDelta` chunks — this marker is purely a UI hint. */
export interface ChatToolProgress {
  tool: string;
  emoji: string | null;
  label: string | null;
}

export interface ChatApprovalRequest {
  command: string;
  pattern_key?: string | null;
  pattern_keys?: string[];
  description: string;
  _session_id?: string;
}

export interface ChatStreamCallbacks {
  onDelta: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onTool?: (progress: ChatToolProgress) => void;
  onApproval?: (approval: ChatApprovalRequest) => void;
  onDone: (summary: ChatStreamDone) => void;
  onError: (err: unknown) => void;
}

/**
 * Streaming chat. Generates a handle on the frontend, attaches listeners
 * first, THEN kicks off the backend task — this avoids the race where early
 * deltas might fire before subscription is live.
 */
export async function chatStream(
  args: ChatSendArgs,
  cbs: ChatStreamCallbacks,
): Promise<ChatStreamHandle> {
  const handle = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const unlistens: UnlistenFn[] = [];
  unlistens.push(
    await listen<string>(`chat:delta:${handle}`, (e) => cbs.onDelta(e.payload)),
  );
  if (cbs.onReasoning) {
    const onReasoning = cbs.onReasoning;
    unlistens.push(
      await listen<string>(`chat:reasoning:${handle}`, (e) =>
        onReasoning(e.payload),
      ),
    );
  }
  if (cbs.onTool) {
    const onTool = cbs.onTool;
    unlistens.push(
      await listen<ChatToolProgress>(`chat:tool:${handle}`, (e) => onTool(e.payload)),
    );
  }
  if (cbs.onApproval) {
    const onApproval = cbs.onApproval;
    unlistens.push(
      await listen<ChatApprovalRequest>(`chat:approval:${handle}`, (e) =>
        onApproval(e.payload),
      ),
    );
  }
  unlistens.push(
    await listen<ChatStreamDone>(`chat:done:${handle}`, async (e) => {
      cbs.onDone(e.payload);
      await disposeAll(unlistens);
    }),
  );
  unlistens.push(
    await listen(`chat:error:${handle}`, async (e) => {
      cbs.onError(e.payload);
      await disposeAll(unlistens);
    }),
  );

  try {
    await invoke<string>('chat_stream_start', {
      args: { ...args, handle },
    });
  } catch (e) {
    await disposeAll(unlistens);
    throw e;
  }

  return {
    cancel: async () => {
      await Promise.allSettled([
        invoke('chat_stream_cancel', { args: { handle } }),
        disposeAll(unlistens),
      ]);
    },
  };
}

async function disposeAll(unlistens: UnlistenFn[]): Promise<void> {
  await Promise.allSettled(unlistens.map((u) => Promise.resolve(u())));
  unlistens.length = 0;
}

export async function hermesApprovalRespond(
  sessionId: string,
  choice: string,
): Promise<unknown> {
  return invoke('hermes_approval_respond', {
    args: { sessionId, choice },
  });
}

/**
 * Ask the LLM for a short session title (≤6 words / ≤12 chars for CJK).
 * Returns null if the gateway errors or the response is unusable — the caller
 * should keep the heuristic title in that case.
 */
export async function generateTitle(
  firstUserMessage: string,
  firstAssistantReply: string,
): Promise<string | null> {
  const prompt: ChatMessageDto[] = [
    {
      role: 'system',
      content:
        'You generate concise chat titles. Reply with ONLY the title — no quotes, no punctuation at the end, no "Title:" prefix. Match the user language. Keep it under 6 words (or 12 Chinese characters).',
    },
    {
      role: 'user',
      content: `USER:\n${firstUserMessage.slice(0, 500)}\n\nASSISTANT:\n${firstAssistantReply.slice(0, 500)}\n\nTitle:`,
    },
  ];
  try {
    const { content } = await chatSend({ messages: prompt });
    const cleaned = content
      .trim()
      .replace(/^["'「『《]+|["'」』》]+$/g, '')
      .replace(/[.。!！?？…]+$/, '')
      .replace(/\s+/g, ' ');
    if (!cleaned) return null;
    // Hard-cap length — some models ignore word limits.
    return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
  } catch {
    return null;
  }
}

// ───────────────────────── Models ─────────────────────────

export interface ModelCapabilities {
  vision: boolean;
  tool_use: boolean;
  reasoning: boolean;
  audio?: boolean | null;
  max_output_tokens?: number | null;
}

export interface ModelInfo {
  id: string;
  provider: string;
  display_name: string | null;
  context_window: number | null;
  is_default: boolean;
  capabilities: ModelCapabilities;
}

/** Query the default adapter's `/v1/models` (or fixture in stub mode). */
export function modelList(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('model_list');
}

// ───────────────────────── SQLite persistence ─────────────────────────

export interface DbSessionRow {
  id: string;
  title: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  /** T5.5c — which adapter created this session. Frozen at creation
   *  (see `db.rs :: upsert_session` COALESCE). Pre-T5.5c rows were
   *  backfilled to `'hermes'` by the v5 migration. */
  adapter_id: string;
  /** v10 — per-session LLM-Profile pin. When non-null, chat turns
   *  route through `hermes:profile:<id>` regardless of
   *  `adapter_id` (which continues to drive sidebar grouping).
   *  Null/absent = no profile pin. Mutable across upserts. */
  llm_profile_id?: string | null;
  gateway_source?: string | null;
}

export interface DbMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  error: string | null;
  position: number;
  created_at: number;
  /** Stamped after the stream completes via `dbMessageSetUsage`. `null` /
   *  absent on user messages and on pre-T2.4 legacy rows. */
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  /** T6.1 — user rating: `'up'`, `'down'`, or absent/`null` (unrated).
   *  Only assistant messages get rated in the UI but the column lives
   *  on every row. */
  feedback?: 'up' | 'down' | null;
}

export interface DbToolCallRow {
  id: string;
  message_id: string;
  tool: string;
  emoji: string | null;
  label: string | null;
  at: number;
}

/** T1.5 — attachment row mirror. `path` is the absolute location on disk
 *  under `~/.hermes/attachments/`. The frontend never reads the blob
 *  itself; it treats the path as opaque. */
export interface DbAttachmentRow {
  id: string;
  message_id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: number;
}

export interface DbMessageWithTools extends DbMessageRow {
  tool_calls: DbToolCallRow[];
  /** `undefined` for legacy rows (v<4) and for messages with no attachments
   *  — Rust skips the field when empty. */
  attachments?: DbAttachmentRow[];
}

export interface DbSessionWithMessages extends DbSessionRow {
  messages: DbMessageWithTools[];
}

/** Bulk load everything for app-startup hydration. Returns sessions in
 *  `updated_at DESC` order (MRU first). */
export function dbLoadAll(): Promise<DbSessionWithMessages[]> {
  return invoke<DbSessionWithMessages[]>('db_load_all');
}

/** Upsert a session row. Fire-and-forget on mutations. */
export function dbSessionUpsert(session: DbSessionRow): Promise<void> {
  return invoke<void>('db_session_upsert', { session });
}

/** Delete a session. Cascades to messages + tool_calls. */
export function dbSessionDelete(id: string): Promise<void> {
  return invoke<void>('db_session_delete', { id });
}

/** Upsert a message row. Used both for initial append and for streaming
 *  content accumulation (content field rewritten each delta). */
export function dbMessageUpsert(message: DbMessageRow): Promise<void> {
  return invoke<void>('db_message_upsert', { message });
}

/** Stamp provider-reported token usage onto a message after streaming
 *  completes. The backend preserves existing values when passed `null`, so
 *  subsequent content-only upserts don't wipe tokens. */
export function dbMessageSetUsage(args: {
  messageId: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): Promise<void> {
  return invoke<void>('db_message_set_usage', {
    messageId: args.messageId,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
  });
}

/** T6.1 — stamp or clear a 👍/👎 rating on an assistant message.
 *  Pass `feedback = null` to clear. The backend rejects values other
 *  than `'up'`, `'down'`, or `null` with an `IpcError`. */
export function dbMessageSetFeedback(args: {
  messageId: string;
  feedback: 'up' | 'down' | null;
}): Promise<void> {
  return invoke<void>('db_message_set_feedback', {
    messageId: args.messageId,
    feedback: args.feedback,
  });
}

/** Append a tool-call annotation. Primary-key conflicts are silently
 *  ignored so duplicate emissions don't blow up. */
export function dbToolCallAppend(call: DbToolCallRow): Promise<void> {
  return invoke<void>('db_tool_call_append', { call });
}

// ───────────────────────── Attachments (T1.5) ─────────────────────────

/** Metadata returned by the Rust `attachment_stage_*` commands after a
 *  blob or picked file has been written under `~/.hermes/attachments/`.
 *  Mirrors `crate::attachments::StagedAttachment`. */
export interface StagedAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: number;
}

/** Stage a base64-encoded blob (clipboard paste, drag-and-drop File read
 *  via FileReader). The display `name` + `mime` travel with it so the UI
 *  can label the chip and, later, tell the provider what it's dealing
 *  with for multimodal requests. */
export function attachmentStageBlob(args: {
  name: string;
  mime: string;
  base64Body: string;
}): Promise<StagedAttachment> {
  return invoke<StagedAttachment>('attachment_stage_blob', args);
}

/** Stage an absolute on-disk path the user picked from a native file
 *  dialog. `mimeHint` is optional; if omitted the backend falls back to
 *  a tiny extension table. `sandboxScopeId` (T6.5) routes the sandbox
 *  check through the given scope — `undefined`, empty string, or
 *  `"default"` all resolve to the default scope. Paths outside the
 *  scope's roots surface as `SandboxConsentRequired` before the copy. */
export function attachmentStagePath(args: {
  path: string;
  mimeHint?: string;
  sandboxScopeId?: string | null;
}): Promise<StagedAttachment> {
  return invoke<StagedAttachment>('attachment_stage_path', args);
}

/** Remove a staged file from disk. Idempotent. The DB row (if any) is
 *  deleted separately via `dbAttachmentDelete`. */
export function attachmentDelete(path: string): Promise<void> {
  return invoke<void>('attachment_delete', { path });
}

/** T1.5d — read a staged image and return a `data:<mime>;base64,<…>`
 *  URL suitable for `<img src="…">`. Caller passes the same `path` that's
 *  persisted on the attachment row; the backend sandbox-checks it and
 *  caps the size. Rejects non-image MIMEs. */
export function attachmentPreview(
  path: string,
  mime?: string | null,
): Promise<string> {
  return invoke<string>('attachment_preview', {
    path,
    mime,
  });
}

export function attachmentThumbnail(path: string): Promise<string> {
  return invoke<string>('attachment_thumbnail', { path });
}

/** Summary of a T1.5e GC pass. `failed` lists per-file error strings so
 *  the caller can surface them to devtools without swallowing silently. */
export interface AttachmentGcReport {
  removed_count: number;
  removed_bytes: number;
  failed: string[];
}

/** T1.5e — sweep orphan attachment files. The frontend gathers every
 *  path it sees across all hydrated messages and passes them as
 *  `livePaths`; everything else under `~/.hermes/attachments/` gets
 *  reaped. Safe to call on every app start. */
export function attachmentGc(livePaths: string[]): Promise<AttachmentGcReport> {
  return invoke<AttachmentGcReport>('attachment_gc', { livePaths });
}

/** Insert an attachment row into the DB once the message it belongs to
 *  has been persisted. Duplicate ids surface as an error (uuid collision
 *  would be astronomical — treat as a client bug). */
export function dbAttachmentInsert(attachment: DbAttachmentRow): Promise<void> {
  return invoke<void>('db_attachment_insert', { attachment });
}

/** Delete the DB row for an attachment. */
export function dbAttachmentDelete(id: string): Promise<void> {
  return invoke<void>('db_attachment_delete', { id });
}

// ───────────────────────── Analytics ─────────────────────────

export interface NamedCount {
  name: string;
  count: number;
}

export interface DayCount {
  /** ISO date (UTC) `YYYY-MM-DD`. The UI localizes at render time. */
  date: string;
  count: number;
}

export interface AnalyticsTotals {
  sessions: number;
  messages: number;
  tool_calls: number;
  active_days: number;
  /** Lifetime token sums across all assistant messages that have usage
   *  recorded. Pre-T2.4 rows contribute 0. */
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** T6.1 — lifetime 👍 / 👎 counts across all messages. Pre-T6.1
   *  rows (feedback=NULL) contribute 0 to both. */
  feedback_up: number;
  feedback_down: number;
}

export interface AnalyticsSummaryDto {
  totals: AnalyticsTotals;
  /** Dates with ≥1 messages in the trailing 30 days. Sparse; UI pads zeros. */
  messages_per_day: DayCount[];
  /** `(prompt + completion)`-tokens per UTC day for the trailing 30 days.
   *  Days with no usage are omitted; the UI aligns this series with
   *  `messages_per_day` when rendering the combined chart. */
  tokens_per_day: DayCount[];
  model_usage: NamedCount[];
  tool_usage: NamedCount[];
  /** T5.6 — session count per adapter, in descending count order.
   *  Includes every adapter that has at least one session in the DB;
   *  no `LIMIT`. Pre-T5.5c rows surface under `'hermes'` (db v5
   *  backfill). Drives the Analytics "Usage by adapter" card. */
  adapter_usage: NamedCount[];
  /** ms since epoch — the clock snapshot that produced this summary. */
  generated_at: number;
}

/** One-shot rollup for the Analytics page. Cheap (<5 ms on ~10k rows). */
export function analyticsSummary(): Promise<AnalyticsSummaryDto> {
  return invoke<AnalyticsSummaryDto>('analytics_summary');
}

