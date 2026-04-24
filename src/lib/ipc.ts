import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface HomeStats {
  path: string;
  entry_count: number;
  sandbox_mode: 'dev-allow' | 'enforced';
}

/** Phase 0 demo — proves the IPC pipe + Rust fs round-trip. */
export function homeStats(): Promise<HomeStats> {
  return invoke<HomeStats>('home_stats');
}

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
  /** T5.1 — optional working directory hint for code-centric adapters. */
  cwd?: string;
  /** T5.5b — route this request to the named adapter; `undefined` uses
   *  the registry default. The Topbar `AgentSwitcher` populates this
   *  from `useAgentsStore.activeId`. */
  adapter_id?: string;
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
  /** Cancel all listeners. The server-side task continues to completion; we
   *  simply stop receiving its events (cheap cancel). */
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

export interface ChatStreamCallbacks {
  onDelta: (chunk: string) => void;
  /** Reasoning-content delta (deepseek-reasoner / o1-style models).
   *  Plain chat models never emit this. When callers omit the handler
   *  reasoning is silently dropped, preserving the pre-T6.x behavior
   *  for UI code that hasn't been updated yet. */
  onReasoning?: (chunk: string) => void;
  onTool?: (progress: ChatToolProgress) => void;
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
    cancel: () => disposeAll(unlistens),
  };
}

async function disposeAll(unlistens: UnlistenFn[]): Promise<void> {
  await Promise.allSettled(unlistens.map((u) => Promise.resolve(u())));
  unlistens.length = 0;
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
    mime: mime ?? null,
  });
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

// ───────────────────────── Runbooks (T4.6) ─────────────────────────

export interface RunbookRow {
  id: string;
  name: string;
  description: string | null;
  /** Raw template string with `{{param}}` placeholders. Substitution is a
   *  frontend concern — `renderRunbook()` in `features/runbooks` does it. */
  template: string;
  /** `null` = usable from any profile. Not currently filtered on. */
  scope_profile: string | null;
  created_at: number;
  updated_at: number;
}

export function runbookList(): Promise<RunbookRow[]> {
  return invoke<RunbookRow[]>('runbook_list');
}

export function runbookUpsert(runbook: RunbookRow): Promise<void> {
  return invoke<void>('runbook_upsert', { runbook });
}

export function runbookDelete(id: string): Promise<void> {
  return invoke<void>('runbook_delete', { id });
}

// ───────────────────────── Budgets (T4.4) ─────────────────────────

export type BudgetScopeKind = 'global' | 'model' | 'profile' | 'adapter' | 'channel';
export type BudgetPeriod = 'day' | 'week' | 'month';
export type BudgetAction = 'notify' | 'block' | 'notify_block';

export interface BudgetRow {
  id: string;
  scope_kind: BudgetScopeKind;
  /** Null for `scope_kind="global"`; a scope identifier otherwise. */
  scope_value: string | null;
  /** Cap in cents. Cost projection lives in the frontend price table. */
  amount_cents: number;
  period: BudgetPeriod;
  action_on_breach: BudgetAction;
  created_at: number;
  updated_at: number;
}

export function budgetList(): Promise<BudgetRow[]> {
  return invoke<BudgetRow[]>('budget_list');
}

export function budgetUpsert(budget: BudgetRow): Promise<void> {
  return invoke<void>('budget_upsert', { budget });
}

export function budgetDelete(id: string): Promise<void> {
  return invoke<void>('budget_delete', { id });
}

// ───────────────────────── Skills (T4.2) ─────────────────────────

export interface SkillSummary {
  /** Relative posix path under `~/.hermes/skills/`, ending in `.md`.
   *  Treat as the stable id. */
  path: string;
  /** Derived name (file stem). */
  name: string;
  /** Parent directory relative to `skills/`. `null` for top-level files. */
  group: string | null;
  size: number;
  updated_at_ms: number;
}

export interface SkillContent {
  path: string;
  body: string;
  updated_at_ms: number;
}

export function skillList(): Promise<SkillSummary[]> {
  return invoke<SkillSummary[]>('skill_list');
}

export function skillGet(path: string): Promise<SkillContent> {
  return invoke<SkillContent>('skill_get', { path });
}

export function skillSave(
  path: string,
  body: string,
  createNew: boolean,
): Promise<SkillContent> {
  return invoke<SkillContent>('skill_save', { path, body, createNew });
}

export function skillDelete(path: string): Promise<void> {
  return invoke<void>('skill_delete', { path });
}

