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

export interface ChatStreamCallbacks {
  onDelta: (chunk: string) => void;
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
