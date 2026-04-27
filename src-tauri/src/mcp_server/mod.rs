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
use tracing::{info, warn};

pub mod tools;

/// Globally-resolved port the MCP server is listening on. Populated
/// by `start()` exactly once per process. Used by `register_with_hermes`
/// (which writes the URL into `~/.hermes/config.yaml`) and by IPC
/// consumers that need to surface the URL in Settings.
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

        // Self-register with Hermes by patching ~/.hermes/config.yaml's
        // `mcp_servers:` section. Synchronous + cheap (one read +
        // atomic write), so we don't bother spawning. Failure is
        // logged inside; the bridge keeps serving regardless.
        register_with_hermes(bound.port());

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
/// We write directly to `~/.hermes/config.yaml`'s `mcp_servers:`
/// section using the same atomic `write_channel_yaml_fields` helper
/// `ipc::mcp` already uses for its CRUD page. The earlier draft tried
/// to shell out to `hermes mcp add corey-native --url ...` for
/// "single source of truth on the Hermes side", but Hermes 0.10's
/// `mcp add` is an interactive discovery wizard that
/// unconditionally initialises `prompt_toolkit` on stdin. Spawned
/// from a non-TTY parent (cargo dev, launchd) it crashes mid-init
/// (`OSError: [Errno 22] Invalid argument` from kqueue) and falls
/// through to `cmd_chat`, dumping the welcome banner into our log
/// and never writing the entry. Direct YAML write is both faster
/// (no subprocess) and immune to upstream CLI churn — Hermes
/// reloads `mcp_servers:` on the next gateway tick or `/reload-mcp`
/// slash command, exactly the same as the CLI path.
///
/// Idempotent: re-binding to a fresh port on each restart simply
/// rewrites the URL. Failure is logged at WARN; the bridge keeps
/// running and a manual edit of config.yaml still recovers.
fn register_with_hermes(port: u16) {
    use std::collections::HashMap;

    let url = format!("http://127.0.0.1:{port}/");

    // The yaml helper takes a map keyed by *child path*; here the
    // child is the server name (`corey-native`) and the value is the
    // full server config blob (just `{url}` for our HTTP transport).
    let entry = serde_json::json!({ "url": url });
    let mut updates: HashMap<String, serde_json::Value> = HashMap::new();
    updates.insert(MCP_NAME.into(), entry);

    match crate::hermes_config::write_channel_yaml_fields(
        "mcp_servers",
        &updates,
        None, // no audit-journal needed for our own auto-registration
    ) {
        Ok(()) => {
            info!(
                name = MCP_NAME,
                url = %url,
                "MCP: wrote mcp_servers.{MCP_NAME} -> {url} into ~/.hermes/config.yaml"
            );
        }
        Err(e) => {
            warn!(
                error = %e,
                "MCP: failed to update ~/.hermes/config.yaml; native bridge \
                 stays running but Hermes won't see it until the user \
                 manually adds an `mcp_servers.{MCP_NAME}.url` entry."
            );
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
