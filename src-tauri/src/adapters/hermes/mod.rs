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

fn extract_text_from_file(path: &str, mime: &str, name: &str) -> Option<String> {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if matches!(
        mime,
        "text/plain"
            | "text/markdown"
            | "text/csv"
            | "text/html"
            | "text/xml"
            | "application/json"
            | "application/xml"
            | "application/javascript"
    ) || matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "csv"
            | "json"
            | "xml"
            | "html"
            | "htm"
            | "js"
            | "ts"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "cfg"
            | "log"
            | "sh"
            | "bat"
    ) {
        let bytes = std::fs::read(path).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        Some(text.into_owned())
    } else if ext == "docx"
        || mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    {
        extract_docx_text(path)
    } else if ext == "xlsx"
        || mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    {
        extract_xlsx_text(path)
    } else if ext == "pdf" || mime == "application/pdf" {
        extract_pdf_text(path)
    } else {
        None
    }
}

fn decode_hex(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 {
        return Err(());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

fn extract_pdf_text(path: &str) -> Option<String> {
    use lopdf::Document;
    let doc = Document::load(path).ok()?;
    let mut pages_text: Vec<String> = Vec::new();
    let page_ids = doc.get_pages();
    let mut page_nums: Vec<u32> = page_ids.keys().copied().collect();
    page_nums.sort();
    for page_num in page_nums {
        let page_id = match page_ids.get(&page_num) {
            Some(&id) => id,
            None => continue,
        };
        let mut text_parts: Vec<String> = Vec::new();
        if let Ok(page_dict) = doc.get_dictionary(page_id) {
            if let Ok(contents_ref) = page_dict.get(b"Contents") {
                let content_ids: Vec<lopdf::ObjectId> = match contents_ref {
                    lopdf::Object::Reference(id) => vec![*id],
                    lopdf::Object::Array(arr) => arr
                        .iter()
                        .filter_map(|o| {
                            if let lopdf::Object::Reference(id) = o {
                                Some(*id)
                            } else {
                                None
                            }
                        })
                        .collect(),
                    _ => vec![],
                };
                for cid in content_ids {
                    if let Ok(obj) = doc.get_object(cid) {
                        if let Ok(stream) = obj.as_stream() {
                            if let Ok(decompressed) = stream.decompressed_content() {
                                let content_str = String::from_utf8_lossy(&decompressed);
                                for token in content_str.split_whitespace() {
                                    if token.starts_with('(') && token.ends_with(')') {
                                        let inner = &token[1..token.len() - 1];
                                        if !inner.is_empty() {
                                            text_parts.push(inner.to_string());
                                        }
                                    } else if token.starts_with('<') && token.ends_with('>') {
                                        let hex_str = &token[1..token.len() - 1];
                                        if let Ok(bytes) = decode_hex(hex_str) {
                                            if let Ok(s) = String::from_utf8(bytes) {
                                                let cleaned: String =
                                                    s.chars().filter(|c| !c.is_control()).collect();
                                                if !cleaned.is_empty() {
                                                    text_parts.push(cleaned);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if !text_parts.is_empty() {
            pages_text.push(text_parts.join(" "));
        }
    }
    if pages_text.is_empty() {
        return None;
    }
    let full = pages_text.join("\n\n");
    let truncated = if full.len() > 50_000 {
        let mut s = full[..50_000].to_string();
        s.push_str("\n\n[... truncated]");
        s
    } else {
        full
    };
    Some(truncated)
}

fn extract_docx_text(path: &str) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut xml = match archive.by_name("word/document.xml") {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut content = String::new();
    let _ = xml.read_to_string(&mut content);
    let text = content
        .split('<')
        .filter_map(|part| {
            if part.starts_with('w') && part.contains('>') {
                let end = part.find('>').unwrap_or(0);
                let tag = &part[..end];
                if tag.contains('t') && !tag.contains('/') {
                    let after = &part[end + 1..];
                    let close = after.find('<').unwrap_or(after.len());
                    let text = &after[..close];
                    if !text.is_empty() {
                        return Some(text.to_string());
                    }
                }
            }
            None
        })
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn extract_xlsx_text(path: &str) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut xml = match archive.by_name("xl/sharedStrings.xml") {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut content = String::new();
    let _ = xml.read_to_string(&mut content);
    let mut texts: Vec<String> = Vec::new();
    let mut pos = 0;
    while let Some(start) = content[pos..].find("<t") {
        pos += start;
        if let Some(gt) = content[pos..].find('>') {
            pos += gt + 1;
            if let Some(end) = content[pos..].find("</t>") {
                let text = content[pos..pos + end].trim().to_string();
                if !text.is_empty() {
                    texts.push(text);
                }
                pos += end;
            }
        }
    }
    if texts.is_empty() {
        None
    } else {
        Some(texts.join(" | "))
    }
}

/// Turn a (text, attachments) pair into the right `ChatMessageContent`.
/// Exposed at module level so unit tests can exercise it without spinning
/// up a whole adapter.
fn build_content(
    text: String,
    attachments: Vec<ChatAttachmentRef>,
    vision: bool,
) -> ChatMessageContent {
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
        if is_image && vision {
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
        if is_image && !vision {
            text_with_markers.push_str(&format!(
                "[attached: {} (图片 - 当前模型不支持图片)]",
                a.name
            ));
        } else if let Some(extracted) = extract_text_from_file(&a.path, &a.mime, &a.name) {
            let cap = 50000;
            let truncated = if extracted.len() > cap {
                format!("{}...(文件过长，已截断)", &extracted[..cap])
            } else {
                extracted
            };
            text_with_markers.push_str(&format!("[attached: {}]\n{}", a.name, truncated));
        } else {
            text_with_markers.push_str(&format!("[attached: {}]", a.name));
        }
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


// Tests live in `mod_tests.rs` so the implementation file stays
// under the 800-line guideline (see `scripts/check-file-sizes.mjs`).
// `#[path]` is used (rather than a sibling `tests/` dir) so the
// canonical adapter module file remains `mod.rs`.
#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
