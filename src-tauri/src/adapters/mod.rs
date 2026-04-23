//! AgentAdapter trait and registry.
//!
//! See `docs/03-agent-adapter.md` for the full spec. Phase 0 ships the trait
//! and types only; real implementations land in Phase 1+.

pub mod hermes;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AdapterError, AdapterResult};

// ───────────────────────── Core types ─────────────────────────

pub type SessionId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Cli,
    Telegram,
    Discord,
    Slack,
    WhatsApp,
    Matrix,
    Feishu,
    WeChat,
    WeCom,
    Api,
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub cached: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub title: String,
    pub source: Source,
    pub model_id: Option<String>,
    pub token_usage: TokenUsage,
    pub last_message_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub is_live: bool,
    pub adapter_id: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionQuery {
    pub source: Option<Source>,
    pub limit: Option<u32>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
    pub display_name: Option<String>,
    pub context_window: Option<u32>,
    pub is_default: bool,
    pub capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub vision: bool,
    pub tool_use: bool,
    pub reasoning: bool,
}

/// A single OpenAI-style chat message: role = "system" | "user" | "assistant".
///
/// `attachments` was added in T1.5b to support multimodal providers. When
/// present, the adapter is responsible for:
///   1. reading each `path` (bytes live under `~/.hermes/attachments/`),
///   2. base64-encoding them into `data:<mime>;base64,…` URLs,
///   3. assembling an OpenAI-style `content` array with text + image parts.
///
/// The frontend only ever sends the paths + mimes — it never ships bytes
/// through IPC. Messages without attachments keep the classic string
/// `content` shape, so upstream providers that don't speak multimodal
/// (and our own stub-mode adapters) stay untouched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageDto {
    pub role: String,
    pub content: String,
    /// Empty in the overwhelming majority of turns — most messages are
    /// plain text. Omitted from the JSON payload when empty via
    /// `skip_serializing_if` so the wire format stays minimal.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ChatAttachmentRef>,
}

/// Reference to a staged attachment accompanying a chat message. The three
/// fields mirror the slice of `AttachmentRow` the adapter needs; we keep
/// them decoupled from the DB row so the trait doesn't drag SQLite types
/// into every adapter. `name` is kept around for text fallback when a
/// provider can't consume the file (e.g. a PDF to a non-document model).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachmentRef {
    pub path: String,
    pub mime: String,
    pub name: String,
}

/// Phase 1 Sprint 1 chat request: stateless single-turn completion.
/// The caller supplies the full message history on each invocation.
/// Sessions and streaming live in Sprint 2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTurn {
    pub messages: Vec<ChatMessageDto>,
    #[serde(default)]
    pub model: Option<String>,
    /// T5.1 — optional working directory for code-centric adapters
    /// (Claude Code, Aider, OpenHands). Hermes ignores this because
    /// its tools run server-side with their own filesystem view.
    /// Callers that don't care can leave it `None`; adapters that
    /// don't support it SHOULD silently ignore rather than error.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub adapter_id: String,
    pub version: Option<String>,
    pub gateway_url: Option<String>,
    pub latency_ms: Option<u32>,
    pub message: Option<String>,
    /// T5.1 — human-readable last probe/invocation error. `None` means
    /// "no errors since adapter boot". Adapters SHOULD surface the most
    /// recent transport/parse failure here so the UI can show it even
    /// when a subsequent health check succeeded.
    #[serde(default)]
    pub last_error: Option<String>,
    /// T5.1 — milliseconds since this adapter instance was constructed.
    /// `None` when the adapter doesn't track a start time (e.g. stub).
    /// Mainly for the upcoming Agent Switcher to show "Running for 2h".
    #[serde(default)]
    pub uptime_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Capabilities {
    pub streaming: bool,
    pub tool_calls: bool,
    pub attachments: bool,
    pub multiple_sessions: bool,
    pub session_search: bool,
    pub skills: bool,
    pub memory: bool,
    pub scheduler: bool,
    pub channels: Vec<String>,
    pub logs: bool,
    pub terminal: bool,
    pub vector_search: bool,
    pub trajectory_export: bool,
    pub cost_accounting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

// ───────────────────────── Trait ─────────────────────────

#[async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;

    async fn health(&self) -> AdapterResult<Health>;

    async fn list_sessions(&self, query: SessionQuery) -> AdapterResult<Vec<Session>>;

    async fn get_session(&self, id: &SessionId) -> AdapterResult<Session>;

    async fn list_models(&self) -> AdapterResult<Vec<ModelInfo>>;

    /// Phase 1 Sprint 1: non-streaming single-turn completion. Default
    /// implementation returns `Unsupported` so stub-only adapters can skip it.
    async fn chat_once(&self, _turn: ChatTurn) -> AdapterResult<String> {
        Err(AdapterError::Unsupported {
            capability: "chat_once",
        })
    }

    /// Streaming single-turn completion. Forwards both content deltas and
    /// adapter-specific annotations (e.g. Hermes `tool.progress` events)
    /// through `tx` as they arrive, resolves with a summary (usage, model,
    /// finish reason) when the upstream stream closes.
    async fn chat_stream(
        &self,
        _turn: ChatTurn,
        _tx: tokio::sync::mpsc::Sender<crate::adapters::hermes::gateway::ChatStreamEvent>,
    ) -> AdapterResult<crate::adapters::hermes::gateway::ChatStreamDone> {
        Err(AdapterError::Unsupported {
            capability: "chat_stream",
        })
    }
}

// ───────────────────────── Registry ─────────────────────────

pub struct AdapterRegistry {
    /// RwLock so adapters can be hot-swapped at runtime (e.g. when the
    /// user saves new gateway settings in the UI).
    adapters: RwLock<HashMap<&'static str, Arc<dyn AgentAdapter>>>,
    default: RwLock<Option<String>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: RwLock::new(HashMap::new()),
            default: RwLock::new(None),
        }
    }

    /// Insert-or-replace. Takes `&self` so it can be called on an `Arc`
    /// shared into Tauri state.
    pub fn register(&self, adapter: Arc<dyn AgentAdapter>) {
        let id = adapter.id();
        self.adapters
            .write()
            .expect("registry poisoned")
            .insert(id, adapter);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentAdapter>> {
        self.adapters
            .read()
            .expect("registry poisoned")
            .get(id)
            .cloned()
    }

    pub fn set_default(&self, id: &str) -> AdapterResult<()> {
        if !self
            .adapters
            .read()
            .expect("registry poisoned")
            .contains_key(id)
        {
            return Err(AdapterError::NotConfigured {
                hint: format!("adapter '{id}' is not registered"),
            });
        }
        *self.default.write().expect("registry poisoned") = Some(id.to_string());
        Ok(())
    }

    pub fn default_adapter(&self) -> Option<Arc<dyn AgentAdapter>> {
        let default_id = self.default.read().expect("registry poisoned").clone()?;
        self.adapters
            .read()
            .expect("registry poisoned")
            .get(default_id.as_str())
            .cloned()
    }

    pub fn all(&self) -> Vec<AdapterInfo> {
        let default_id = self.default.read().expect("registry poisoned").clone();
        self.adapters
            .read()
            .expect("registry poisoned")
            .values()
            .map(|a| AdapterInfo {
                id: a.id().to_string(),
                name: a.name().to_string(),
                is_default: default_id.as_deref() == Some(a.id()),
            })
            .collect()
    }
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        Self::new()
    }
}
