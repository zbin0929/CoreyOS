//! Thin HTTP client for the Hermes gateway (`/health`, `/v1/chat/completions`).
//!
//! This is the Phase 1 Sprint 1 shape: non-streaming single-turn chat only.
//! Streaming (SSE) lands in Sprint 2 — see `docs/phases/phase-1-chat.md`.

use std::time::{Duration, Instant};

use eventsource_stream::Eventsource;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::error::{AdapterError, AdapterResult};

const USER_AGENT: &str = concat!("caduceus/", env!("CARGO_PKG_VERSION"));
/// Default total-request timeout. Fine for health + list_models + chat_once
/// (non-streaming). Streaming calls override this per-request (see
/// `STREAM_TIMEOUT_S`) because reasoning models routinely exceed 2 min.
const DEFAULT_TIMEOUT_S: u64 = 120;
/// Per-request timeout for streaming chat. Allows deepseek-reasoner,
/// gpt-5 etc. to spend minutes "thinking" before emitting the first token
/// without reqwest killing the TCP connection.
const STREAM_TIMEOUT_S: u64 = 30 * 60;

// ───────────────────────── Client ─────────────────────────

#[derive(Debug, Clone)]
pub struct HermesGateway {
    base_url: String,
    http: Client,
    api_key: Option<String>,
}

