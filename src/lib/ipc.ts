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
}

export interface ChatSendArgs {
  messages: ChatMessageDto[];
  model?: string;
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
}

export interface DbToolCallRow {
  id: string;
  message_id: string;
  tool: string;
  emoji: string | null;
  label: string | null;
  at: number;
}

export interface DbMessageWithTools extends DbMessageRow {
  tool_calls: DbToolCallRow[];
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

/** Append a tool-call annotation. Primary-key conflicts are silently
 *  ignored so duplicate emissions don't blow up. */
export function dbToolCallAppend(call: DbToolCallRow): Promise<void> {
  return invoke<void>('db_tool_call_append', { call });
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
  /** ms since epoch — the clock snapshot that produced this summary. */
  generated_at: number;
}

/** One-shot rollup for the Analytics page. Cheap (<5 ms on ~10k rows). */
export function analyticsSummary(): Promise<AnalyticsSummaryDto> {
  return invoke<AnalyticsSummaryDto>('analytics_summary');
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
