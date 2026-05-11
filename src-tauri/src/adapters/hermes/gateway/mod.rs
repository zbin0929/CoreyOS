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

        let url = self.api_url("chat/completions");
        let body_json = serde_json::to_vec(&body).map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("serialize chat body: {e}"),
        })?;

        // T-debug: build the request explicitly so we can re-issue it on
        // retry without consuming `req`. `RequestBuilder` is single-use
        // (its `.send()` takes self), and the workflow path was hitting
        // a stable "error sending request" that we couldn't introspect
        // because we only kept the outermost reqwest error.
        let send_once = || async {
            let mut r = self
                .http
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body_json.clone());
            if let Some(key) = &self.api_key {
                r = r.bearer_auth(key);
            }
            r.send().await
        };

        let started = Instant::now();
        let prompt_size = body_json.len();
        // Belt-and-suspenders: tracing::info! AND a raw eprintln. The
        // workflow path involves cargo run → tauri dev → multi-pipe
        // buffer chains that have been observed to delay tracing
        // output by minutes; eprintln writes directly to the
        // process's stderr file descriptor, immune to tracing
        // subscriber buffering. We accept the duplication for the
        // diagnostic value: when chat_once is suspected of hanging,
        // we need a definitive "the call WAS reached" signal.
        eprintln!(
            "[corey] hermes chat_once: dispatching url={} model={} messages={} bytes={}",
            url,
            model,
            body.messages.len(),
            prompt_size
        );
        tracing::info!(
            url = %url,
            model = %model,
            messages = body.messages.len(),
            prompt_bytes = prompt_size,
            "hermes chat_once: dispatching"
        );
        let resp = match send_once().await {
            Ok(r) => r,
            Err(e) => {
                // Most "error sending request" failures we've seen are
                // (a) a server-side-closed keep-alive socket the pool
                // handed back to us, or (b) a gateway restart racing
                // our request. Both heal on a single immediate retry
                // since reqwest will then dial a fresh TCP connection.
                let connect_class =
                    e.is_connect() || e.is_request() || e.is_timeout() || e.is_body();
                let chain = format_error_chain(&e);
                tracing::warn!(
                    url = %url,
                    is_connect = e.is_connect(),
                    is_timeout = e.is_timeout(),
                    is_request = e.is_request(),
                    is_body = e.is_body(),
                    is_decode = e.is_decode(),
                    chain = %chain,
                    "hermes chat_once: first attempt failed, will retry once"
                );
                if !connect_class {
                    return Err(AdapterError::Unreachable {
                        endpoint: self.base_url.clone(),
                        source: anyhow::anyhow!("{chain}"),
                    });
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
                match send_once().await {
                    Ok(r) => r,
                    Err(e2) => {
                        let chain2 = format_error_chain(&e2);
                        tracing::error!(
                            url = %url,
                            chain = %chain2,
                            "hermes chat_once: retry also failed"
                        );
                        return Err(AdapterError::Unreachable {
                            endpoint: self.base_url.clone(),
                            source: anyhow::anyhow!("{chain2}"),
                        });
                    }
                }
            }
        };

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

        let total_ms = started.elapsed().as_millis() as u64;
        eprintln!(
            "[corey] hermes chat_once: returned total_ms={} model={}",
            total_ms, parsed.model
        );
        tracing::info!(
            url = %url,
            model = %parsed.model,
            total_ms = total_ms,
            prompt_tokens = ?parsed.usage.as_ref().map(|u| u.prompt_tokens),
            completion_tokens = ?parsed.usage.as_ref().map(|u| u.completion_tokens),
            "hermes chat_once: returned"
        );

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

    /// Streaming chat via Hermes 0.13.0's `/v1/runs` endpoint.
    ///
    /// Two-step flow:
    /// 1. `POST /v1/runs` with `{input: messages[]}` → returns `run_id`.
    /// 2. `GET /v1/runs/{run_id}/events` SSE → forward `RunEvent`
    ///    variants over `tx` as they arrive.
    ///
    /// This replaces the OpenAI-compat `/v1/chat/completions` streaming
    /// path Corey used pre-2026-05-11. We migrated because Hermes only
    /// emits `approval.request` events on `/v1/runs`, and Corey's
    /// approval UI was the casualty after we retired source-patching.
    /// See `docs/migrations/hermes-v0.13-runs-endpoint.md`.
    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<ChatStreamEvent>,
    ) -> AdapterResult<ChatStreamDone> {
        let started = Instant::now();

        // Step 1: start the run. start_run handles the same retry
        // semantics chat_stream had on /v1/chat/completions: bounded
        // retries on transport errors, deterministic-error short-circuit.
        let run_id = self.start_run(model, &messages).await?;
        let connect_ms = started.elapsed().as_millis() as u64;
        tracing::info!(
            model = %model,
            run_id = %run_id,
            connect_ms = connect_ms,
            "hermes /v1/runs: run started"
        );

        // Step 2: open the events SSE stream.
        let resp = self.connect_run_events(&run_id).await?;

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
        let mut prompt_tokens: Option<u32> = None;
        let mut completion_tokens: Option<u32> = None;
        let mut received_any: bool = false;
        let mut first_event_at: Option<u64> = None;
        let mut first_reasoning_at: Option<u64> = None;
        let mut first_delta_at: Option<u64> = None;
        let mut first_tool_at: Option<u64> = None;
        let mut run_error: Option<String> = None;

        while let Some(event) = byte_stream.next().await {
            let event = match event {
                Ok(e) => e,
                Err(e) => {
                    if received_any {
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
            if data.is_empty() {
                continue;
            }
            if first_event_at.is_none() {
                let ms = started.elapsed().as_millis() as u64;
                first_event_at = Some(ms);
                tracing::info!(
                    model = %model,
                    run_id = %run_id,
                    elapsed_ms = ms,
                    since_connect_ms = ms.saturating_sub(connect_ms),
                    "hermes /v1/runs: first SSE event received"
                );
            }

            let parsed: RunEvent = match serde_json::from_str(&data) {
                Ok(p) => p,
                Err(e) => {
                    // Unknown / malformed events are non-fatal — Hermes
                    // can introduce new event types and we don't want
                    // a dev-console error per chunk.
                    tracing::debug!(error = %e, raw = %data, "skip unparseable run event");
                    continue;
                }
            };

            match parsed {
                RunEvent::MessageDelta { delta } => {
                    if delta.is_empty() {
                        continue;
                    }
                    if first_delta_at.is_none() {
                        let ms = started.elapsed().as_millis() as u64;
                        first_delta_at = Some(ms);
                        tracing::info!(
                            model = %model,
                            elapsed_ms = ms,
                            "hermes /v1/runs: first content delta (TTFT)"
                        );
                    }
                    if tx.send(ChatStreamEvent::Delta(delta)).await.is_err() {
                        return Ok(make_done(
                            "cancelled",
                            model,
                            &started,
                            first_delta_at,
                            prompt_tokens,
                            completion_tokens,
                        ));
                    }
                    received_any = true;
                }
                RunEvent::ReasoningAvailable { reasoning } => {
                    if reasoning.is_empty() {
                        continue;
                    }
                    if first_reasoning_at.is_none() {
                        let ms = started.elapsed().as_millis() as u64;
                        first_reasoning_at = Some(ms);
                        tracing::info!(
                            model = %model,
                            elapsed_ms = ms,
                            "hermes /v1/runs: first reasoning chunk"
                        );
                    }
                    if tx
                        .send(ChatStreamEvent::Reasoning(reasoning))
                        .await
                        .is_err()
                    {
                        return Ok(make_done(
                            "cancelled",
                            model,
                            &started,
                            first_delta_at,
                            prompt_tokens,
                            completion_tokens,
                        ));
                    }
                    received_any = true;
                }
                RunEvent::ToolStarted { tool, emoji, label } => {
                    if first_tool_at.is_none() {
                        let ms = started.elapsed().as_millis() as u64;
                        first_tool_at = Some(ms);
                        tracing::info!(
                            model = %model,
                            elapsed_ms = ms,
                            "hermes /v1/runs: first tool progress event"
                        );
                    }
                    let progress = HermesToolProgress { tool, emoji, label };
                    if tx.send(ChatStreamEvent::Tool(progress)).await.is_err() {
                        return Ok(make_done(
                            "cancelled",
                            model,
                            &started,
                            first_delta_at,
                            prompt_tokens,
                            completion_tokens,
                        ));
                    }
                    received_any = true;
                }
                RunEvent::ToolCompleted { .. } => {
                    // We don't expose tool.completed in the UI today; the
                    // tool's textual output is baked into the subsequent
                    // message.delta chunks anyway.
                }
                RunEvent::ApprovalRequest {
                    command,
                    description,
                    pattern_key,
                    pattern_keys,
                    choices,
                    run_id: ev_run_id,
                } => {
                    let approval = HermesApprovalRequest {
                        command,
                        pattern_key,
                        pattern_keys,
                        description,
                        run_id: Some(ev_run_id),
                        choices,
                        session_id: None,
                    };
                    tracing::warn!(
                        command = %approval.command,
                        desc = %approval.description,
                        "hermes /v1/runs: approval required"
                    );
                    if tx.send(ChatStreamEvent::Approval(approval)).await.is_err() {
                        return Ok(make_done(
                            "cancelled",
                            model,
                            &started,
                            first_delta_at,
                            prompt_tokens,
                            completion_tokens,
                        ));
                    }
                    received_any = true;
                }
                RunEvent::ApprovalResponded { .. } => {
                    // Hermes echoes the user's choice back on the stream
                    // for telemetry; no UI surface needed.
                }
                RunEvent::RunCompleted { usage } => {
                    if let Some(u) = usage {
                        prompt_tokens = Some(u.input_tokens);
                        completion_tokens = Some(u.output_tokens);
                    }
                    finish_reason.get_or_insert_with(|| "stop".into());
                    break;
                }
                RunEvent::RunFailed { error } => {
                    run_error = Some(error);
                    break;
                }
                RunEvent::RunCancelled {} => {
                    finish_reason = Some("cancelled".into());
                    break;
                }
            }
        }

        if let Some(err) = run_error {
            return Err(AdapterError::Upstream {
                status: 500,
                body: err,
            });
        }

        let total_ms = started.elapsed().as_millis() as u64;
        tracing::info!(
            model = %model,
            run_id = %run_id,
            connect_ms = connect_ms,
            first_event_ms = ?first_event_at,
            first_reasoning_ms = ?first_reasoning_at,
            first_delta_ms = ?first_delta_at,
            first_tool_ms = ?first_tool_at,
            total_ms = total_ms,
            prompt_tokens = ?prompt_tokens,
            completion_tokens = ?completion_tokens,
            "hermes /v1/runs: lifecycle"
        );
        Ok(ChatStreamDone {
            finish_reason,
            model: model.to_string(),
            latency_ms: total_ms as u32,
            first_token_latency_ms: first_delta_at.map(|v| v as u32),
            prompt_tokens,
            completion_tokens,
        })
    }

    /// `POST /v1/runs` with bounded retry on transport errors.
    /// Returns the new `run_id`. Mirrors the retry envelope the old
    /// `/v1/chat/completions` SSE connect had.
    async fn start_run(&self, _model: &str, messages: &[ChatMessage]) -> AdapterResult<String> {
        let url = self.api_url("runs");
        // We always send the array form so multi-turn history is
        // preserved. Hermes accepts string-or-array; array stays
        // closest to the OpenAI shape we use elsewhere.
        let input = serde_json::to_value(messages).map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("serialize /v1/runs input: {e}"),
        })?;
        let body = RunStartRequest {
            input,
            instructions: None,
            conversation_history: None,
        };

        let mut last_err: Option<reqwest::Error> = None;
        for attempt in 0..STREAM_CONNECT_ATTEMPTS {
            let mut req = self.http.post(&url).json(&body);
            if let Some(key) = &self.api_key {
                req = req.bearer_auth(key);
            }
            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(e);
                    if attempt + 1 < STREAM_CONNECT_ATTEMPTS {
                        let backoff = STREAM_CONNECT_BACKOFF_MS << attempt;
                        tracing::warn!(
                            attempt = attempt + 1,
                            backoff_ms = backoff,
                            error = %last_err.as_ref().expect("just set"),
                            "/v1/runs connect failed; retrying"
                        );
                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                    }
                    continue;
                }
            };

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
            let parsed: RunStartResponse =
                resp.json().await.map_err(|e| AdapterError::Protocol {
                    detail: format!("parse /v1/runs response: {e}"),
                })?;
            if attempt > 0 {
                tracing::info!(attempts = attempt + 1, "/v1/runs connected after retry");
            }
            return Ok(parsed.run_id);
        }
        let err = last_err.expect("STREAM_CONNECT_ATTEMPTS > 0");
        Err(AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(err),
        })
    }

    /// `GET /v1/runs/{run_id}/events` with bounded retry on transport
    /// errors. Caller checks the response status before parsing.
    async fn connect_run_events(&self, run_id: &str) -> AdapterResult<reqwest::Response> {
        let url = self.api_url(&format!("runs/{run_id}/events"));
        let mut last_err: Option<reqwest::Error> = None;
        for attempt in 0..STREAM_CONNECT_ATTEMPTS {
            let mut req = self
                .http
                .get(&url)
                // Long timeout for the SSE channel — reasoning models
                // can idle minutes between events.
                .timeout(Duration::from_secs(STREAM_TIMEOUT_S))
                .header(reqwest::header::ACCEPT, "text/event-stream");
            if let Some(key) = &self.api_key {
                req = req.bearer_auth(key);
            }
            match req.send().await {
                Ok(resp) => {
                    if attempt > 0 {
                        tracing::info!(
                            attempts = attempt + 1,
                            "/v1/runs events connected after retry"
                        );
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt + 1 < STREAM_CONNECT_ATTEMPTS {
                        let backoff = STREAM_CONNECT_BACKOFF_MS << attempt;
                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                    }
                }
            }
        }
        Err(AdapterError::Unreachable {
            endpoint: self.base_url.clone(),
            source: anyhow::anyhow!(last_err.expect("STREAM_CONNECT_ATTEMPTS > 0")),
        })
    }

    // Approval responses are POSTed by the `hermes_approval_respond`
    // IPC directly (it has its own reqwest client + the gateway base
    // URL from `AppState.config`), so we don't need a method here.
}

