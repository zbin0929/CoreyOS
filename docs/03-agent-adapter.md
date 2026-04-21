# 03 · Agent Adapter

The single abstraction that lets Caduceus drive multiple agents. Defined in Rust, mirrored in TypeScript via `specta`. Implemented in Phase 0 (trait + Hermes stub), real data in Phase 1, second implementation in Phase 5.

## Core trait (Rust)

```rust
// src-tauri/src/adapters/mod.rs

#[async_trait::async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    /// Stable identifier, e.g. "hermes", "claude-code".
    fn id(&self) -> &'static str;

    /// Display name for UI.
    fn name(&self) -> &'static str;

    /// Declared capabilities. The UI hides features the adapter does not support.
    fn capabilities(&self) -> Capabilities;

    /// Health check. Returns detailed status including version, gateway reachability.
    async fn health(&self) -> Result<Health, AdapterError>;

    // ── Sessions ────────────────────────────────────────────
    async fn list_sessions(&self, query: SessionQuery) -> Result<Vec<Session>, AdapterError>;
    async fn get_session(&self, id: &SessionId) -> Result<Session, AdapterError>;
    async fn create_session(&self, req: CreateSession) -> Result<Session, AdapterError>;
    async fn delete_session(&self, id: &SessionId) -> Result<(), AdapterError>;
    async fn rename_session(&self, id: &SessionId, title: &str) -> Result<(), AdapterError>;

    // ── Chat ────────────────────────────────────────────────
    /// Send a message and stream deltas. Returns a handle for cancellation.
    async fn send_message(
        &self,
        req: SendMessage,
        sink: DeltaSink,
    ) -> Result<StreamHandle, AdapterError>;

    async fn cancel(&self, handle: StreamHandle) -> Result<(), AdapterError>;

    // ── Models ──────────────────────────────────────────────
    async fn list_models(&self) -> Result<Vec<ModelInfo>, AdapterError>;
    async fn set_default_model(&self, model_id: &str) -> Result<(), AdapterError>;

    // ── Skills (optional via capabilities.skills) ───────────
    async fn list_skills(&self) -> Result<Vec<Skill>, AdapterError> { unsupported() }
    async fn get_skill(&self, id: &str) -> Result<Skill, AdapterError> { unsupported() }
    async fn write_skill(&self, skill: Skill) -> Result<(), AdapterError> { unsupported() }

    // ── Logs ────────────────────────────────────────────────
    async fn tail_logs(&self, query: LogQuery, sink: LogSink) -> Result<StreamHandle, AdapterError> { unsupported() }

    // ── Settings passthrough ────────────────────────────────
    async fn get_setting(&self, key: &str) -> Result<serde_json::Value, AdapterError> { unsupported() }
    async fn set_setting(&self, key: &str, value: serde_json::Value) -> Result<(), AdapterError> { unsupported() }
}
```

## Capability matrix

```rust
pub struct Capabilities {
    pub streaming: bool,           // SSE or WS deltas
    pub tool_calls: bool,          // Expose tool_call tree
    pub attachments: bool,         // File upload
    pub multiple_sessions: bool,
    pub session_search: bool,      // Server-side FTS
    pub skills: bool,
    pub memory: bool,
    pub scheduler: bool,           // Cron jobs managed by agent
    pub channels: Vec<ChannelKind>,// Telegram, Discord, …
    pub logs: bool,
    pub terminal: bool,            // Remote terminal into agent env
    pub vector_search: bool,
    pub trajectory_export: bool,
    pub cost_accounting: bool,
}
```

UI reads this once at adapter registration and hides unsupported panels/menu items. No runtime `if (adapter === 'hermes')` branches in the frontend.

## Core types