// ───────────────────────── Memory (T7.3) ─────────────────────────

/** Which of the two Markdown files under `~/.hermes/` is being edited.
 *  Server-side this is an enum; on the wire it's the literal string
 *  `'agent'` (→ `MEMORY.md`) or `'user'` (→ `USER.md`). */
export type MemoryKind = 'agent' | 'user';

export interface MemoryFile {
  kind: MemoryKind;
  /** Absolute path — useful for "Reveal in Finder" + for the capacity
   *  meter tooltip so power users can see where their notes actually
   *  live. */
  path: string;
  content: string;
  /** On-disk byte length (metadata-derived, not `content.length`). */
  bytes: number;
  /** Backend-enforced upper bound. Saves over this reject before the
   *  file is ever touched. UI surfaces this in the capacity meter. */
  max_bytes: number;
  /** `false` on the very first read — lets the UI offer a starter
   *  template instead of a blank page. */
  exists: boolean;
}

/** Read the agent or user memory file. Missing files return an empty
 *  body (NOT an error) — the UI treats "no file yet" as "no notes
 *  yet". Backend caches nothing; each call hits disk. */
export function memoryRead(kind: MemoryKind): Promise<MemoryFile> {
  return invoke<MemoryFile>('memory_read', { kind });
}

/** Atomically replace the file body. Rejects payloads over
 *  `max_bytes` before touching disk. Returns the post-write state so
 *  the UI can refresh the capacity meter without a second round-trip. */
export function memoryWrite(kind: MemoryKind, content: string): Promise<MemoryFile> {
  return invoke<MemoryFile>('memory_write', { kind, content });
}

// ───────────────────────── MCP servers (T7.1) ─────────────────────────

/** One MCP server entry. `config` is the OPAQUE blob that maps 1:1
 *  to the nested YAML under `mcp_servers.<id>` in
 *  `~/.hermes/config.yaml` — `command/args/env` for stdio, `url/
 *  headers` for http, plus any `tools.{include,exclude,prompts,
 *  resources}` filter. Kept opaque so future upstream fields ride
 *  through without a Corey-side schema bump. */
export interface McpServer {
  id: string;
  config: Record<string, unknown>;
}

export function mcpServerList(): Promise<McpServer[]> {
  return invoke<McpServer[]>('mcp_server_list');
}

/** Upsert one server. The backend rejects empty ids and ids
 *  containing '.' (which would mis-write into nested YAML). */
export function mcpServerUpsert(server: McpServer): Promise<void> {
  return invoke<void>('mcp_server_upsert', { server });
}

export function mcpServerDelete(id: string): Promise<void> {
  return invoke<void>('mcp_server_delete', { id });
}

// ───────────────────────── PTY (T4.5) ─────────────────────────

/**
 * Spawn a pty-wrapped shell. Output bytes arrive on the `pty:data:<id>`
 * event as a base64-encoded string — the caller handles decoding (and
 * feeding xterm.js). `id` is a caller-generated uuid so the frontend
 * can attach listeners BEFORE the shell races to emit its first byte.
 */
export function ptySpawn(id: string, rows: number, cols: number): Promise<string> {
  return invoke<string>('pty_spawn', { id, rows, cols });
}

/** Send UTF-8 keystrokes to the pty. */
export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke<void>('pty_write', { id, data });
}

/** Resize the pty. Match what xterm.js's fit addon reports. */
export function ptyResize(id: string, rows: number, cols: number): Promise<void> {
  return invoke<void>('pty_resize', { id, rows, cols });
}

/** Kill the pty's child process and drop it from the backend registry. */
export function ptyKill(id: string): Promise<void> {
  return invoke<void>('pty_kill', { id });
}

// ───────────────────────── Hermes channels ─────────────────────────

/** Field shape drives how a form cell is rendered. Mirrors the Rust
 *  `FieldKind` enum; any other value from the backend will fall through
 *  to a plain text input in the UI. */
export type ChannelFieldKind = 'bool' | 'string' | 'string_list';

export interface ChannelYamlFieldSpec {
  /** Relative dotted path under the channel's yaml_root. */
  path: string;
  kind: ChannelFieldKind;
  label_key: string;
  default_bool?: boolean;
  default_string?: string;
}

export interface ChannelEnvKeySpec {
  name: string;
  required: boolean;
  /** i18n key for a hint rendered under the input. Empty string when
   *  serialized → normalized to `undefined` on the wire. */
  hint_key?: string;
}