/// Build a `cancelled` `ChatStreamDone` from the partial timing state.
/// Only used when the frontend dropped the receiver mid-stream — at
/// that point we just want to close out the bookkeeping.
fn make_done(
    finish_reason: &str,
    model: &str,
    started: &Instant,
    first_delta_at: Option<u64>,
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
) -> ChatStreamDone {
    ChatStreamDone {
        finish_reason: Some(finish_reason.to_string()),
        model: model.to_string(),
        latency_ms: started.elapsed().as_millis() as u32,
        first_token_latency_ms: first_delta_at.map(|v| v as u32),
        prompt_tokens,
        completion_tokens,
    }
}

/// Walk the `std::error::Error::source()` chain into a single string.
/// reqwest's outer Display ("error sending request for url ...") hides
/// the actual cause (broken pipe / connection reset / dns error / ...);
/// chasing the chain is the only way to see the real OS-level reason.
fn format_error_chain<E: std::error::Error>(err: &E) -> String {
    let mut out = String::new();
    out.push_str(&format!("{err}"));
    let mut src: Option<&dyn std::error::Error> = err.source();
    while let Some(s) = src {
        out.push_str("  <- ");
        out.push_str(&format!("{s}"));
        src = s.source();
    }
    out
}

mod types;
pub use types::*;

#[cfg(test)]
mod tests;
