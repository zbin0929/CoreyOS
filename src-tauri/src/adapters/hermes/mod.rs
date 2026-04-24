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

use async_trait::async_trait;

use crate::adapters::{
    AgentAdapter, Capabilities, ChatTurn, Health, ModelCapabilities, ModelInfo, Session, SessionId,
    SessionQuery,
};
use crate::error::{AdapterError, AdapterResult};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use gateway::{
    ChatContentPart, ChatImageUrl, ChatMessage, ChatMessageContent, ChatStreamDone,
    ChatStreamEvent, HermesGateway,
};
use tokio::sync::mpsc;
use tracing::warn;

use crate::adapters::ChatAttachmentRef;

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
    let messages = turn
        .messages
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: build_content(m.content, m.attachments),
        })
        .collect();
    (model, messages)
}

/// Turn a (text, attachments) pair into the right `ChatMessageContent`.
/// Exposed at module level so unit tests can exercise it without spinning
/// up a whole adapter.
fn build_content(text: String, attachments: Vec<ChatAttachmentRef>) -> ChatMessageContent {
    if attachments.is_empty() {
        return ChatMessageContent::Text(text);
    }

    let mut parts: Vec<ChatContentPart> = Vec::with_capacity(attachments.len() + 1);
    let mut text_with_markers = text;

    // Separate into images (become image_url parts) and others (become
    // text markers). The partitioning happens per-item so a failed read
    // falls through to the marker branch even when the mime claims image.
    for a in attachments {
        let is_image = a.mime.starts_with("image/");
        if is_image {
            // sandbox-allow: attachment paths are already validated at
            // stage time (see `attachment_stage_path`) and live under
            // the app's attachments dir. Adapter code runs without an
            // `AppState` handle; a follow-up will thread the authority
            // through the adapter trait and swap to `sandbox::fs::read`.
            match std::fs::read(&a.path) {
                Ok(bytes) => {
                    let data_url = format!("data:{};base64,{}", a.mime, BASE64.encode(&bytes));
                    parts.push(ChatContentPart::ImageUrl {
                        image_url: ChatImageUrl { url: data_url },
                    });
                    continue;
                }
                Err(e) => {
                    warn!(
                        attachment = %a.name,
                        path = %a.path,
                        error = %e,
                        "attachment read failed; degrading to text marker",
                    );
                    // Fall through to marker branch below.
                }
            }
        }
        // Non-image (or failed image read): annotate the text part so the
        // model is at least aware the file existed.
        if !text_with_markers.is_empty() {
            text_with_markers.push_str("\n\n");
        }
        text_with_markers.push_str(&format!("[attached: {}]", a.name));
    }

    // The text part goes first — OpenAI docs recommend this ordering so
    // the model reads instructions before attachments.
    let mut out: Vec<ChatContentPart> = vec![ChatContentPart::Text {
        text: text_with_markers,
    }];
    out.append(&mut parts);
    ChatMessageContent::Parts(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Messages without attachments keep the classic string `content` —
    /// this matters for provider parity because some gateways reject the
    /// array form when there are no image parts.
    #[test]
    fn build_content_no_attachments_stays_text() {
        let c = build_content("hello".to_string(), vec![]);
        match c {
            ChatMessageContent::Text(s) => assert_eq!(s, "hello"),
            _ => panic!("expected Text variant for attachment-free message"),
        }
        // …and serialises as a bare JSON string, not an array.
        let j = serde_json::to_value(ChatMessageContent::Text("x".into())).unwrap();
        assert_eq!(j, serde_json::json!("x"));
    }

    /// An image attachment becomes a `{type:"image_url", image_url:{url:"data:…"}}`
    /// part; the text part comes first so instructions lead.
    #[test]
    fn build_content_image_becomes_data_url_part() {
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("caduceus-t15b-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pixel.png");
        // 1x1 transparent PNG — content isn't parsed, just encoded.
        let bytes: &[u8] = b"\x89PNG\r\n\x1a\n-fake-body";
        std::fs::File::create(&path)
            .unwrap()
            .write_all(bytes)
            .unwrap();

        let c = build_content(
            "describe this".into(),
            vec![ChatAttachmentRef {
                path: path.to_string_lossy().into_owned(),
                mime: "image/png".into(),
                name: "pixel.png".into(),
            }],
        );
        let parts = match c {
            ChatMessageContent::Parts(p) => p,
            _ => panic!("expected Parts variant for message with image"),
        };
        assert_eq!(parts.len(), 2, "text + image_url");
        match &parts[0] {
            ChatContentPart::Text { text } => assert_eq!(text, "describe this"),
            _ => panic!("part 0 must be text"),
        }
        match &parts[1] {
            ChatContentPart::ImageUrl { image_url } => {
                assert!(
                    image_url.url.starts_with("data:image/png;base64,"),
                    "got url: {}",
                    image_url.url
                );
                // base64-decodes back to our bytes.
                let comma = image_url.url.find(',').unwrap();
                let decoded = BASE64.decode(&image_url.url[comma + 1..]).unwrap();
                assert_eq!(decoded, bytes);
            }
            _ => panic!("part 1 must be image_url"),
        }

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    /// Non-image attachments degrade to a `[attached: name]` marker
    /// appended to the text part — no image_url part is emitted.
    #[test]
    fn build_content_non_image_falls_back_to_marker() {
        let c = build_content(
            "here's the spec".into(),
            vec![ChatAttachmentRef {
                // Path doesn't need to exist — non-image branch never reads.
                path: "/nonexistent/doc.pdf".into(),
                mime: "application/pdf".into(),
                name: "doc.pdf".into(),
            }],
        );
        let parts = match c {
            ChatMessageContent::Parts(p) => p,
            _ => panic!("expected Parts variant"),
        };
        assert_eq!(parts.len(), 1, "no image_url part for non-image");
        match &parts[0] {
            ChatContentPart::Text { text } => {
                assert!(text.contains("here's the spec"));
                assert!(text.contains("[attached: doc.pdf]"));
            }
            _ => panic!("part 0 must be text"),
        }
    }

    /// A missing image file logs a warning and degrades the same way as
    /// a non-image — the user's text must still reach the model.
    #[test]
    fn build_content_missing_image_degrades_to_marker() {
        let c = build_content(
            "look".into(),
            vec![ChatAttachmentRef {
                path: "/definitely/not/there/ghost.png".into(),
                mime: "image/png".into(),
                name: "ghost.png".into(),
            }],
        );
        let parts = match c {
            ChatMessageContent::Parts(p) => p,
            _ => panic!("expected Parts"),
        };
        assert_eq!(parts.len(), 1);
        match &parts[0] {
            ChatContentPart::Text { text } => {
                assert!(text.contains("look"));
                assert!(text.contains("[attached: ghost.png]"));
            }
            _ => panic!("expected text part"),
        }
    }

    /// Mixed attachments: one image reads OK, one PDF degrades to a
    /// marker. Order is preserved (text-marker first since PDF comes
    /// first in the input, image_url follows).
    #[test]
    fn build_content_mixed_keeps_text_first_then_images() {
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("caduceus-t15b-mix-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("a.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(b"IMG")
            .unwrap();

        let c = build_content(
            "mixed".into(),
            vec![
                ChatAttachmentRef {
                    path: "/missing/thing.pdf".into(),
                    mime: "application/pdf".into(),
                    name: "thing.pdf".into(),
                },
                ChatAttachmentRef {
                    path: img.to_string_lossy().into_owned(),
                    mime: "image/png".into(),
                    name: "a.png".into(),
                },
            ],
        );
        let parts = match c {
            ChatMessageContent::Parts(p) => p,
            _ => panic!("expected Parts"),
        };
        assert_eq!(parts.len(), 2, "text part + single image_url");
        match &parts[0] {
            ChatContentPart::Text { text } => {
                assert!(text.contains("mixed"));
                assert!(text.contains("[attached: thing.pdf]"));
                assert!(!text.contains("a.png"), "image must not bleed into marker");
            }
            _ => panic!("first part must be text"),
        }
        assert!(matches!(parts[1], ChatContentPart::ImageUrl { .. }));

        let _ = std::fs::remove_file(&img);
        let _ = std::fs::remove_dir(&dir);
    }

    // ───────────────────────── T5.1 tests ─────────────────────────

    /// Stub health carries the new `uptime_ms` + `last_error` fields. Uptime is
    /// "very small positive" (we just constructed it), last_error is `None`.
    #[tokio::test]
    async fn t51_stub_health_exposes_uptime_and_clean_last_error() {
        let a = HermesAdapter::new_stub();
        let h = a.health().await.unwrap();
        assert!(h.ok);
        assert_eq!(h.adapter_id, "hermes");
        assert!(h.uptime_ms.is_some(), "stub must report uptime");
        assert!(h.last_error.is_none(), "fresh stub has no errors");
    }

    /// `list_sessions` honours the new `search` field. We don't know the
    /// exact contents of the fixture, but an obviously-absent needle must
    /// filter down to zero, and an empty/None query must match the full set.
    #[tokio::test]
    async fn t51_list_sessions_search_filters_by_title() {
        let a = HermesAdapter::new_stub();
        let full = a.list_sessions(SessionQuery::default()).await.unwrap();
        assert!(!full.is_empty(), "fixture must seed at least one session");

        let none = a
            .list_sessions(SessionQuery {
                search: Some("definitely-not-a-title-xyz-zzz".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(none.is_empty(), "impossible needle must match nothing");

        // First session's first word should always match itself (modulo case).
        let pivot_title = full[0].title.clone();
        let needle = pivot_title
            .split_whitespace()
            .next()
            .unwrap_or(&pivot_title)
            .to_string();
        let some = a
            .list_sessions(SessionQuery {
                search: Some(needle.to_uppercase()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(
            !some.is_empty(),
            "case-insensitive match on a word from an existing title must hit"
        );
    }

    /// `limit` caps the result set without interacting with `search`.
    #[tokio::test]
    async fn t51_list_sessions_limit_caps_result_set() {
        let a = HermesAdapter::new_stub();
        let capped = a
            .list_sessions(SessionQuery {
                limit: Some(1),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(capped.len(), 1, "limit=1 must yield one row");
    }

    /// `ChatTurn.cwd` survives a serde round-trip and defaults to `None`
    /// when absent from the wire (back-compat with pre-T5.1 callers).
    #[test]
    fn t51_chat_turn_cwd_is_optional_on_the_wire() {
        let legacy = r#"{"messages":[],"model":null}"#;
        let turn: ChatTurn = serde_json::from_str(legacy).unwrap();
        assert!(turn.cwd.is_none());

        let with_cwd = r#"{"messages":[],"model":null,"cwd":"/tmp/repo"}"#;
        let turn: ChatTurn = serde_json::from_str(with_cwd).unwrap();
        assert_eq!(turn.cwd.as_deref(), Some("/tmp/repo"));
    }
}
