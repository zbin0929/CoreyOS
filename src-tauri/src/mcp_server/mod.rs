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
        // Try the pinned port first. Pinning matters because
        // (1) Hermes only re-reads `mcp_servers:` on gateway restart,
        //     so a fresh OS-chosen port every boot would force a
        //     restart-and-flush every time Corey relaunches — annoying
        //     and tears down whatever in-flight chat the user had;
        // (2) advertising a fixed URL lets curl-based debugging /
        //     bookmarks / Settings-page screenshots stay valid across
        //     dev sessions.
        // 8649 is unregistered with IANA and free on every macOS we
        // tested; if it's taken (parallel Corey instance, dev / prod
        // simultaneously, or the user assigned it to something else),
        // fall back to OS-chosen so the bridge still comes up — at
        // the cost of a gateway-config drift the user has to live
        // with for that session.
        const PREFERRED_PORT: u16 = 8649;
        let listener = match tokio::net::TcpListener::bind(SocketAddr::from((
            [127, 0, 0, 1],
            PREFERRED_PORT,
        )))
        .await
        {
            Ok(l) => l,
            Err(_) => {
                let fallback: SocketAddr = ([127, 0, 0, 1], 0).into();
                match tokio::net::TcpListener::bind(fallback).await {
                    Ok(l) => {
                        warn!(
                            preferred = PREFERRED_PORT,
                            "MCP server: preferred port busy; falling back to random. \
                             Hermes gateway will need a restart for it to see the new URL."
                        );
                        l
                    }
                    Err(e) => {
                        warn!(error = %e, "MCP server: bind failed; native bridge disabled");
                        return;
                    }
                }
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

    // 1. Fast-path: if config.yaml already has us at this exact URL,
    //    the running Hermes gateway has already picked us up — no
    //    write, no restart, no chat-session interruption. This is the
    //    common steady-state case (port pinned to 8649, user just
    //    relaunched Corey). Reading the file is O(KB) and dwarfed by
    //    every other thing happening at boot, so skipping the parse
    //    isn't worth a fancier check.
    if current_url_matches(&url) {
        info!(
            name = MCP_NAME,
            url = %url,
            "MCP: ~/.hermes/config.yaml already has matching entry; no restart needed"
        );
        return;
    }

    // 2. Write the entry. Atomic + journal-less (this isn't a user
    //    edit, so no audit row is warranted).
    let entry = serde_json::json!({ "url": url });
    let mut updates: HashMap<String, serde_json::Value> = HashMap::new();
    updates.insert(MCP_NAME.into(), entry);
    if let Err(e) =
        crate::hermes_config::write_channel_yaml_fields("mcp_servers", &updates, None)
    {
        warn!(
            error = %e,
            "MCP: failed to update ~/.hermes/config.yaml; native bridge \
             stays running but Hermes won't see it until the user \
             manually adds an `mcp_servers.{MCP_NAME}.url` entry."
        );
        return;
    }
    info!(
        name = MCP_NAME,
        url = %url,
        "MCP: wrote mcp_servers.{MCP_NAME} -> {url} into ~/.hermes/config.yaml"
    );

    // 3. Restart the gateway so the new server enters Hermes' live
    //    runtime registry. No HTTP `/reload-mcp` exists upstream
    //    (verified against Hermes 0.10) — restart is the only path.
    //    Cost: any in-flight chat completion drops; sessions resume
    //    transparently on the next request because session state
    //    lives in `~/.hermes/`. This only happens when our URL
    //    *changed*, so steady-state restarts of Corey are silent.
    //
    //    `gateway_restart` is sync (shells out to `hermes gateway
    //    restart`, which can take a couple of seconds). Hand it to
    //    `spawn_blocking` so we don't park the tokio worker that's
    //    about to enter `axum::serve`.
    tauri::async_runtime::spawn(async {
        let result = tokio::task::spawn_blocking(crate::hermes_config::gateway_restart).await;
        match result {
            Ok(Ok(_)) => info!("MCP: hermes gateway restarted to pick up corey-native"),
            Ok(Err(e)) => warn!(
                error = %e,
                "MCP: gateway restart failed; user must run `hermes gateway restart` \
                 to make the native tools visible."
            ),
            Err(e) => warn!(error = %e, "MCP: gateway restart join error"),
        }
    });
}

/// Quick scan of `~/.hermes/config.yaml` for the existing
/// `mcp_servers.<MCP_NAME>.url`. Returns `true` only when the file
/// exists, parses, has our entry, AND the URL is exactly `expected`.
/// Any failure mode (missing file, malformed yaml, missing key)
/// returns `false`, which falls through to the normal "write and
/// restart" path — i.e. we err on the side of fixing things.
fn current_url_matches(expected: &str) -> bool {
    let Ok(hermes_dir) = crate::paths::hermes_data_dir() else {
        return false;
    };
    let path = hermes_dir.join("config.yaml");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(doc) = serde_yaml::from_str::<serde_yaml::Value>(&raw) else {
        return false;
    };
    let Some(servers) = doc.get("mcp_servers") else {
        return false;
    };
    let Some(entry) = servers.get(MCP_NAME) else {
        return false;
    };
    entry.get("url").and_then(|v| v.as_str()) == Some(expected)
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

    // Log every method call at INFO so problems like "Hermes never
    // calls us" or "Hermes only calls initialize but not tools/list"
    // are diagnosable from `pnpm tauri:dev` output without attaching
    // a debugger or sniffing loopback. Args are deliberately NOT
    // logged — they could carry sensitive paths from `pick_file`.
    info!(method = %req.method, has_id = !is_notification, "MCP rpc");

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
