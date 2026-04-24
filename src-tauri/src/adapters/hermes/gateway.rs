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

const USER_AGENT: &str = concat!("corey/", env!("CARGO_PKG_VERSION"));
/// Default total-request timeout. Fine for health + list_models + chat_once
/// (non-streaming). Streaming calls override this per-request (see
/// `STREAM_TIMEOUT_S`) because reasoning models routinely exceed 2 min.
const DEFAULT_TIMEOUT_S: u64 = 120;
/// Per-request timeout for streaming chat. Allows deepseek-reasoner,
/// gpt-5 etc. to spend minutes "thinking" before emitting the first token
/// without reqwest killing the TCP connection.
const STREAM_TIMEOUT_S: u64 = 30 * 60;

/// T1.8 — max number of attempts when opening a streaming chat connection.
/// Covers the common "gateway just restarted" window (≤ a few seconds);
/// past that we surface the failure rather than spin for minutes. Only
/// applies to the **initial connect** — mid-stream drops are never
/// retried (would double-charge tokens + produce duplicated output).
const STREAM_CONNECT_ATTEMPTS: u32 = 3;
/// Initial backoff between connect retries. Doubles each retry:
/// 500 ms → 1 s → 2 s (total ~3.5 s wall-clock).
const STREAM_CONNECT_BACKOFF_MS: u64 = 500;

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

    /// Build an OpenAI-compatible endpoint URL relative to `base_url`.
    ///
    /// Most vendors publish under `.../v1`; a few (智谱 GLM at `/api/paas/v4`,
    /// tencent 混元 variants, …) live under a different `/v<N>` prefix. If
    /// the stored `base_url` already ends in `/v<digits>`, we just append
    /// `{suffix}` to it. Otherwise we keep the pre-existing behaviour of
    /// injecting `/v1/` so bare hosts like `http://127.0.0.1:8642` still
    /// resolve to the canonical `/v1/...` path.
    ///
    /// `suffix` is the leaf path WITHOUT a leading slash,
    /// e.g. `"chat/completions"` or `"models"`.
    fn api_url(&self, suffix: &str) -> String {
        if let Some(last) = self.base_url.rsplit('/').next() {
            if last.starts_with('v')
                && last.len() >= 2
                && last.as_bytes()[1].is_ascii_digit()
            {
                return format!("{}/{suffix}", self.base_url);
            }
        }
        format!("{}/v1/{suffix}", self.base_url)
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
        let mut req = self.http.get(self.api_url("models"));
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
            .post(self.api_url("chat/completions"))
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

        // T1.8 — retry the initial connect on `Unreachable` errors
        // (gateway just restarted / transient network blip). Once bytes
        // start flowing we NEVER retry: resending the prompt mid-stream
        // would re-charge tokens and duplicate output. Deterministic
        // failures (401/429/5xx with body) skip the retry loop — they'd
        // just fail the same way on the next attempt.
        let started = Instant::now();
        let resp = self.connect_chat_stream(&body).await?;

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
                        // Reasoning chunks are emitted BEFORE content
                        // chunks so the UI can render the "thinking"
                        // panel in arrival order even when a single
                        // SSE chunk carries both fields.
                        if let Some(reasoning) = choice.delta.reasoning_content {
                            if !reasoning.is_empty() {
                                if tx
                                    .send(ChatStreamEvent::Reasoning(reasoning))
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

    /// T1.8 — open the SSE stream with bounded retry.
    ///
    /// Retries only on `reqwest::Error`s raised by `send()` — i.e. the
    /// TCP connect / TLS handshake / HTTP-head phase failed before the
    /// server produced a status line. Anything that comes back with a
    /// status (even 5xx) is surfaced to the caller unchanged: we don't
    /// want to hammer a `502` 3× in a row, and we never re-send a
    /// prompt after the server acknowledged it.
    ///
    /// Backoff is exponential (500 / 1000 / 2000 ms) so total worst-case
    /// latency stays under ~4 s. Jitter isn't worth it at this scale
    /// (single-tenant desktop app; no thundering herd).
    async fn connect_chat_stream(
        &self,
        body: &ChatCompletionRequest,
    ) -> AdapterResult<reqwest::Response> {
        let mut last_err: Option<reqwest::Error> = None;
        for attempt in 0..STREAM_CONNECT_ATTEMPTS {
            let mut req = self
                .http
                .post(self.api_url("chat/completions"))
                // Override the client-wide 120 s timeout — reasoning
                // models can idle for minutes before emitting a token,
                // and we don't want reqwest to reset the TCP connection
                // mid-stream.
                .timeout(Duration::from_secs(STREAM_TIMEOUT_S))
                .json(body);
            if let Some(key) = &self.api_key {
                req = req.bearer_auth(key);
            }
            match req.send().await {
                Ok(resp) => {
                    if attempt > 0 {
                        tracing::info!(attempts = attempt + 1, "chat stream connected after retry");
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    last_err = Some(e);
                    // Don't sleep after the final attempt — we're about
                    // to surface the error to the caller anyway.
                    if attempt + 1 < STREAM_CONNECT_ATTEMPTS {
                        let backoff = STREAM_CONNECT_BACKOFF_MS << attempt;
                        tracing::warn!(
                            attempt = attempt + 1,
                            backoff_ms = backoff,
                            error = %last_err.as_ref().expect("just set"),
                            "chat stream connect failed; retrying"
                        );
                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                    }
                }
            }
        }
        let err = last_err.expect("STREAM_CONNECT_ATTEMPTS > 0");
        Err(AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(err),
        })
    }
}

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
    /// DeepSeek-reasoner + OpenAI o1 ship the chain-of-thought as a
    /// sibling `reasoning_content` field alongside `content`. Plain
    /// chat models don't emit this, so it stays `None` and we never
    /// surface it. Surfacing it on reasoning-capable models is
    /// T6.x.
    #[serde(default)]
    reasoning_content: Option<String>,
}

// ───────────────────────── Tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// `api_url` is the single source of truth for how we derive the
    /// OpenAI-compatible endpoint from an LLM Profile's `base_url`. It
    /// has three shapes to keep straight:
    ///   - Bare host (`.../8642`) → inject `/v1/`
    ///   - Already `/v1` → append directly
    ///   - Non-v1 versioned (`/v4`, `/v3beta`, …) → append directly
    ///     (bug fix for 智谱 GLM which lives at `/api/paas/v4`; pre-fix
    ///     builds produced `/v4/v1/chat/completions` → 404)
    #[test]
    fn api_url_handles_bare_v1_and_non_v1_bases() {
        let bare = HermesGateway::new("http://127.0.0.1:8642", None).unwrap();
        assert_eq!(
            bare.api_url("chat/completions"),
            "http://127.0.0.1:8642/v1/chat/completions"
        );
        assert_eq!(bare.api_url("models"), "http://127.0.0.1:8642/v1/models");

        let v1 = HermesGateway::new("https://api.openai.com/v1", None).unwrap();
        assert_eq!(
            v1.api_url("chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );

        // Regression: 智谱 GLM. Previously the client appended
        // /v1/chat/completions regardless, producing /v4/v1/... → 404.
        let glm = HermesGateway::new(
            "https://open.bigmodel.cn/api/paas/v4",
            None,
        )
        .unwrap();
        assert_eq!(
            glm.api_url("chat/completions"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        assert_eq!(
            glm.api_url("models"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );

        // Trailing slashes are stripped at construction so we never
        // accidentally emit `.../v4//chat/completions`.
        let glm_slash = HermesGateway::new(
            "https://open.bigmodel.cn/api/paas/v4/",
            None,
        )
        .unwrap();
        assert_eq!(
            glm_slash.api_url("chat/completions"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
    }
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    /// Spawn a TCP listener that accepts N connections, increments a
    /// counter, then immediately drops each socket so the client's
    /// `send()` fails mid-HTTP-head. Returns the bound port and the
    /// shared counter. The listener task terminates on its own once
    /// the parent drops the returned guard.
    async fn spawn_flaky_listener() -> (u16, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let count = Arc::new(AtomicUsize::new(0));
        let count_task = count.clone();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                count_task.fetch_add(1, Ordering::SeqCst);
                // Kill the socket before writing a status line — this
                // reliably surfaces as a reqwest transport error at
                // `send()` time.
                let _ = s.shutdown().await;
            }
        });
        (port, count)
    }

    /// T1.8 — chat_stream retries the initial connect up to
    /// `STREAM_CONNECT_ATTEMPTS` times when the gateway keeps dropping
    /// the TCP connection during the HTTP head. Each attempt lands on
    /// our flaky listener, which lets us assert the retry count
    /// without needing an HTTP mock library.
    #[tokio::test]
    async fn t18_chat_stream_retries_connect_on_transport_error() {
        let (port, count) = spawn_flaky_listener().await;
        let base = format!("http://127.0.0.1:{port}");
        let gw = HermesGateway::new(base, None).unwrap();

        let (tx, _rx) = mpsc::channel::<ChatStreamEvent>(4);
        let result = gw
            .chat_stream(
                "test-model",
                vec![ChatMessage {
                    role: "user".into(),
                    content: ChatMessageContent::Text("hi".into()),
                }],
                tx,
            )
            .await;

        assert!(
            matches!(result, Err(AdapterError::Unreachable { .. })),
            "expected Unreachable after exhausting retries, got {result:?}"
        );
        assert_eq!(
            count.load(Ordering::SeqCst),
            STREAM_CONNECT_ATTEMPTS as usize,
            "each retry should hit the listener exactly once"
        );
    }
}
