//! Provider capability probe — `GET {base_url}/v1/models` against an
//! OpenAI-compatible endpoint.
//!
//! This is **not** routed through the running Hermes gateway; it talks
//! directly to the upstream provider (OpenRouter, Anthropic, DeepSeek, etc.)
//! so the UI can populate "model id" suggestions from live data instead of
//! a hand-curated catalog that drifts the moment a provider ships a new
//! family.
//!
//! Shape we accept (OpenAI convention, what nearly every provider returns):
//!
//! ```json
//! { "object": "list", "data": [
//!     { "id": "gpt-4o", "object": "model", "owned_by": "openai", "created": 1709... },
//!     ...
//! ]}
//! ```
//!
//! Providers that diverge (bare array, pagination, different keys) land in
//! adapters later. For now we parse the OpenAI shape and reject anything
//! else with a clear error so the user notices.

use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AdapterError, AdapterResult};

const USER_AGENT: &str = concat!("corey/", env!("CARGO_PKG_VERSION"));
/// Probe is user-initiated (button click) — fast fail is more useful than
/// the default 120s chat timeout.
const PROBE_TIMEOUT_S: u64 = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredModel {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
    /// Unix seconds when the provider first published the model, if surfaced.
    /// Handy for sorting newest-first in the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeReport {
    pub endpoint: String,
    pub latency_ms: u32,
    pub models: Vec<DiscoveredModel>,
}

#[derive(Debug, Deserialize)]
struct ListResponse {
    data: Vec<DiscoveredModel>,
}

/// `GET {base_url}/v1/models`. `api_key`, if any, goes in an `Authorization:
/// Bearer` header. `base_url` may or may not include a trailing `/v1`; we
/// normalize.
pub async fn probe_models(base_url: &str, api_key: Option<&str>) -> AdapterResult<ProbeReport> {
    let endpoint = normalize_models_url(base_url);

    let http = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(PROBE_TIMEOUT_S))
        .build()
        .map_err(|e| AdapterError::Internal {
            source: anyhow::anyhow!("reqwest build: {e}"),
        })?;

    let mut req = http.get(&endpoint);
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }

    let started = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| AdapterError::Unreachable {
        endpoint: endpoint.clone(),
        source: anyhow::anyhow!(e),
    })?;
    let latency_ms = started.elapsed().as_millis() as u32;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(AdapterError::Unauthorized {
            detail: truncate(&body, 400),
        });
    }
    if !status.is_success() {
        return Err(AdapterError::Upstream {
            status: status.as_u16(),
            body: truncate(&body, 400),
        });
    }

    let models = parse_list_response(&body)?;
    Ok(ProbeReport {
        endpoint,
        latency_ms,
        models,
    })
}

/// Accept: `https://api.openai.com`, `https://api.openai.com/v1`,
/// `https://api.openai.com/v1/`, `https://api.openai.com/v1/models`. Return
/// the canonical `.../{version}/models` form.
///
/// Note on non-v1 providers: some vendors publish under a different version
/// segment — e.g. 智谱 GLM uses `https://open.bigmodel.cn/api/paas/v4`. If
/// we blindly append `/v1/models` to those we end up hitting a bogus
/// `/v4/v1/models` path that 404s. We therefore treat ANY trailing
/// `/v<digits>` segment as "already versioned" and just append `/models`.
fn normalize_models_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/models") {
        return trimmed.to_string();
    }
    // Already versioned: `.../v1`, `.../v4`, `.../v2beta`, etc. Append
    // `/models` directly instead of force-injecting a `/v1/` segment.
    if let Some(last) = trimmed.rsplit('/').next() {
        if last.starts_with('v') && last.len() >= 2 && last.as_bytes()[1].is_ascii_digit() {
            return format!("{trimmed}/models");
        }
    }
    format!("{trimmed}/v1/models")
}

fn parse_list_response(body: &str) -> AdapterResult<Vec<DiscoveredModel>> {
    // First try the canonical `{ "data": [...] }` shape.
    if let Ok(list) = serde_json::from_str::<ListResponse>(body) {
        return Ok(list.data);
    }
    // Fall back to a bare array (some self-hosted endpoints do this).
    if let Ok(bare) = serde_json::from_str::<Vec<DiscoveredModel>>(body) {
        return Ok(bare);
    }
    Err(AdapterError::Protocol {
        detail: format!(
            "unexpected /v1/models response shape: {}",
            truncate(body, 200)
        ),
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_various_forms() {
        assert_eq!(
            normalize_models_url("https://api.openai.com"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            normalize_models_url("https://api.openai.com/"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            normalize_models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            normalize_models_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            normalize_models_url("https://api.openai.com/v1/models"),
            "https://api.openai.com/v1/models"
        );
        // Non-v1 endpoints left as-is (self-hosted).
        assert_eq!(
            normalize_models_url("http://localhost:8080/models"),
            "http://localhost:8080/models"
        );
    }

    #[test]
    fn normalize_handles_non_v1_versioned_endpoints() {
        // 智谱 GLM — versions under `/api/paas/v4`. We must NOT blindly
        // append `/v1/models` or we hit `/v4/v1/models` which 404s.
        assert_eq!(
            normalize_models_url("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        assert_eq!(
            normalize_models_url("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        // Anthropic-style `/v2` or hypothetical `/v3`.
        assert_eq!(
            normalize_models_url("https://example.com/api/v3"),
            "https://example.com/api/v3/models"
        );
    }

    #[test]
    fn parse_canonical_list_shape() {
        let body = r#"{"object":"list","data":[
            {"id":"gpt-4o","object":"model","owned_by":"openai","created":1709222400},
            {"id":"gpt-4o-mini","object":"model","owned_by":"openai"}
        ]}"#;
        let models = parse_list_response(body).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].owned_by.as_deref(), Some("openai"));
        assert_eq!(models[0].created, Some(1709222400));
        assert_eq!(models[1].created, None);
    }

    #[test]
    fn parse_bare_array_shape() {
        let body = r#"[{"id":"llama3.2"},{"id":"mistral"}]"#;
        let models = parse_list_response(body).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[1].id, "mistral");
    }

    #[test]
    fn parse_rejects_garbage_with_clear_error() {
        let body = "<html>bad gateway</html>";
        let err = parse_list_response(body).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("unexpected"), "got: {msg}");
    }

    #[test]
    fn truncate_leaves_short_strings_alone() {
        assert_eq!(truncate("hi", 10), "hi");
        assert_eq!(truncate("hello", 3), "hel…");
    }
}