```rust
pub type SessionId = String;
pub type StreamHandle = u64;

pub struct Session {
    pub id: SessionId,
    pub title: String,
    pub source: Source,                 // Cli | Telegram | Discord | …
    pub model_id: Option<String>,
    pub token_usage: TokenUsage,
    pub last_message_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub is_live: bool,
    pub adapter_id: String,             // "hermes"
    pub metadata: serde_json::Value,    // Adapter-specific extras
}

pub struct SendMessage {
    pub session_id: SessionId,
    pub content: Vec<ContentPart>,      // text + attachments
    pub model_id: Option<String>,
    pub tools: Option<Vec<ToolRef>>,    // Allow/deny tools per call
    pub reasoning: Option<bool>,
}

pub enum Delta {
    MessageStart  { message_id: String, role: Role },
    TextChunk     { text: String },
    ToolCallStart { call_id: String, tool: String, args_partial: String },
    ToolCallDelta { call_id: String, args_partial: String },
    ToolCallEnd   { call_id: String, result: serde_json::Value, error: Option<String> },
    Reasoning     { text: String },
    Usage         { input: u32, output: u32, cached: u32, cost_usd: Option<f64> },
    MessageEnd    { finish_reason: FinishReason, message_id: String },
    Error         { message: String, recoverable: bool },
}
```

## Delta stream contract

- Deltas are ordered per-session.
- `MessageStart` and `MessageEnd` always bracket a message.
- Any number of `TextChunk` may appear; they concatenate.
- `ToolCallStart … ToolCallEnd` may interleave with text chunks; UI shows them inline in a collapsible card.
- `Usage` is emitted at least once per message (at end) and may be emitted incrementally.
- After `Error { recoverable: false }`, no more deltas for that call.

## TS bindings

Generated by `tauri-specta` into `src/lib/ipc/bindings.ts`. The frontend never hand-codes these types. Example usage:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { SendMessage, Delta } from '@/lib/ipc/bindings';
import { listen } from '@tauri-apps/api/event';

export async function sendMessage(req: SendMessage, onDelta: (d: Delta) => void) {
  const handle = await invoke<number>('chat_send', { req });
  const unlisten = await listen<Delta>(`chat:delta:${handle}`, (e) => onDelta(e.payload));
  return { handle, unlisten };
}
```

## Registry

```rust
// src-tauri/src/adapters/mod.rs
pub struct AdapterRegistry {
    adapters: HashMap<&'static str, Arc<dyn AgentAdapter>>,
    default: RwLock<String>,
}

impl AdapterRegistry {
    pub fn new() -> Self { … }
    pub fn register(&mut self, adapter: Arc<dyn AgentAdapter>) { … }
    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentAdapter>>;
    pub fn default_adapter(&self) -> Arc<dyn AgentAdapter>;
    pub fn set_default(&self, id: &str) -> Result<(), AdapterError>;
    pub fn all(&self) -> Vec<AdapterInfo>;
}
```

Registered at startup. Users can later enable/disable adapters in Settings; disabled ones are unloaded (drops their connections).

## Errors

```rust
pub enum AdapterError {
    NotConfigured { hint: String },
    Unreachable  { endpoint: String, source: anyhow::Error },
    Unauthorized { detail: String },
    RateLimited  { retry_after_s: Option<u32> },
    Upstream     { status: u16, body: String },
    Protocol     { detail: String },
    Unsupported  { capability: &'static str },
    Internal     { source: anyhow::Error },
}
```

UI maps these to specific recovery actions (e.g. `NotConfigured` → open settings deep link; `Unauthorized` → re-auth flow).

## Testing contract

Every adapter must ship with:

1. A **conformance test suite** (shared fixture) that asserts it correctly implements the trait: session lifecycle, delta ordering, cancellation, capability honesty.
2. A **mock mode** (in-memory, no network) for UI e2e tests.
3. A **recorded fixtures** set (saved SSE streams) used in CI to avoid live network.

Conformance test lives at `src-tauri/src/adapters/conformance.rs` and is parameterized over any `AgentAdapter`.