impl HermesGateway {
    /// Construct a client pointing at `base_url` (e.g. `http://127.0.0.1:8642`).
    /// `api_key` is the optional `API_SERVER_KEY` configured in `~/.hermes/.env`.
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> AdapterResult<Self> {
        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_S))
            .build()
            .map_err(|e| AdapterError::Internal {
                source: anyhow::anyhow!("reqwest build: {e}"),
            })?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http,
            api_key,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// `GET /health` — returns `(ok, latency_ms, raw_body)`.
    pub async fn health(&self) -> AdapterResult<HealthProbe> {
        let started = Instant::now();
        let resp = self
            .http
            .get(format!("{}/health", self.base_url))
            .send()
            .await
            .map_err(|e| AdapterError::Unreachable {
                endpoint: self.base_url.clone(),
                source: anyhow::anyhow!(e),
            })?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let latency_ms = started.elapsed().as_millis() as u32;

        if !status.is_success() {
            return Err(AdapterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }
        Ok(HealthProbe { latency_ms, body })
    }

    /// `GET /v1/models` — returns the OpenAI-compatible model list. The gateway's
    /// response is sparse (just `id` + `owned_by`); the adapter enriches it into
    /// `ModelInfo` by synthesizing missing fields.
    pub async fn list_models(&self) -> AdapterResult<Vec<ModelListEntry>> {
        let mut req = self.http.get(format!("{}/v1/models", self.base_url));
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let resp = req.send().await.map_err(|e| AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(e),
        })?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AdapterError::Unauthorized {
                detail: "gateway rejected credentials".into(),
            });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AdapterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }

        let parsed: ModelListResponse = resp.json().await.map_err(|e| AdapterError::Protocol {
            detail: format!("parse /v1/models: {e}"),
        })?;
        Ok(parsed.data)
    }

    /// `POST /v1/chat/completions` with `stream=false` — returns the assistant
    /// message content as a single string. Single-turn only for Sprint 1;
    /// caller supplies full message history on each call.
    pub async fn chat_once(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
    ) -> AdapterResult<ChatOnceResponse> {
        let body = ChatCompletionRequest {
            model: model.to_string(),
            messages,
            stream: false,
        };

        let mut req = self
            .http
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&body);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let started = Instant::now();
        let resp = req.send().await.map_err(|e| AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(e),
        })?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AdapterError::Unauthorized {
                detail: "gateway rejected credentials — check API_SERVER_KEY".into(),
            });
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AdapterError::RateLimited {
                retry_after_s: None,
            });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AdapterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }

        let parsed: ChatCompletionResponse =
            resp.json().await.map_err(|e| AdapterError::Protocol {
                detail: format!("malformed chat completion body: {e}"),
            })?;

        let first = parsed
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AdapterError::Protocol {
                detail: "gateway returned 0 choices".into(),
            })?;

        Ok(ChatOnceResponse {
            content: first.message.content.unwrap_or_default(),
            finish_reason: first.finish_reason,
            model: parsed.model,
            latency_ms: started.elapsed().as_millis() as u32,
            prompt_tokens: parsed.usage.as_ref().map(|u| u.prompt_tokens),
            completion_tokens: parsed.usage.as_ref().map(|u| u.completion_tokens),
        })
    }

    /// Streaming variant of `chat_once`. Forwards assistant content deltas
    /// AND Hermes-specific tool progress events over `tx` as they arrive from
    /// the gateway's SSE stream (`/v1/chat/completions` with `stream=true`).
    /// Resolves with the final metadata (finish_reason, usage) once the
    /// `[DONE]` marker arrives or the server closes the stream.
    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<ChatStreamEvent>,
    ) -> AdapterResult<ChatStreamDone> {
        let body = ChatCompletionRequest {
            model: model.to_string(),
            messages,
            stream: true,
        };

        let mut req = self
            .http
            .post(format!("{}/v1/chat/completions", self.base_url))
            // Override the client-wide 120 s timeout — reasoning models can
            // idle for minutes before emitting a token, and we don't want
            // reqwest to reset the TCP connection mid-stream.
            .timeout(Duration::from_secs(STREAM_TIMEOUT_S))
            .json(&body);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let started = Instant::now();
        let resp = req.send().await.map_err(|e| AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(e),
        })?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AdapterError::Unauthorized {
                detail: "gateway rejected credentials — check API_SERVER_KEY".into(),
            });
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AdapterError::RateLimited {
                retry_after_s: None,
            });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AdapterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }

        let mut byte_stream = resp.bytes_stream().eventsource();
        let mut finish_reason: Option<String> = None;
        let mut resolved_model: String = model.to_string();
        let mut prompt_tokens: Option<u32> = None;
        let mut completion_tokens: Option<u32> = None;
        // Tracks whether at least one content delta has reached the UI.
        // Used to decide whether a mid-stream transport error is a real
        // failure or just the server closing an otherwise-successful stream
        // (e.g. reasoning models that idle before emitting, or any upstream
        // that forgets to send a proper `[DONE]` sentinel).
        let mut received_any_delta = false;

        while let Some(event) = byte_stream.next().await {
            let event = match event {
                Ok(e) => e,
                Err(e) => {
                    if received_any_delta {
                        tracing::warn!(error = %e, "SSE stream dropped mid-flight; closing gracefully");
                        finish_reason.get_or_insert_with(|| "interrupted".into());
                        break;
                    }
                    return Err(AdapterError::Protocol {
                        detail: format!("SSE parse error: {e}"),
                    });
                }
            };
            let data = event.data;
            if data == "[DONE]" {
                break;
            }
            if data.is_empty() {
                continue;
            }

            // Branch on the SSE `event:` name. Default (empty) is standard
            // OpenAI-style completion chunks. Named events like
            // `hermes.tool.progress` carry agent-specific annotations.
            match event.event.as_str() {
                "hermes.tool.progress" => {
                    let progress: HermesToolProgress = match serde_json::from_str(&data) {
                        Ok(p) => p,
                        Err(e) => {
                            tracing::debug!(error = %e, raw = %data, "bad hermes.tool.progress");
                            continue;
                        }
                    };
                    if tx.send(ChatStreamEvent::Tool(progress)).await.is_err() {
                        return Ok(ChatStreamDone {
                            finish_reason: Some("cancelled".into()),
                            model: resolved_model,
                            latency_ms: started.elapsed().as_millis() as u32,
                            prompt_tokens,
                            completion_tokens,
                        });
                    }
                    // A tool event is proof the upstream is alive enough to
                    // count the session as partial-success if it drops now.
                    received_any_delta = true;
                }
                // Default event: OpenAI-compatible chat.completion.chunk.
                "" | "message" => {
                    let chunk: StreamChunk = match serde_json::from_str(&data) {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::debug!(error = %e, raw = %data, "skipping unparseable SSE chunk");
                            continue;
                        }
                    };
                    if !chunk.model.is_empty() {
                        resolved_model = chunk.model;
                    }
                    if let Some(usage) = chunk.usage {
                        prompt_tokens = Some(usage.prompt_tokens);
                        completion_tokens = Some(usage.completion_tokens);
                    }
                    for choice in chunk.choices {
                        if let Some(reason) = choice.finish_reason {
                            finish_reason = Some(reason);
                        }
                        if let Some(delta_content) = choice.delta.content {
                            if !delta_content.is_empty() {
                                if tx
                                    .send(ChatStreamEvent::Delta(delta_content))
                                    .await
                                    .is_err()
                                {
                                    return Ok(ChatStreamDone {
                                        finish_reason: Some("cancelled".into()),
                                        model: resolved_model,
                                        latency_ms: started.elapsed().as_millis() as u32,
                                        prompt_tokens,
                                        completion_tokens,
                                    });
                                }
                                received_any_delta = true;
                            }
                        }
                    }
                }
                other => {
                    tracing::debug!(event = other, raw = %data, "ignoring unknown SSE event");
                }
            }
        }

        Ok(ChatStreamDone {
            finish_reason,
            model: resolved_model,
            latency_ms: started.elapsed().as_millis() as u32,
            prompt_tokens,
            completion_tokens,
        })
    }
}

// ───────────────────────── DTOs ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HealthProbe {
    pub latency_ms: u32,
    pub body: String,
}

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

impl ChatMessageContent {
    /// Convenience for plain text turns.
    pub fn text(s: impl Into<String>) -> Self {
        Self::Text(s.into())
    }
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
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    model: String,
    choices: Vec<ChatChoice>,
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatChoiceMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

// ───────────────────────── /v1/models DTOs ─────────────────────────

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelListEntry>,
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
    /// Hermes-specific tool progress annotation. Emitted once when Hermes
    /// kicks off a tool invocation. The tool's OUTPUT is typically baked
    /// into subsequent `Delta` chunks by the agent, so we don't need a
    /// separate "tool complete" event to render results.
    Tool(HermesToolProgress),
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
struct StreamChunk {
    #[serde(default)]
    model: String,
    #[serde(default)]
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
}
