//! Hermes adapter.
//!
//! - `new_stub()` returns fixture data (used by tests and offline dev).
//! - `new_live(base_url, api_key)` talks to a real Hermes gateway via
//!   `adapters::hermes::gateway::HermesGateway`.
//!
//! Phase 1 Sprint 1 wires non-streaming chat through `chat_once`.
//! Streaming + session persistence land in Sprint 2 (see
//! `docs/phases/phase-1-chat.md`).

pub mod gateway;

use async_trait::async_trait;

use crate::adapters::{
    AgentAdapter, Capabilities, ChatTurn, Health, ModelInfo, Session, SessionId, SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

use gateway::{ChatMessage, ChatStreamDone, HermesGateway};
use tokio::sync::mpsc;

const ADAPTER_ID: &str = "hermes";
/// Default model when the caller doesn't override. Matches what the gateway
/// config.yaml typically sets as the active provider model.
const DEFAULT_MODEL: &str = "deepseek-reasoner";

const FIXTURE_SESSIONS: &str = include_str!("fixtures/sessions.json");
const FIXTURE_MODELS: &str = include_str!("fixtures/models.json");

pub struct HermesAdapter {
    mode: Mode,
}

enum Mode {
    Stub,
    Live {
        gateway: HermesGateway,
        default_model: String,
    },
}

impl HermesAdapter {
    pub fn new_stub() -> Self {
        Self { mode: Mode::Stub }
    }

    /// Build a live adapter talking to a real Hermes gateway.
    pub fn new_live(
        base_url: impl Into<String>,
        api_key: Option<String>,
        default_model: Option<String>,
    ) -> AdapterResult<Self> {
        Ok(Self {
            mode: Mode::Live {
                gateway: HermesGateway::new(base_url, api_key)?,
                default_model: default_model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            },
        })
    }

    fn is_stub(&self) -> bool {
        matches!(self.mode, Mode::Stub)
    }
}

/// Pick an effective model id and convert the generic turn into gateway DTOs.
fn resolve_turn(turn: ChatTurn, default_model: &str) -> (String, Vec<ChatMessage>) {
    let model = turn.model.unwrap_or_else(|| default_model.to_string());
    let messages = turn
        .messages
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect();
    (model, messages)
}

#[async_trait]
impl AgentAdapter for HermesAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn name(&self) -> &'static str {
        "Hermes Agent"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            streaming: true,
            tool_calls: true,
            attachments: true,
            multiple_sessions: true,
            session_search: true,
            skills: true,
            memory: true,
            scheduler: true,
            channels: vec![
                "telegram".into(),
                "discord".into(),
                "slack".into(),
                "whatsapp".into(),
                "matrix".into(),
                "feishu".into(),
                "wechat".into(),
                "wecom".into(),
            ],
            logs: true,
            terminal: true,
            vector_search: false,
            trajectory_export: true,
            cost_accounting: true,
        }
    }

    async fn health(&self) -> AdapterResult<Health> {
        match &self.mode {
            Mode::Stub => Ok(Health {
                ok: true,
                adapter_id: ADAPTER_ID.into(),
                version: Some("stub-0.0.1".into()),
                gateway_url: None,
                latency_ms: Some(0),
                message: Some("stub — fixture data only".into()),
            }),
            Mode::Live { gateway, .. } => {
                let probe = gateway.health().await?;
                Ok(Health {
                    ok: true,
                    adapter_id: ADAPTER_ID.into(),
                    version: None,
                    gateway_url: Some(gateway.base_url().to_string()),
                    latency_ms: Some(probe.latency_ms),
                    message: if probe.body.is_empty() {
                        None
                    } else {
                        Some(probe.body)
                    },
                })
            }
        }
    }

    async fn chat_once(&self, turn: ChatTurn) -> AdapterResult<String> {
        match &self.mode {
            Mode::Stub => Err(AdapterError::Unsupported {
                capability: "chat_once (adapter in stub mode)",
            }),
            Mode::Live {
                gateway,
                default_model,
            } => {
                let (model, messages) = resolve_turn(turn, default_model);
                let resp = gateway.chat_once(&model, messages).await?;
                Ok(resp.content)
            }
        }
    }

    async fn chat_stream(
        &self,
        turn: ChatTurn,
        tx: mpsc::Sender<String>,
    ) -> AdapterResult<ChatStreamDone> {
        match &self.mode {
            Mode::Stub => Err(AdapterError::Unsupported {
                capability: "chat_stream (adapter in stub mode)",
            }),
            Mode::Live {
                gateway,
                default_model,
            } => {
                let (model, messages) = resolve_turn(turn, default_model);
                gateway.chat_stream(&model, messages, tx).await
            }
        }
    }

    async fn list_sessions(&self, _query: SessionQuery) -> AdapterResult<Vec<Session>> {
        serde_json::from_str::<Vec<Session>>(FIXTURE_SESSIONS).map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("failed to parse session fixtures: {e}"),
        })
    }

    async fn get_session(&self, id: &SessionId) -> AdapterResult<Session> {
        let all = self.list_sessions(SessionQuery::default()).await?;
        all.into_iter()
            .find(|s| &s.id == id)
            .ok_or_else(|| AdapterError::Protocol {
                detail: format!("session '{id}' not found"),
            })
    }

    async fn list_models(&self) -> AdapterResult<Vec<ModelInfo>> {
        serde_json::from_str::<Vec<ModelInfo>>(FIXTURE_MODELS).map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("failed to parse model fixtures: {e}"),
        })
    }
}
