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
pub mod probe;
mod text_extract;
use text_extract::build_content;

use async_trait::async_trait;

use crate::adapters::{
    AgentAdapter, Capabilities, ChatTurn, Health, ModelCapabilities, ModelInfo, Session, SessionId,
    SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

use gateway::{ChatMessage, ChatStreamDone, ChatStreamEvent, HermesGateway};
use tokio::sync::mpsc;

// Tests import these via `super::*`. Keeping the bindings in scope here
// (only under cfg(test)) avoids touching the existing test suite.
#[cfg(test)]
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
#[cfg(test)]
use crate::adapters::ChatAttachmentRef;
#[cfg(test)]
use gateway::{ChatContentPart, ChatImageUrl, ChatMessageContent};

const ADAPTER_ID: &str = "hermes";
/// Default model when the caller doesn't override. Matches what the gateway
/// config.yaml typically sets as the active provider model.
const DEFAULT_MODEL: &str = "deepseek-reasoner";

const FIXTURE_SESSIONS: &str = include_str!("fixtures/sessions.json");
const FIXTURE_MODELS: &str = include_str!("fixtures/models.json");

pub struct HermesAdapter {
    mode: Mode,
    /// T5.1 — captured at construction; powers `Health::uptime_ms`.
    started_at: std::time::Instant,
    /// T5.1 — most recent probe/invocation failure, mutated from
    /// `health()` on error paths. `RwLock<Option<String>>` so it
    /// stays cheap to read from many await points and doesn't leak
    /// async contention into the hot chat path.
    last_error: std::sync::RwLock<Option<String>>,
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
        Self {
            mode: Mode::Stub,
            started_at: std::time::Instant::now(),
            last_error: std::sync::RwLock::new(None),
        }
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
            started_at: std::time::Instant::now(),
            last_error: std::sync::RwLock::new(None),
        })
    }

    fn uptime_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    fn read_last_error(&self) -> Option<String> {
        self.last_error.read().ok().and_then(|g| g.clone())
    }

    fn record_error(&self, msg: impl Into<String>) {
        if let Ok(mut g) = self.last_error.write() {
            *g = Some(msg.into());
        }
    }

    fn clear_error(&self) {
        if let Ok(mut g) = self.last_error.write() {
            *g = None;
        }
    }
}

/// Pick an effective model id and convert the generic turn into gateway DTOs.
///
/// T1.5b — when a message carries attachments we switch its `content` from
/// a plain string to OpenAI's multimodal array: one `text` part plus one
/// `image_url` (data-URL) part per image. Non-image attachments degrade
/// to a `[attached: foo.pdf]` marker appended to the text part so the
/// model at least knows a file was present.
///
/// Errors reading a staged file are logged and treated as the non-image
/// case (we don't want a stale/missing attachment to hard-fail an entire
/// chat turn — the user's text still has a shot at being useful).
fn resolve_turn(turn: ChatTurn, default_model: &str) -> (String, Vec<ChatMessage>) {
    let model = turn.model.unwrap_or_else(|| default_model.to_string());
    let vision = turn.model_supports_vision.unwrap_or(true);
    let messages = turn
        .messages
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: build_content(m.content, m.attachments, vision),
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
                "weixin".into(),
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
                last_error: self.read_last_error(),
                uptime_ms: Some(self.uptime_ms()),
            }),
            Mode::Live { gateway, .. } => {
                // T5.1 — successful probe clears the sticky last_error;
                // a failed probe records the message so the next (possibly
                // successful) read still surfaces what went wrong most
                // recently. `?` would lose that opportunity, so split it.
                match gateway.health().await {
                    Ok(probe) => {
                        self.clear_error();
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
                            last_error: None,
                            uptime_ms: Some(self.uptime_ms()),
                        })
                    }
                    Err(e) => {
                        self.record_error(e.to_string());
                        Err(e)
                    }
                }
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
        tx: mpsc::Sender<ChatStreamEvent>,
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

    async fn list_sessions(&self, query: SessionQuery) -> AdapterResult<Vec<Session>> {
        let all: Vec<Session> =
            serde_json::from_str(FIXTURE_SESSIONS).map_err(|e| AdapterError::Internal {
                source: anyhow::anyhow!("failed to parse session fixtures: {e}"),
            })?;
        // T5.1 — honour the new search field. Case-insensitive substring
        // match against `title`. `source` + `limit` were already declared
        // in the trait but silently ignored here; wiring them up is
        // the same shape and tracked in the backlog.
        let filtered: Vec<Session> = match query.search.as_deref().map(str::trim) {
            Some(q) if !q.is_empty() => {
                let needle = q.to_lowercase();
                all.into_iter()
                    .filter(|s| s.title.to_lowercase().contains(&needle))
                    .collect()
            }
            _ => all,
        };
        let capped = match query.limit {
            Some(n) if (n as usize) < filtered.len() => {
                filtered.into_iter().take(n as usize).collect()
            }
            _ => filtered,
        };
        Ok(capped)
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
        match &self.mode {
            Mode::Stub => serde_json::from_str::<Vec<ModelInfo>>(FIXTURE_MODELS).map_err(|e| {
                AdapterError::Internal {
                    source: anyhow::anyhow!("failed to parse model fixtures: {e}"),
                }
            }),
            Mode::Live {
                gateway,
                default_model,
            } => {
                let entries = gateway.list_models().await?;
                Ok(entries
                    .into_iter()
                    .map(|e| ModelInfo {
                        is_default: &e.id == default_model,
                        provider: e.owned_by.unwrap_or_else(|| "unknown".to_string()),
                        display_name: None,
                        context_window: None,
                        capabilities: ModelCapabilities::default(),
                        id: e.id,
                    })
                    .collect())
            }
        }
    }
}

// ───────────────────────── T1.5b unit tests ─────────────────────────

// Tests live in `mod_tests.rs` so the implementation file stays
// under the 800-line guideline (see `scripts/check-file-sizes.mjs`).
// `#[path]` is used (rather than a sibling `tests/` dir) so the
// canonical adapter module file remains `mod.rs`.
#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
