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
const DEFAULT_TIMEOUT_S: u64 = 120;

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
        Ok(HealthProbe {
            latency_ms,
            body,
        })
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
            return Err(AdapterError::RateLimited { retry_after_s: None });
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AdapterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }

        let parsed: ChatCompletionResponse = resp.json().await.map_err(|e| AdapterError::Protocol {
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

    /// `POST /v1/chat/completions` with `stream=true` — forwards each delta
    /// chunk (`choices[0].delta.content`) through `tx`. Returns a summary when
    /// the server sends `data: [DONE]` or the stream closes.
    ///
    /// Sends that fail because the receiver dropped are silently ignored — it
    /// means the caller cancelled the stream.
    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<String>,
    ) -> AdapterResult<ChatStreamDone> {
        let body = ChatCompletionRequest {
            model: model.to_string(),
            messages,
            stream: true,
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
            return Err(AdapterError::RateLimited { retry_after_s: None });
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

        while let Some(event) = byte_stream.next().await {
            let event = event.map_err(|e| AdapterError::Protocol {
                detail: format!("SSE parse error: {e}"),
            })?;
            let data = event.data;
            if data == "[DONE]" {
                break;
            }
            if data.is_empty() {
                continue;
            }
            let chunk: StreamChunk = match serde_json::from_str(&data) {
                Ok(c) => c,
                Err(e) => {
                    // Some gateways emit keep-alive or non-JSON events; log and skip.
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
                        // Silently drop if receiver is gone (caller cancelled).
                        if tx.send(delta_content).await.is_err() {
                            return Ok(ChatStreamDone {
                                finish_reason: Some("cancelled".into()),
                                model: resolved_model,
                                latency_ms: started.elapsed().as_millis() as u32,
                                prompt_tokens,
                                completion_tokens,
                            });
                        }
                    }
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

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
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

// ───────────────────────── Streaming DTOs ─────────────────────────

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
