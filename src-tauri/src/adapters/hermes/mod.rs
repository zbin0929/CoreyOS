//! Hermes adapter — Phase 0 stub.
//!
//! Returns fixture data from `fixtures/*.json`. Real gateway/CLI integration
//! lands in Phase 1 (see `docs/phases/phase-1-chat.md`).

use async_trait::async_trait;

use crate::adapters::{
    AgentAdapter, Capabilities, Health, ModelInfo, Session, SessionId, SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

const ADAPTER_ID: &str = "hermes";

const FIXTURE_SESSIONS: &str = include_str!("fixtures/sessions.json");
const FIXTURE_MODELS: &str = include_str!("fixtures/models.json");

pub struct HermesAdapter {
    stub: bool,
}

impl HermesAdapter {
    pub fn new_stub() -> Self {
        Self { stub: true }
    }
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
        Ok(Health {
            ok: self.stub,
            adapter_id: ADAPTER_ID.into(),
            version: Some("stub-0.0.1".into()),
            gateway_url: Some("http://127.0.0.1:8642".into()),
            latency_ms: Some(0),
            message: if self.stub {
                Some("Phase 0 stub — fixture data only".into())
            } else {
                None
            },
        })
    }

    async fn list_sessions(&self, _query: SessionQuery) -> AdapterResult<Vec<Session>> {
        serde_json::from_str::<Vec<Session>>(FIXTURE_SESSIONS).map_err(|e| {
            AdapterError::Internal {
                source: anyhow::anyhow!("failed to parse session fixtures: {e}"),
            }
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
        serde_json::from_str::<Vec<ModelInfo>>(FIXTURE_MODELS).map_err(|e| {
            AdapterError::Internal {
                source: anyhow::anyhow!("failed to parse model fixtures: {e}"),
            }
        })
    }
}