export interface ChannelState {
  id: string;
  display_name: string;
  yaml_root: string;
  env_keys: ChannelEnvKeySpec[];
  yaml_fields: ChannelYamlFieldSpec[];
  hot_reloadable: boolean;
  has_qr_login: boolean;
  /** Map from env key name → whether currently set in `.env`. */
  env_present: Record<string, boolean>;
  /** Current YAML values keyed by `yaml_fields[*].path`. `null` when
   *  the field isn't set. */
  yaml_values: Record<string, unknown>;
}

/** Read-only join of the static channel catalog with current disk
 *  state. See `src-tauri/src/channels.rs` for the catalog. */
export function hermesChannelList(): Promise<ChannelState[]> {
  return invoke<ChannelState[]>('hermes_channel_list');
}

/** Patch payload for `hermesChannelSave`. Fields left out of both maps
 *  are untouched on disk. The backend enforces that every key in
 *  `env_updates` / `yaml_updates` is declared by the channel spec. */
export interface ChannelSaveArgs {
  id: string;
  /** Env-key name → new value. `null` or `""` DELETES the key. */
  env_updates?: Record<string, string | null>;
  /** YAML field path (relative to yaml_root) → new value. JSON `null`
   *  deletes the field; booleans / strings / arrays round-trip as-is. */
  yaml_updates?: Record<string, unknown>;
}

/**
 * Atomic write of a channel's credentials + behavior fields.
 *
 * Writes happen in two phases, each atomic:
 *   1) `.env` upserts — one journal entry per env key.
 *   2) `config.yaml` patch — single journal entry for the whole patch.
 *
 * Returns the refreshed `ChannelState` for the saved channel so the
 * UI can update its card without refetching the full list. If the
 * channel is not hot-reloadable (`hot_reloadable = false`) the UI
 * should prompt the user to call `hermesGatewayRestart`.
 */
export function hermesChannelSave(args: ChannelSaveArgs): Promise<ChannelState> {
  return invoke<ChannelState>('hermes_channel_save', { args });
}

// ──────────────────────── Channel live status (T3.4) ─────────────────────────

/** Three-way liveness verdict for a single channel. `unknown` when the
 *  logs have no recent line matching the channel's slug — distinct
 *  from `offline` so unconfigured channels don't falsely read as down. */
export type ChannelLiveState = 'online' | 'offline' | 'unknown';

export interface ChannelLiveStatus {
  id: string;
  state: ChannelLiveState;
  /** Raw log line that drove the verdict, or null for `unknown`.
   *  The UI surfaces the first ~120 chars as a tooltip. */
  last_marker: string | null;
  /** Unix millis at which the snapshot was computed. Shared across
   *  every row in a single response — they're classified from the
   *  same log tail. */
  probed_at_ms: number;
}

/** 30s-cached probe; `force=true` bypasses the cache. Reads
 *  `~/.hermes/logs/{gateway,agent}.log` and regex-classifies the
 *  most-recent marker per channel. */
export function hermesChannelStatusList(force = false): Promise<ChannelLiveStatus[]> {
  return invoke<ChannelLiveStatus[]>('hermes_channel_status_list', { force });
}

// ───────────────────────── Hermes profiles ─────────────────────────

export interface HermesProfileInfo {
  name: string;
  path: string;
  is_active: boolean;
  updated_at: number;
}

export interface HermesProfilesView {
  /** Absolute path the backend scanned, e.g. `/Users/x/.hermes/profiles`. */
  root: string;
  /** `true` if that directory doesn't exist yet — Hermes not installed or
   *  a brand-new install. */
  missing_root: boolean;
  profiles: HermesProfileInfo[];
  /** Name of the active profile per `~/.hermes/active_profile`. `null`
   *  when the pointer file is missing or empty. */
  active: string | null;
}

/** Scan `~/.hermes/profiles/`. Pure read; never mutates state. */
export function hermesProfileList(): Promise<HermesProfilesView> {
  return invoke<HermesProfilesView>('hermes_profile_list');
}

/** Create a new profile directory with a minimal seed `config.yaml`. */
export function hermesProfileCreate(name: string): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_create', { name });
}

/** Rename in place. Fails on collision or if `from` doesn't exist. */
export function hermesProfileRename(args: { from: string; to: string }): Promise<void> {
  return invoke<void>('hermes_profile_rename', args);
}

/** Remove the directory tree. Refuses the active profile. */
export function hermesProfileDelete(name: string): Promise<void> {
  return invoke<void>('hermes_profile_delete', { name });
}

