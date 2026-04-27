//! MCP-over-HTTP server — exposes desktop-native capabilities to Hermes.
//!
//! Why this module exists
//! -----------------------
//! Hermes Agent runs as an OS-agnostic Python service; it has no direct
//! way to pop a native macOS Finder dialog, post a desktop notification,
//! or deep-link the user into Corey's Settings panel. Those are jobs
//! only the Tauri process — running in the user's GUI session — can do.
//!
//! Hermes already speaks Model Context Protocol (MCP) as a client (see
//! `hermes mcp add ...`), so the cleanest bridge is to run a tiny MCP
//! *server* inside Corey and let Hermes connect to it like any other
//! third-party MCP server. The user gains ~5 desktop-grade tools the
//! agent can call, without any plumbing on the Hermes side beyond a
//! one-time `hermes mcp add corey-native --url http://127.0.0.1:<port>/`.
//!
//! Wire format
//! -----------
//! MCP is JSON-RPC 2.0. We implement the minimal subset needed for tool
//! exposure:
//!   - `initialize`           — handshake; returns server info + caps.
//!   - `notifications/initialized` — fire-and-forget client signal.
//!   - `tools/list`           — returns the tool catalog.
//!   - `tools/call`           — invokes a single tool by name.
//!
//! Streaming / resources / prompts / sampling are intentionally NOT
//! implemented yet. They're pure cost without a near-term user story
//! (Hermes doesn't ask for them in its MCP-discovery probe, so we just
//! advertise an empty `resources` / `prompts` capability).
//!
//! Security
//! --------
//! The listener binds to **127.0.0.1 only**, on a port chosen by the OS
//! (`SocketAddr::from(([127, 0, 0, 1], 0))`). The resolved port is
//! written to `<config_dir>/mcp_server.port` so frontend / CLI tooling
//! can discover it without scanning. There is no auth — anything that
//! can already reach loopback on the user's box can already read every
//! file the user can read. Adding bearer tokens later is straightforward
//! if a multi-user desktop story emerges.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::OnceCell;
use tracing::{debug, info, warn};

pub mod tools;

/// Globally-resolved port the MCP server is listening on. Populated
/// by `start()` exactly once per process. Used by `register_with_hermes`
/// (which shells out to `hermes mcp add`) and by IPC consumers that
/// need to surface the URL in the UI.
static BOUND_PORT: OnceCell<u16> = OnceCell::const_new();

/// Fetch the MCP server's bound port. `None` until `start()` has run
/// to completion — callers that hit this during boot should retry.
/// Currently used only by `register_with_hermes` (via the bind result),
/// but kept `pub` so an upcoming `mcp_status` IPC command can surface
/// the live URL in Settings without re-walking the listener state.
#[allow(dead_code)]
pub fn bound_port() -> Option<u16> {
    BOUND_PORT.get().copied()
}

/// JSON-RPC 2.0 envelope. We don't model batched requests because the
/// MCP spec mandates support but Hermes' client doesn't use them and
/// shipping batch handling without a user story is needless surface.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)] // reserved for future strict-version checks
    jsonrpc: Option<String>,
    /// Optional — `notifications/*` methods omit `id` and don't get a
    /// response. We mirror that by returning `None` from the dispatch
    /// when `id` is absent.
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

/// Shared state passed to every handler. Holding `AppHandle` lets tool
/// implementations call back into Tauri's main thread (e.g. for native
/// dialogs that must run on the AppKit main loop on macOS).
#[derive(Clone)]
struct McpState {
    app: AppHandle,
}

/// Spawn the MCP HTTP server on a tokio task. Returns immediately — the
/// caller doesn't wait for the listener to be ready, but `bound_port()`
/// will be `Some` once it is. Failures during bind / serve are logged
/// at WARN; we don't propagate up because Corey is fully usable
/// without the MCP bridge (it just means Hermes loses access to native
/// capabilities, not that the app stops working).
pub fn start(app: AppHandle) {
    let state = McpState { app };
    let router = Router::new()
        // MCP discovery probes sometimes hit `GET /` to check liveness
        // before opening a real JSON-RPC session; reply with a tiny
        // banner so a curl from the user is self-explanatory.
        .route("/", get(banner).post(rpc_handler))
        .with_state(Arc::new(state));

    tauri::async_runtime::spawn(async move {
        let addr: SocketAddr = ([127, 0, 0, 1], 0).into();
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                warn!(error = %e, "MCP server: bind failed; native bridge disabled");
                return;
            }
        };
        let bound = match listener.local_addr() {
            Ok(a) => a,
            Err(e) => {
                warn!(error = %e, "MCP server: local_addr failed");
                return;
            }
        };
        let _ = BOUND_PORT.set(bound.port());
        info!(port = bound.port(), "MCP server: listening on 127.0.0.1");

        // Self-register with Hermes so the user doesn't have to run
        // `hermes mcp add` by hand. Idempotent: a stale entry pointing
        // at a previous run's port gets replaced. Failure is logged
        // and we keep serving — the user can still register manually.
        // Spawn-and-forget so a slow `hermes` CLI invocation can't
        // delay axum::serve below.
        tauri::async_runtime::spawn(register_with_hermes(bound.port()));

        if let Err(e) = axum::serve(listener, router).await {
            warn!(error = %e, "MCP server: axum::serve exited");
        }
    });
}

/// Name used as the MCP-config key on the Hermes side. Stable across
/// runs so `register_with_hermes` can re-bind it to a fresh port without
/// the user noticing.
const MCP_NAME: &str = "corey-native";

