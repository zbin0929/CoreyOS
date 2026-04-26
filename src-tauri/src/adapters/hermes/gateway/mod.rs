//! Thin HTTP client for the Hermes gateway (`/health`, `/v1/chat/completions`).
//!
//! This is the Phase 1 Sprint 1 shape: non-streaming single-turn chat only.
//! Streaming (SSE) lands in Sprint 2 — see `docs/phases/phase-1-chat.md`.

use std::time::{Duration, Instant};

use eventsource_stream::Eventsource;
use futures::StreamExt;
use reqwest::Client;
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
            if last.starts_with('v') && last.len() >= 2 && last.as_bytes()[1].is_ascii_digit() {
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

        let mut req = self.http.post(self.api_url("chat/completions")).json(&body);
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

mod types;
pub use types::*;

#[cfg(test)]
mod tests;
