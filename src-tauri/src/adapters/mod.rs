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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub adapter_id: String,
    pub version: Option<String>,
    pub gateway_url: Option<String>,
    pub latency_ms: Option<u32>,
    pub message: Option<String>,
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
}

// ───────────────────────── Registry ─────────────────────────

pub struct AdapterRegistry {
    adapters: HashMap<&'static str, Arc<dyn AgentAdapter>>,
    default: RwLock<Option<String>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: HashMap::new(),
            default: RwLock::new(None),
        }
    }

    pub fn register(&mut self, adapter: Arc<dyn AgentAdapter>) {
        let id = adapter.id();
        self.adapters.insert(id, adapter);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentAdapter>> {
        self.adapters.get(id).cloned()
    }

    pub fn set_default(&self, id: &str) -> AdapterResult<()> {
        if !self.adapters.contains_key(id) {
            return Err(AdapterError::NotConfigured {
                hint: format!("adapter '{id}' is not registered"),
            });
        }
        *self.default.write().expect("registry poisoned") = Some(id.to_string());
        Ok(())
    }

    pub fn default_adapter(&self) -> Option<Arc<dyn AgentAdapter>> {
        let default_id = self.default.read().expect("registry poisoned").clone()?;
        self.adapters.get(default_id.as_str()).cloned()
    }

    pub fn all(&self) -> Vec<AdapterInfo> {
        let default_id = self.default.read().expect("registry poisoned").clone();
        self.adapters
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