/** Recursive copy. The clone starts inactive; switching is via
 *  `hermesProfileActivate` below. */
export function hermesProfileClone(args: {
  src: string;
  dst: string;
}): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_clone', args);
}

/** Switch the active-profile pointer (`~/.hermes/active_profile`) to
 *  `name`. Atomic on disk; journaled alongside the rest of the profile
 *  ops. Does **not** bounce the gateway — callers chain
 *  `hermesGatewayRestart()` when the user opts in. */
export function hermesProfileActivate(name: string): Promise<HermesProfileInfo> {
  return invoke<HermesProfileInfo>('hermes_profile_activate', { name });
}

// ─────────────────── tar.gz import / export ───────────────────

/** Manifest written at the root of a Caduceus profile archive. */
export interface ProfileManifest {
  version: number;
  name: string;
  /** Unix-ms timestamp of the export. */
  created_at: number;
  /** Caduceus version that produced the archive (empty string for
   *  older archives that didn't carry this field). */
  exporter_version: string;
}

export interface ProfileExportResponse {
  name: string;
  /** Base64-encoded `.tar.gz` body. Decode with `atob` before wrapping
   *  in a `Blob` for download. */
  bytes_base64: string;
  raw_size: number;
}

export interface ProfileImportPreview {
  manifest: ProfileManifest;
  file_count: number;
  total_bytes: number;
}

export interface ProfileImportResult {
  profile: HermesProfileInfo;
  /** `true` if a pre-existing profile of the same name was replaced. */
  overwrote: boolean;
  file_count: number;
}

/** Pack `~/.hermes/profiles/<name>/` into a tar.gz in memory. The
 *  frontend unwraps `bytes_base64` into a `Blob` and triggers a
 *  standard `<a download>` — no Tauri file-dialog plugin needed. */
export function hermesProfileExport(name: string): Promise<ProfileExportResponse> {
  return invoke<ProfileExportResponse>('hermes_profile_export', { args: { name } });
}

/** Parse an archive's manifest + tally its file count without touching
 *  disk. Used to render a confirm dialog before committing to
 *  `hermesProfileImport`. */
export function hermesProfileImportPreview(
  bytesBase64: string,
): Promise<ProfileImportPreview> {
  return invoke<ProfileImportPreview>('hermes_profile_import_preview', {
    args: { bytes_base64: bytesBase64 },
  });
}

/** Extract an archive under `~/.hermes/profiles/<target>/`. Fails with
 *  `AlreadyExists` unless `overwrite` is explicitly `true`. `target_name`
 *  defaults to the archive's manifest name. */
export function hermesProfileImport(args: {
  bytesBase64: string;
  targetName?: string | null;
  overwrite?: boolean;
}): Promise<ProfileImportResult> {
  return invoke<ProfileImportResult>('hermes_profile_import', {
    args: {
      bytes_base64: args.bytesBase64,
      target_name: args.targetName ?? null,
      overwrite: args.overwrite ?? false,
    },
  });
}

// ───────────────────────── Hermes logs ─────────────────────────

export type HermesLogKind = 'agent' | 'gateway' | 'error';

export interface HermesLogTail {
  /** Absolute path on disk the backend tried to read. */
  path: string;
  /** `true` if the file didn't exist — `lines` will be empty. */
  missing: boolean;
  /** Last N lines in chronological order (oldest first). */
  lines: string[];
  /** Total line count in the file before truncation. Lets the UI show
   *  "Showing last 500 of 12,340 lines". */
  total_lines: number;
}

/** Tail one of Hermes's rolling log files. `maxLines` is clamped server-
 *  side to [1, 5000] and defaults to 500. */
export function hermesLogTail(args: {
  kind: HermesLogKind;
  maxLines?: number;
}): Promise<HermesLogTail> {
  return invoke<HermesLogTail>('hermes_log_tail', {
    kind: args.kind,
    maxLines: args.maxLines ?? null,
  });
}

// ───────────────────────── App paths ─────────────────────────

export interface AppPaths {
  config_dir: string;
  data_dir: string;
  db_path: string;
  changelog_path: string;
}

/** Platform-native paths the app uses on disk. Read-only view for the
 *  Settings → Storage section. No I/O — AppState caches these at boot. */
export function appPaths(): Promise<AppPaths> {
  return invoke<AppPaths>('app_paths');
}

// ───────────────────────── Hermes's own config.yaml ─────────────────────────

export interface HermesModelSection {
  default?: string | null;
  provider?: string | null;
  base_url?: string | null;
}

