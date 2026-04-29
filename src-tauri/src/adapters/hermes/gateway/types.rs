use serde::{Deserialize, Serialize};

// ───────────────────────── DTOs ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HealthProbe {
    pub latency_ms: u32,
    pub body: String,
}

/// Full response from a non-streaming `chat_once`. Today only
/// `content` is read by the `chat_send` IPC — the other fields mirror
/// the upstream schema so this struct stays an accurate record of what
/// the gateway returns. Keeping the extra fields named (rather than
/// stripping them) makes it a trivial one-line change to start
/// surfacing token / latency stats on non-streaming calls.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ChatOnceResponse {
    pub content: String,
    pub finish_reason: Option<String>,
    pub model: String,
    pub latency_ms: u32,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

/// OpenAI-compatible chat message. `content` is either a plain string
/// (the classic shape) or an array of typed content parts (OpenAI's
/// multimodal shape, `{type: "text", ...} | {type: "image_url", ...}`).
/// T1.5b chose the untagged-enum route so non-vision turns keep emitting
/// the minimal string payload — important for provider parity because
/// some gateways reject the array form when there are no image parts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: ChatMessageContent,
}

/// Either a plain text body or an OpenAI multimodal `content` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatMessageContent {
    Text(String),
    Parts(Vec<ChatContentPart>),
}

/// A single part of a multimodal `content` array. Mirrors OpenAI's
/// `chat.completions` multimodal input — the only shapes we emit today
/// are `text` and `image_url`; room to add `audio` / `file` later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatContentPart {
    Text { text: String },
    ImageUrl { image_url: ChatImageUrl },
}

/// OpenAI wraps image data in `{ url: "data:…" | "https://…" }`. `detail`
/// is optional and gateway-specific (some providers honour `"low"` /
/// `"high"` / `"auto"`); we don't set it for now.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatImageUrl {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub(super) struct ChatCompletionRequest {
    pub(super) model: String,
    pub(super) messages: Vec<ChatMessage>,
    pub(super) stream: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct ChatCompletionResponse {
    #[serde(default)]
    pub(super) model: String,
    pub(super) choices: Vec<ChatChoice>,
    pub(super) usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ChatChoice {
    pub(super) message: ChatChoiceMessage,
    pub(super) finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ChatChoiceMessage {
    #[serde(default)]
    pub(super) content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ChatUsage {
    #[serde(default)]
    pub(super) prompt_tokens: u32,
    #[serde(default)]
    pub(super) completion_tokens: u32,
}

// ───────────────────────── /v1/models DTOs ─────────────────────────

#[derive(Debug, Deserialize)]
pub(super) struct ModelListResponse {
    #[serde(default)]
    pub(super) data: Vec<ModelListEntry>,
}

/// Minimal fields the OpenAI-compatible `/v1/models` endpoint is guaranteed
/// to return. Hermes may emit extra fields (e.g. provider-specific metadata)
/// which we ignore.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelListEntry {
    pub id: String,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub created: Option<i64>,
}

// ───────────────────────── Streaming DTOs ─────────────────────────

/// A single item forwarded from the SSE loop to the IPC layer. Hermes
/// interleaves plain content deltas with agent annotations like tool-progress
/// markers — they share the same ordered channel so the UI can render them
/// in the correct sequence relative to the surrounding text.
#[derive(Debug, Clone)]
pub enum ChatStreamEvent {
    /// Assistant content chunk (appended to the message body).
    Delta(String),
    /// Reasoning-content chunk (e.g. DeepSeek-reasoner / OpenAI o1
    /// `reasoning_content` field). Rendered in a collapsible
    /// "Thinking" section above the main content, NOT mixed into the
    /// final reply. Empty chunks are filtered out upstream.
    Reasoning(String),
    /// Hermes-specific tool progress annotation. Emitted once when Hermes
    /// kicks off a tool invocation. The tool's OUTPUT is typically baked
    /// into subsequent `Delta` chunks by the agent, so we don't need a
    /// separate "tool complete" event to render results.
    Tool(HermesToolProgress),
    /// Dangerous command approval request. Hermes blocks the agent thread
    /// until the user responds via the approval API. The frontend must
    /// show a confirmation card and call `hermes_approval_respond`.
    Approval(HermesApprovalRequest),
}

/// Payload of a `hermes.approval` SSE event. Hermes emits this when a
/// dangerous command is detected and needs explicit user approval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesApprovalRequest {
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub pattern_key: Option<String>,
    #[serde(default)]
    pub pattern_keys: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "_session_id", default)]
    pub session_id: Option<String>,
}

/// Payload of a `hermes.tool.progress` SSE event. Hermes emits the agent's
/// short description of what it's doing (e.g. `label: "pwd"` for a `terminal`
/// call). All fields may be absent in principle; we accept them defensively.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HermesToolProgress {
    /// Tool kind slug (e.g. `"terminal"`, `"file_read"`, `"web_search"`).
    #[serde(default)]
    pub tool: String,
    /// Emoji the Hermes agent picked to decorate this tool call.
    #[serde(default)]
    pub emoji: Option<String>,
    /// Short label — usually the command or arg summary.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatStreamDone {
    pub finish_reason: Option<String>,
    pub model: String,
    pub latency_ms: u32,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamChunk {
    #[serde(default)]
    pub(super) model: String,
    #[serde(default)]
    pub(super) choices: Vec<StreamChoice>,
    #[serde(default)]
    pub(super) usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamChoice {
    #[serde(default)]
    pub(super) delta: StreamDelta,
    pub(super) finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct StreamDelta {
    #[serde(default)]
    pub(super) content: Option<String>,
    /// DeepSeek-reasoner + OpenAI o1 ship the chain-of-thought as a
    /// sibling `reasoning_content` field alongside `content`. Plain
    /// chat models don't emit this, so it stays `None` and we never
    /// surface it. Surfacing it on reasoning-capable models is
    /// T6.x.
    #[serde(default)]
    pub(super) reasoning_content: Option<String>,
}

// ───────────────────────── Tests ─────────────────────────