/// Add (or refresh) the `corey-native` MCP server entry in Hermes'
/// config so the agent can discover our tools without a manual
/// `hermes mcp add`.
///
/// Strategy:
///   1. List current MCP servers via `hermes mcp list`.
///   2. If `corey-native` exists pointing at the same URL we'd write,
///      do nothing — saves a Hermes config rewrite + re-init.
///   3. Otherwise, `remove` then `add` — simpler than parsing flags
///      to detect "needs update", and idempotent against partial state
///      from a previous crashed run.
///
/// Why shell out instead of writing `~/.hermes/config.yaml` directly:
/// Hermes treats that file as authoritative state. Editing it from
/// under a running gateway risks the gateway re-saving its in-memory
/// view and clobbering us. The CLI goes through Hermes' own write
/// pipeline (atomic, locked, validation-aware), which is the contract
/// upstream documents.
async fn register_with_hermes(port: u16) {
    use tokio::process::Command;

    // Resolve the hermes binary the SAME way the rest of Corey does
    // (bundled-with-Corey paths first, then $PATH). A previous draft
    // used `Command::new("hermes")` which only walks $PATH — that
    // works for developers who installed hermes globally, but breaks
    // for end users running the production .app bundle (where hermes
    // sits inside `Corey.app/Contents/Resources/_up_/binaries/`, not
    // on $PATH). Sharing `resolve_hermes_binary` keeps the lookup
    // policy in one place; if we ever add a 4th fallback location
    // (Homebrew Cellar, AppImage internal, …) every consumer benefits.
    let hermes = match crate::hermes_config::resolve_hermes_binary() {
        Ok(p) => p,
        Err(e) => {
            warn!(
                error = %e,
                "hermes binary not found via bundled-paths or $PATH; \
                 skipping MCP auto-register. Native bridge tools \
                 stay running but Hermes can't see them."
            );
            return;
        }
    };

    let url = format!("http://127.0.0.1:{port}/");

    // 1. Check if already registered with the same URL.
    let listing = Command::new(&hermes)
        .args(["mcp", "list"])
        .output()
        .await;
    let already_correct = match listing {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // `hermes mcp list` output isn't a stable structured
            // format; scrape for both the server name and the
            // current URL on nearby lines. Cheap and only matters
            // for the no-op fast path.
            stdout.contains(MCP_NAME) && stdout.contains(&url)
        }
        Ok(out) => {
            debug!(
                stderr = %String::from_utf8_lossy(&out.stderr),
                "hermes mcp list non-zero exit; will retry add path"
            );
            false
        }
        Err(e) => {
            warn!(
                error = %e,
                "hermes CLI not found in PATH; skipping auto-register. \
                 Hermes will not see Corey's native tools until the user \
                 runs `hermes mcp add corey-native --url {url}` manually."
            );
            return;
        }
    };
    if already_correct {
        info!(name = MCP_NAME, url = %url, "MCP: already registered with current URL");
        return;
    }

    // 2. Remove any stale entry. Failure is fine — most likely cause
    // is "no such server", which is exactly the state we want.
    let _ = Command::new(&hermes)
        .args(["mcp", "remove", MCP_NAME])
        .output()
        .await;

    // 3. Add fresh.
    let add = Command::new(&hermes)
        .args(["mcp", "add", MCP_NAME, "--url", &url])
        .output()
        .await;
    match add {
        Ok(out) if out.status.success() => {
            info!(name = MCP_NAME, url = %url, "MCP: registered with Hermes");
        }
        Ok(out) => {
            warn!(
                stdout = %String::from_utf8_lossy(&out.stdout),
                stderr = %String::from_utf8_lossy(&out.stderr),
                "hermes mcp add returned non-zero; native tools may be invisible to Hermes"
            );
        }
        Err(e) => {
            warn!(error = %e, "hermes mcp add invocation failed");
        }
    }
}

async fn banner() -> Json<Value> {
    Json(json!({
        "name": "corey-native",
        "protocol": "mcp",
        "transport": "http+jsonrpc",
        "doc": "POST JSON-RPC 2.0 envelopes to this URL. See \
                docs/mcp-server.md."
    }))
}

async fn rpc_handler(
    State(state): State<Arc<McpState>>,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    // Notifications (no `id`) get a 204 with no body — we still want to
    // honor side effects (e.g. `notifications/initialized` toggling
    // session state), but JSON-RPC says no envelope back.
    let is_notification = req.id.is_none();

    let result = dispatch(&state, &req.method, &req.params).await;

    if is_notification {
        return StatusCode::NO_CONTENT.into_response();
    }

    let id = req.id.unwrap_or(Value::Null);
    let body = match result {
        Ok(v) => JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(v),
            error: None,
        },
        Err((code, message)) => JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: None,
            }),
        },
    };
    Json(body).into_response()
}

/// Method dispatch. Returns `Ok(result_value)` to be wrapped in a
/// JSON-RPC `result`, or `Err((code, message))` to be wrapped in
/// `error`. JSON-RPC error codes:
///   -32601 method not found, -32602 invalid params, -32603 internal.
async fn dispatch(
    state: &McpState,
    method: &str,
    params: &Value,
) -> Result<Value, (i32, String)> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {},
                // Resources / prompts deliberately empty — see module
                // docstring for why.
                "resources": {},
                "prompts": {},
            },
            "serverInfo": {
                "name": "corey-native",
                "version": env!("CARGO_PKG_VERSION"),
            }
        })),
        // Most MCP clients send this immediately after `initialize`.
        // We have no per-session state to flip, so it's a no-op — but
        // we still want to match the method to avoid a "method not
        // found" turning up in Hermes' debug log on every connect.
        "notifications/initialized" => Ok(Value::Null),
        "tools/list" => Ok(json!({ "tools": tools::manifest() })),
        "tools/call" => tools::call(state.app.clone(), params).await,
        _ => Err((-32601, format!("method not found: {method}"))),
    }
}