export interface HermesConfigView {
  /** Absolute path on disk, for display + error messages. */
  config_path: string;
  /** `true` if the file existed and parsed. */
  present: boolean;
  model: HermesModelSection;
  /** Names of `*_API_KEY` env vars with non-empty values in ~/.hermes/.env. */
  env_keys_present: string[];
}

/** Current `model` section from `~/.hermes/config.yaml`. */
export function hermesConfigRead(): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_config_read');
}

/**
 * Persist a new `model` section to `~/.hermes/config.yaml`. Other fields are
 * preserved. Returns the re-read view for UI reconciliation.
 *
 * NOTE: The Hermes gateway does NOT hot-reload this file. Changes take effect
 * only after `hermes gateway restart`. The UI should surface this.
 */
export function hermesConfigWriteModel(
  model: HermesModelSection,
): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_config_write_model', { model });
}

/**
 * Upsert or delete a `*_API_KEY` entry in `~/.hermes/.env`. Pass `null` or
 * an empty string to remove. Only `*_API_KEY` suffixes are permitted
 * server-side. Returns the refreshed config view.
 */
export function hermesEnvSetKey(
  key: string,
  value: string | null,
): Promise<HermesConfigView> {
  return invoke<HermesConfigView>('hermes_env_set_key', { key, value });
}

/**
 * Run `hermes gateway restart`. Resolves with the process's combined stdout
 * (or stderr on empty stdout). Rejects with the process's error output on
 * non-zero exit. The call is long — typically a few seconds while the
 * gateway shuts down and re-binds port 8642.
 */
export function hermesGatewayRestart(): Promise<string> {
  return invoke<string>('hermes_gateway_restart');
}

// ───────────────────────── Provider probe ─────────────────────────

export interface DiscoveredModel {
  id: string;
  owned_by?: string | null;
  /** Unix seconds when the provider first published the model, if any. */
  created?: number | null;
}

export interface ProbeReport {
  /** The URL we actually queried (post-normalization of the user's base_url). */
  endpoint: string;
  latency_ms: number;
  models: DiscoveredModel[];
}

/**
 * `GET {base_url}/v1/models` against an OpenAI-compatible provider.
 * Bypasses the local Hermes gateway — talks straight to the upstream.
 *
 * Auth source is exactly one of:
 * - `envKey`: name of a `*_API_KEY` entry in `~/.hermes/.env`. Server reads
 *   the value; raw secret never crosses IPC. **Preferred.**
 * - `apiKey`: literal key. Crosses IPC but is never persisted.
 * - neither: anonymous probe (self-hosted endpoints).
 */
export function modelProviderProbe(args: {
  baseUrl: string;
  envKey?: string | null;
  apiKey?: string | null;
}): Promise<ProbeReport> {
  return invoke<ProbeReport>('model_provider_probe', {
    baseUrl: args.baseUrl,
    envKey: args.envKey ?? null,
    apiKey: args.apiKey ?? null,
  });
}

// ───────────────────────── Changelog journal ─────────────────────────

export interface ChangelogEntry {
  /** `<rfc3339>-<session-seq>`. Stable primary key. */
  id: string;
  /** RFC-3339 timestamp (UTC). */
  ts: string;
  /** Dotted op namespace, e.g. `hermes.config.model`. */
  op: string;
  before?: unknown;
  after?: unknown;
  /** Human-readable summary for display. */
  summary: string;
}

/** Newest-first list, capped server-side at 500. Defaults to 100. */
export function changelogList(limit?: number): Promise<ChangelogEntry[]> {
  return invoke<ChangelogEntry[]>('changelog_list', { limit });
}

export interface RevertReport {
  /** The fresh entry describing the revert itself (also appears in next list). */
  revert_entry: ChangelogEntry;
}

/**
 * Revert one journal entry by id. Dispatches server-side by the entry's `op`.
 *
 * Revertible ops (current):
 * - `hermes.config.model` — restores provider/model/base_url.
 *
 * Irreversible ops (server returns `unsupported`):
 * - `hermes.env.key` — we never persisted the secret, so we can't put it back.
 *
 * The revert itself is journaled as a new entry, so the history stays
 * append-only and reverts can be re-reverted.
 */
export function changelogRevert(entryId: string): Promise<RevertReport> {
  return invoke<RevertReport>('changelog_revert', { entryId });
}

// ───────────────────────── Settings / config ─────────────────────────

export interface GatewayConfigDto {
  base_url: string;
  api_key?: string | null;
  default_model?: string | null;
}

