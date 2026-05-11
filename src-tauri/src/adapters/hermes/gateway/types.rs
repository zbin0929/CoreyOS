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

/// Payload of a Hermes approval-required event. Hermes emits this when a
/// dangerous command is detected and needs explicit user approval.
///
/// Hermes 0.13.0 native shape (from `/v1/runs/{run_id}/events`) carries
/// `run_id` + `choices` directly; the legacy `_session_id` field came
/// from our retired `patch_approval_sse` patch and is no longer
/// populated, but we keep the serde-rename so historical fixtures still
/// parse cleanly.
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
    /// Run id from `/v1/runs`. Frontend echoes this back when responding
    /// via `POST /v1/runs/{run_id}/approval`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    /// Allowed choices Hermes accepts for this approval.
    /// Native emits `["once", "session", "always", "deny"]`.
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(
        rename = "_session_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub session_id: Option<String>,
}

// ───────────────────────── /v1/runs DTOs (Hermes 0.13.0) ─────────────────────────

/// Body for `POST /v1/runs`. `input` is either a string (single user
/// message) or an array of `{role, content}` messages — we always send
/// the array form so multi-turn history is preserved.
#[derive(Debug, Serialize)]
pub(super) struct RunStartRequest {
    pub(super) input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) conversation_history: Option<Vec<ChatMessage>>,
}

/// Response from `POST /v1/runs` — only `run_id` is required by the
/// caller. Other fields (`status`, `created_at`) are ignored.
#[derive(Debug, Deserialize)]
pub(super) struct RunStartResponse {
    pub(super) run_id: String,
}

/// Token usage shape on `run.completed`. Hermes-native names
/// (`input_tokens` / `output_tokens`) — different from OpenAI's
/// `prompt_tokens` / `completion_tokens` shape we use elsewhere; we
/// translate at the call site.
#[derive(Debug, Deserialize)]
pub(super) struct RunUsage {
    #[serde(default)]
    pub(super) input_tokens: u32,
    #[serde(default)]
    pub(super) output_tokens: u32,
    /// Hermes also emits `total_tokens` but we recompute from
    /// input+output downstream (matches the OpenAI shape we hand back
    /// to the IPC). Kept on the struct so a contract test can assert
    /// upstream still includes it.
    #[serde(default)]
    #[allow(dead_code)]
    pub(super) total_tokens: u32,
}

/// Discriminated union of every event the `/v1/runs/{run_id}/events`
/// SSE stream emits. Tagged on the `event` field; unknown events
/// surface as a deserialize error and are skipped at the call site.
#[derive(Debug, Deserialize)]
#[serde(tag = "event")]
pub(super) enum RunEvent {
    #[serde(rename = "message.delta")]
    MessageDelta {
        #[serde(default)]
        delta: String,
    },
    #[serde(rename = "tool.started")]
    ToolStarted {
        #[serde(default)]
        tool: String,
        #[serde(default)]
        emoji: Option<String>,
        #[serde(default)]
        label: Option<String>,
    },
    #[serde(rename = "tool.completed")]
    ToolCompleted {
        #[serde(default)]
        #[allow(dead_code)]
        tool: String,
    },
    #[serde(rename = "reasoning.available")]
    ReasoningAvailable {
        #[serde(default)]
        reasoning: String,
    },
    #[serde(rename = "approval.request")]
    ApprovalRequest {
        #[serde(default)]
        command: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        pattern_key: Option<String>,
        #[serde(default)]
        pattern_keys: Vec<String>,
        #[serde(default)]
        choices: Vec<String>,
        run_id: String,
    },
    #[serde(rename = "approval.responded")]
    ApprovalResponded {
        #[serde(default)]
        #[allow(dead_code)]
        choice: String,
    },
    #[serde(rename = "run.completed")]
    RunCompleted {
        #[serde(default)]
        usage: Option<RunUsage>,
    },
    #[serde(rename = "run.failed")]
    RunFailed {
        #[serde(default)]
        error: String,
    },
    #[serde(rename = "run.cancelled")]
    RunCancelled {},
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
    pub first_token_latency_ms: Option<u32>,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

// `StreamChunk` / `StreamChoice` / `StreamDelta` (the OpenAI-compat
// `/v1/chat/completions` streaming chunk shapes) were removed in the
// Hermes 0.13.0 `/v1/runs` migration — see `RunEvent` above for the
// new event union.

// ───────────────────────── Tests ─────────────────────────
