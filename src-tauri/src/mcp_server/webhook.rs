//! **B-10.7 webhook trigger** — HTTP entry point that starts a
//! workflow run from outside the app.
//!
//! Mounted at `POST /webhook/{workflow_id}` on the same axum
//! listener as the MCP JSON-RPC endpoint (so we get the
//! 127.0.0.1-only bind for free). The body is a JSON object that
//! becomes the workflow's `inputs` map; an empty object is fine.
//!
//! ## Auth
//!
//! Shared-secret bearer token. Generated as a random UUID on first
//! launch and stored at `~/.hermes/.corey-webhook-token` (mode 0600
//! on Unix). Callers send `Authorization: Bearer <token>`. Missing
//! or wrong token → 401. The token is also surfaced in Settings
//! via the `webhook_token_get` IPC so users can copy it for cron
//! / cloud workflows / IFTTT.
//!
//! Bind is 127.0.0.1 only so a missing / leaked token can't be
//! used from another machine — it's defense in depth against
//! other LOCAL apps starting workflows without consent.
//!
//! ## Wiring overview
//!
//! ```text
//!     POST /webhook/{wf_id}            mcp_server::webhook::handle
//!         body:  {…inputs}                       │
//!         auth:  Bearer <token>                  ▼
//!                                       check_token
//!                                                │
//!                                                ▼
//!                                start_workflow_run (shared with MCP)
//!                                                │
//!                                                ▼
//!                                  spawn_run_executor (engine)
//! ```

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use super::tools::start_workflow_run;
use super::McpState;

/// File holding the webhook bearer token, written under
/// `~/.hermes/.corey-webhook-token`. Hidden (leading dot) so a
/// directory listing in Finder doesn't surface it; permissions
/// are also tightened on Unix so other processes running under
/// a different uid can't read it.
const TOKEN_FILE_NAME: &str = ".corey-webhook-token";

/// Resolve the on-disk path for the webhook token. Errors if
/// `~/.hermes` can't be located (e.g. corrupt user dirs); callers
/// usually surface this as "webhook disabled" rather than crash.
fn token_path() -> std::io::Result<PathBuf> {
    let dir = crate::paths::hermes_data_dir()?;
    Ok(dir.join(TOKEN_FILE_NAME))
}

/// Read the webhook token from disk, or generate + persist one if
/// the file doesn't exist. Returns the token string.
///
/// Concurrent calls during first start are safe but may write the
/// file twice — last write wins. Token is stable across restarts
/// once the file exists.
pub fn ensure_token() -> std::io::Result<String> {
    let path = token_path()?;
    if path.exists() {
        let s = std::fs::read_to_string(&path)?;
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
        // File exists but empty — fall through to regenerate.
    }
    let token = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &token)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

/// Force-regenerate the webhook token, overwriting any existing
/// file. Returns the new token. Used by the Settings "rotate"
/// affordance — anyone holding the previous token loses access on
/// the next request because `current_token` will read the new
/// value and `token_eq` will fail.
pub fn rotate_token() -> std::io::Result<String> {
    let path = token_path()?;
    let token = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &token)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

/// Read the token without generating one if missing. Used by the
/// auth check — a None result here means "feature not yet
/// initialised" and we 503 the request rather than auto-creating
/// (which would race with `ensure_token` on first boot).
fn current_token() -> Option<String> {
    let path = token_path().ok()?;
    let s = std::fs::read_to_string(&path).ok()?;
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Constant-time-ish equality that doesn't short-circuit on the
/// first mismatching byte. Subtle: we still leak length, but our
/// tokens are fixed-length UUIDs so that's not a real signal.
fn token_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let trimmed = raw.trim();
    let rest = trimmed
        .strip_prefix("Bearer ")
        .or_else(|| trimmed.strip_prefix("bearer "))?;
    Some(rest.trim().to_string())
}

/// Axum handler for `POST /webhook/{workflow_id}`. Body must be a
/// JSON object — anything else gets 400. Returns
/// `{"run_id": "<uuid>", "workflow_id": "<id>"}` on 200.
pub async fn handle(
    State(state): State<Arc<McpState>>,
    Path(workflow_id): Path<String>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    // 1) Token gate. Compute the expected token lazily so the auth
    //    failure path doesn't have to read the file twice.
    let Some(expected) = current_token() else {
        tracing::warn!("webhook hit before token initialised; rejecting");
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "webhook token not initialised"})),
        )
            .into_response();
    };
    let Some(provided) = extract_bearer(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "missing Authorization: Bearer <token> header"})),
        )
            .into_response();
    };
    if !token_eq(&expected, &provided) {
        tracing::warn!(workflow_id = %workflow_id, "webhook auth failed: token mismatch");
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "invalid webhook token"})),
        )
            .into_response();
    }

    // 2) Body must be a JSON object (the workflow inputs map). We
    //    accept missing body as `{}` — a zero-input trigger is the
    //    most common case (cron / IFTTT ping / IM bot).
    let inputs = match body {
        Some(Json(Value::Object(map))) => Value::Object(map),
        Some(Json(_)) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "body must be a JSON object"})),
            )
                .into_response();
        }
        None => Value::Object(serde_json::Map::new()),
    };

    // 3) Hand off to the shared start helper. Returns the new run id.
    match start_workflow_run(&state.app, &workflow_id, inputs).await {
        Ok(run_id) => {
            tracing::info!(
                workflow_id = %workflow_id,
                run_id = %run_id,
                "webhook started workflow run"
            );
            (
                StatusCode::OK,
                Json(json!({"run_id": run_id, "workflow_id": workflow_id})),
            )
                .into_response()
        }
        Err((code, msg)) => {
            // -32602 (invalid params) → 400, anything else → 500.
            let status = if code == -32602 {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, Json(json!({"error": msg}))).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_eq_handles_length_mismatch() {
        assert!(!token_eq("abc", "abcd"));
        assert!(!token_eq("abcd", "abc"));
    }

    #[test]
    fn token_eq_matches_equal_strings() {
        assert!(token_eq(
            "550e8400-e29b-41d4-a716-446655440000",
            "550e8400-e29b-41d4-a716-446655440000"
        ));
    }

    #[test]
    fn token_eq_rejects_different_strings() {
        assert!(!token_eq(
            "550e8400-e29b-41d4-a716-446655440000",
            "550e8400-e29b-41d4-a716-446655440001"
        ));
    }

    #[test]
    fn extract_bearer_strips_prefix() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer abc-123".parse().unwrap(),
        );
        assert_eq!(extract_bearer(&h).as_deref(), Some("abc-123"));
    }

    #[test]
    fn extract_bearer_case_insensitive_scheme() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "bearer xyz".parse().unwrap(),
        );
        assert_eq!(extract_bearer(&h).as_deref(), Some("xyz"));
    }

    #[test]
    fn extract_bearer_none_when_missing() {
        let h = HeaderMap::new();
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn extract_bearer_none_when_wrong_scheme() {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            "Basic dXNlcjpwYXNz".parse().unwrap(),
        );
        assert!(extract_bearer(&h).is_none());
    }
}