export interface HealthProbe {
  latency_ms: number;
  body: string;
}

// ───────────────────────── Agent registry (T5.5a) ─────────────────────────

/** Per-adapter health snapshot. Mirrors Rust `adapters::Health`. */
export interface AdapterHealth {
  ok: boolean;
  adapter_id: string;
  version: string | null;
  gateway_url: string | null;
  latency_ms: number | null;
  message: string | null;
  /** T5.1 — most recent probe/invocation failure; `null` when clean. */
  last_error?: string | null;
  /** T5.1 — ms since adapter instance was constructed. */
  uptime_ms?: number | null;
}

/** Capability flags for an adapter. Mirrors Rust `adapters::Capabilities`.
 *  `channels` is a list of messenger-channel slugs (empty when the adapter
 *  doesn't integrate with any external messengers). */
export interface AdapterCapabilities {
  streaming: boolean;
  tool_calls: boolean;
  attachments: boolean;
  multiple_sessions: boolean;
  session_search: boolean;
  skills: boolean;
  memory: boolean;
  scheduler: boolean;
  channels: string[];
  logs: boolean;
  terminal: boolean;
  vector_search: boolean;
  trajectory_export: boolean;
  cost_accounting: boolean;
}

/** One row in the agent switcher. Mirrors Rust `ipc::agents::AdapterListEntry`. */
export interface AdapterListEntry {
  id: string;
  name: string;
  is_default: boolean;
  /** T5.5b — live capability snapshot; drives Sidebar nav filtering. */
  capabilities: AdapterCapabilities;
  /** `null` when the probe itself failed; see `health_error`. */
  health: AdapterHealth | null;
  /** Only populated when `health` is `null`. */
  health_error?: string | null;
}

/** List every registered adapter + its live health snapshot in one round trip. */
export function adapterList(): Promise<AdapterListEntry[]> {
  return invoke<AdapterListEntry[]>('adapter_list');
}

/** Current in-memory gateway config (synced with `~/.../gateway.json`). */
export function configGet(): Promise<GatewayConfigDto> {
  return invoke<GatewayConfigDto>('config_get');
}

/** Persist + hot-swap the adapter. Rejects with `IpcError` on invalid URL. */
export function configSet(config: GatewayConfigDto): Promise<void> {
  return invoke<void>('config_set', { config });
}

/**
 * Dry-run a config by hitting `/health`. Does NOT save. Used by the Settings
 * page's "Test" button to give feedback before the user commits.
 */
export function configTest(config: GatewayConfigDto): Promise<HealthProbe> {
  return invoke<HealthProbe>('config_test', { config });
}

// ─────────────── T6.2 · Named Hermes instances ───────────────

/** One user-declared extra Hermes gateway, persisted in
 *  `<app_config_dir>/hermes_instances.json`. Mirrors the Rust
 *  `HermesInstance` DTO 1:1. Registered at boot under
 *  `adapter_id = "hermes:<id>"` alongside the built-in `hermes`
 *  adapter so the AgentSwitcher can route chats to it. */
export interface HermesInstance {
  /** 1..32 chars of `[a-z0-9_-]`. Case-sensitive. Used as the stable
   *  key across renames and embedded in the registered adapter id. */
  id: string;
  /** UI-facing label. Falls back to `id` when empty on the wire. */
  label: string;
  base_url: string;
  api_key?: string | null;
  default_model?: string | null;
  /** T6.5 — id of the sandbox scope this instance's IPC-originated
   *  filesystem ops gate through. `null` or `"default"` resolves to
   *  the always-present default scope. */
  sandbox_scope_id?: string | null;
}

export interface HermesInstancesFile {
  instances: HermesInstance[];
}

export interface HermesInstanceProbeResult {
  id: string;
  ok: boolean;
  latency_ms: number;
  body: string;
}

/** List extra Hermes instances. Empty array = no file yet (first-run). */
export function hermesInstanceList(): Promise<HermesInstancesFile> {
  return invoke<HermesInstancesFile>('hermes_instance_list');
}

/** Create-or-update by `id`. Validates id + base_url + probes the URL.
 *  Hot-registers the adapter under `hermes:<id>` on success. */
export function hermesInstanceUpsert(instance: HermesInstance): Promise<HermesInstance> {
  return invoke<HermesInstance>('hermes_instance_upsert', { instance });
}

/** Idempotent delete. Unregisters the adapter and persists. */
export function hermesInstanceDelete(id: string): Promise<void> {
  return invoke<void>('hermes_instance_delete', { id });
}

/** Dry-run `/health` against a proposed instance config without
 *  persisting. The result always resolves (never rejects) so the UI
 *  can show red/green alongside an error string. */
export function hermesInstanceTest(
  instance: HermesInstance,
): Promise<HermesInstanceProbeResult> {
  return invoke<HermesInstanceProbeResult>('hermes_instance_test', { instance });
}

// ─────────────── T6.4 · Routing rules ───────────────

/** Predicate evaluated against the composed message text. One of
 *  `'prefix' | 'contains' | 'regex'`. The case-toggle applies to
 *  both `value` and the input text. */
export type RoutingMatch =
  | { kind: 'prefix'; value: string; case_sensitive?: boolean }
  | { kind: 'contains'; value: string; case_sensitive?: boolean }
  | { kind: 'regex'; value: string; case_sensitive?: boolean };

/** One user-declared routing rule. Stored in
 *  `<app_config_dir>/routing_rules.json`. First enabled match in file
 *  order wins; `target_adapter_id` is looked up in the AdapterRegistry
 *  at send time. */
export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  match: RoutingMatch;
  target_adapter_id: string;
}

export interface RoutingRulesFile {
  rules: RoutingRule[];
}

export function routingRuleList(): Promise<RoutingRulesFile> {
  return invoke<RoutingRulesFile>('routing_rule_list');
}

export function routingRuleUpsert(rule: RoutingRule): Promise<RoutingRule> {
  return invoke<RoutingRule>('routing_rule_upsert', { rule });
}

export function routingRuleDelete(id: string): Promise<void> {
  return invoke<void>('routing_rule_delete', { id });
}

// ───────────────────────── Menu ─────────────────────────

/** Tell Rust which locale to rebuild the native menubar in. Called from
 *  `useMenuEvents` on boot + whenever the user switches languages in
 *  Settings. Non-Tauri contexts (Storybook / Playwright without the
 *  mock) safely noop. */
export function menuSetLocale(lang: string): Promise<void> {
  return invoke<void>('menu_set_locale', { lang });
}

// ───────────────────────── Scheduler ─────────────────────────

export interface SchedulerJob {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  adapter_id: string;
  enabled: boolean;
  last_run_at: number | null;
  last_run_ok: boolean | null;
  last_run_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface SchedulerJobUpsert {
  id?: string;
  name: string;
  cron_expression: string;
  prompt: string;
  adapter_id?: string;
  enabled?: boolean;
}

export interface SchedulerValidateResult {
  ok: boolean;
  error?: string;
  next_fire_at?: number;
  /** T6.8: `true` when the expression parsed as classic cron;
   *  `false` means Hermes-extended syntax (`"every 2h"`, `"30m"`,
   *  ISO timestamp) and `next_fire_at` will be absent — Hermes
   *  evaluates those at runtime. */
  is_cron?: boolean;
}

/** T6.8: one run output surfaced by `scheduler_list_runs`. Mirrors the
 *  Rust `RunInfo` in `src-tauri/src/hermes_cron.rs`. Runs live under
 *  `~/.hermes/cron/output/{job_id}/` — Hermes writes them; we only
 *  read. `preview` is the first ~400 chars of the markdown body. */
export interface SchedulerRunInfo {
  job_id: string;
  name: string;
  modified_at: number;
  size_bytes: number;
  preview: string;
}

export function schedulerListJobs(): Promise<SchedulerJob[]> {
  return invoke<SchedulerJob[]>('scheduler_list_jobs');
}

export function schedulerUpsertJob(args: SchedulerJobUpsert): Promise<SchedulerJob> {
  return invoke<SchedulerJob>('scheduler_upsert_job', { args });
}

export function schedulerDeleteJob(id: string): Promise<void> {
  return invoke<void>('scheduler_delete_job', { id });
}

export function schedulerValidateCron(expression: string): Promise<SchedulerValidateResult> {
  return invoke<SchedulerValidateResult>('scheduler_validate_cron', { expression });
}

/** T6.8: fetch the most-recent run outputs for a job. Returns up to
 *  `MAX_RUNS_PER_JOB` (Rust-side constant, currently 20) entries
 *  newest-first. Cheap read; the UI calls it lazily when the Runs
 *  drawer opens on a given card. */
export function schedulerListRuns(jobId: string): Promise<SchedulerRunInfo[]> {
  return invoke<SchedulerRunInfo[]>('scheduler_list_runs', { jobId });
}

// ───────────────────────── Sandbox ─────────────────────────

export type SandboxAccessMode = 'read' | 'read_write';
export type SandboxMode = 'dev_allow' | 'enforced';

export interface SandboxRoot {
  path: string;
  label: string;
  mode: SandboxAccessMode;
}

export interface SandboxStateDto {
  mode: SandboxMode;
  roots: SandboxRoot[];
  session_grants: string[];
  config_path: string;
}

export function sandboxGetState(): Promise<SandboxStateDto> {
  return invoke<SandboxStateDto>('sandbox_get_state');
}

export function sandboxAddRoot(args: {
  path: string;
  label: string;
  mode: SandboxAccessMode;
}): Promise<SandboxRoot> {
  return invoke<SandboxRoot>('sandbox_add_root', { args });
}

export function sandboxRemoveRoot(path: string): Promise<void> {
  return invoke<void>('sandbox_remove_root', { args: { path } });
}

export function sandboxGrantOnce(path: string): Promise<{ canonical: string }> {
  return invoke<{ canonical: string }>('sandbox_grant_once', { args: { path } });
}

export function sandboxSetEnforced(): Promise<void> {
  return invoke<void>('sandbox_set_enforced');
}

export function sandboxClearSessionGrants(): Promise<void> {
  return invoke<void>('sandbox_clear_session_grants');
}

// ───────────────────────── T6.5 — sandbox scopes ─────────────────────────

/** A named root collection. The scope with id `"default"` is always
 *  present and is what every legacy caller (AppState's single
 *  `sandbox_*` IPCs, IPC-originated file ops without an adapter_id
 *  context) resolves to. Per-agent scoping opts in by pointing a
 *  `HermesInstance.sandbox_scope_id` at a non-default id. */
export interface SandboxScope {
  id: string;
  label: string;
  roots: SandboxRoot[];
}

export function sandboxScopeList(): Promise<SandboxScope[]> {
  return invoke<SandboxScope[]>('sandbox_scope_list');
}

/** Create-or-replace by id. The `default` scope is upsertable but
 *  never removable. Backend enforces the id slug regex
 *  (`[a-z0-9_-]{1,32}`); errors surface as plain internal errors. */
export function sandboxScopeUpsert(args: {
  id: string;
  label: string;
  roots: Array<{ path: string; label: string; mode: SandboxAccessMode }>;
}): Promise<SandboxScope> {
  return invoke<SandboxScope>('sandbox_scope_upsert', { args });
}

/** Idempotent delete. Backend refuses to delete the `default` scope. */
export function sandboxScopeDelete(id: string): Promise<void> {
  return invoke<void>('sandbox_scope_delete', { args: { id } });
}

/** Narrow an unknown rejection into a SandboxConsentRequired payload. */
export function asSandboxConsentRequired(e: unknown): { path: string } | null {
  if (e && typeof e === 'object' && 'kind' in e) {
    const err = e as IpcError;
    if (err.kind === 'sandbox_consent_required' && typeof err.path === 'string') {
      return { path: err.path };
    }
  }
  return null;
}

// ───────────────────────── Error envelope ─────────────────────────

export type IpcErrorKind =
  | 'not_configured'
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream'
  | 'protocol'
  | 'unsupported'
  | 'internal'
  | 'sandbox_denied'
  | 'sandbox_consent_required';

export interface IpcError {
  kind: IpcErrorKind;
  [k: string]: unknown;
}

/** Coerce whatever invoke() rejected with into a human message. */
export function ipcErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'kind' in e) {
    const err = e as IpcError;
    switch (err.kind) {
      case 'unreachable':
        return `Gateway unreachable at ${err.endpoint}: ${err.message}`;
      case 'unauthorized':
        return `Unauthorized: ${err.detail}`;
      case 'rate_limited':
        return `Rate limited${err.retry_after_s ? `, retry in ${err.retry_after_s}s` : ''}`;
      case 'upstream':
        return `Upstream error ${err.status}: ${String(err.body).slice(0, 200)}`;
      case 'protocol':
        return `Protocol error: ${err.detail}`;
      case 'unsupported':
        return `Unsupported capability: ${err.capability}`;
      case 'not_configured':
        return `Not configured: ${err.hint}`;
      case 'internal':
        return `Internal error: ${err.message}`;
      case 'sandbox_denied':
        return `Sandbox denied ${err.path} (${err.reason})`;
      case 'sandbox_consent_required':
        return `Sandbox requires consent for ${err.path}`;
      default:
        return JSON.stringify(err);
    }
  }
  return typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
}
