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
    http::{HeaderMap, StatusCode},
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
        // GET → 405 for MCP clients (Accept: text/event-stream),
        //      banner JSON for everyone else. See `handle_get`.
        // POST → JSON-RPC dispatch.
        .route("/", get(handle_get).post(rpc_handler))
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
        let listener =
            match tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], PREFERRED_PORT)))
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

        // Spawn axum::serve onto its OWN tokio task so we can move on
        // to writing config.yaml + restarting Hermes without waiting.
        // Critically, this means by the time `register_with_hermes`
        // finishes patching config.yaml and triggers a gateway
        // restart, axum has already entered its `accept()` loop —
        // so the new Hermes process's first MCP connect attempt
        // hits a listener that's not just bound but actively
        // accepting.
        //
        // Earlier draft awaited `axum::serve` inline, before
        // `register_with_hermes`. That was wrong: the gateway
        // restart triggers an MCP discovery handshake against us
        // immediately on Hermes startup, and if there's any
        // race between bind and accept the new Hermes' Python
        // anyio TaskGroup raises and the corey-native server
        // gets marked permanently dead until the next restart.
        let serve_task = tauri::async_runtime::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                warn!(error = %e, "MCP server: axum::serve exited");
            }
        });

        // Yield once so the spawned task gets scheduled and at
        // least starts polling the accept loop before we go off
        // and bounce Hermes. Belt-and-braces — modern tokio
        // already spawns onto a worker thread, but a single
        // `yield_now` is cheap insurance against pathological
        // schedulers.
        tokio::task::yield_now().await;

        // Self-register with Hermes by patching ~/.hermes/config.yaml's
        // `mcp_servers:` section. Synchronous + cheap (one read +
        // atomic write), so we don't bother spawning. Failure is
        // logged inside; the bridge keeps serving regardless.
        register_with_hermes(bound.port());

        // Hold the serve task by awaiting it; Tauri's runtime keeps
        // the task alive even if we drop the handle, but awaiting
        // here surfaces termination errors at the original spawn
        // site rather than dropping silently.
        if let Err(e) = serve_task.await {
            warn!(error = %e, "MCP server: serve task join error");
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
    if let Err(e) = crate::hermes_config::write_channel_yaml_fields("mcp_servers", &updates, None) {
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

/// GET handler. Spec-compliant per the Streamable HTTP transport:
///
///   - If the client asks for SSE (Accept includes `text/event-stream`,
///     which the official MCP Python SDK does to maintain a server-
///     initiated message stream), we MUST either return an actual SSE
///     stream OR `405 Method Not Allowed`. We don't have any
///     server-to-client traffic to push, so 405 is the honest answer.
///     This is the hot fix for the cascading reconnect bug — Hermes'
///     anyio TaskGroup raised on getting `200 application/json` here
///     because its SSE parser choked, the whole client Task died, and
///     Hermes auto-reconnected. With 405 the SDK simply marks this
///     server as "no server-push support" and keeps the POST channel
///     alive across the entire process lifetime.
///
///   - Otherwise (browser / curl / any non-MCP probe), serve the JSON
///     banner so a human poking at the URL gets something readable.
async fn handle_get(headers: HeaderMap) -> Response {
    let wants_sse = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("text/event-stream"))
        .unwrap_or(false);

    if wants_sse {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [("Allow", "POST")],
            "Server-initiated SSE not supported. Use POST for JSON-RPC.",
        )
            .into_response();
    }

    Json(json!({
        "name": "corey-native",
        "protocol": "mcp",
        "transport": "http+jsonrpc",
        "doc": "POST JSON-RPC 2.0 envelopes to this URL. See \
                docs/mcp-server.md."
    }))
    .into_response()
}

/// Session ID returned from `initialize` and required on subsequent
/// requests per the Streamable HTTP spec. We use a single static
/// session for the process — the spec lets us choose the policy, and
/// keeping a single session means Hermes' client (or any other) only
/// has to handshake once even across reconnects, instead of paying
/// the `initialize → notifications/initialized → tools/list` round
/// every chat completion. Re-using a UUID generated at module init
/// keeps the value stable for the process lifetime; restarts get a
/// fresh ID, which matches what the spec calls "session expired".
static SESSION_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn session_id() -> &'static str {
    SESSION_ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

async fn rpc_handler(
    State(state): State<Arc<McpState>>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    // 1. Origin validation. Streamable HTTP spec REQUIRES servers to
    //    reject foreign origins to prevent DNS rebinding attacks
    //    against local MCP servers. We allow:
    //      - missing Origin (curl, server-to-server, MCP CLI clients)
    //      - 127.0.0.1 / localhost / null
    //    Anything else → 403. Hermes runs on the same box; its
    //    Origin header (if present) will pass.
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        if !is_local_origin(origin) {
            warn!(origin = %origin, "MCP rpc rejected: foreign Origin");
            return (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32600,
                        "message": format!("foreign Origin not allowed: {origin}"),
                    }
                })),
            )
                .into_response();
        }
    }

    // 2. Notifications (no `id`) — spec: respond with 202 Accepted, no
    //    body. We previously returned 204 No Content, which is also a
    //    valid 2xx but spec-non-compliant; some MCP clients (e.g. the
    //    Python SDK Hermes uses) parse the status code strictly and
    //    fail handshake on anything other than 202. Switch to 202.
    let is_notification = req.id.is_none();

    // Log every method call at INFO so problems like "Hermes never
    // calls us" or "Hermes only calls initialize but not tools/list"
    // are diagnosable from `pnpm tauri:dev` output without attaching
    // a debugger or sniffing loopback. Args are deliberately NOT
    // logged — they could carry sensitive paths from `pick_file`.
    info!(method = %req.method, has_id = !is_notification, "MCP rpc");

    let result = dispatch(&state, &req.method, &req.params).await;

    // For notifications: 202 Accepted, no body, but DO include
    // session header — the client may be sending its
    // `notifications/initialized` immediately after `initialize` and
    // expects the same session.
    if is_notification {
        let mut resp = StatusCode::ACCEPTED.into_response();
        resp.headers_mut().insert(
            "MCP-Session-Id",
            session_id().parse().expect("ASCII session id"),
        );
        return resp;
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
    // 200 OK with Content-Type: application/json + MCP-Session-Id.
    // Spec: client MUST echo the session id back on every subsequent
    // request once it sees one in the InitializeResult. By emitting
    // it on EVERY response (not just initialize) we make sure clients
    // that miss it on initialize can still pick it up on a later
    // turn — defensive against quirky clients.
    let mut resp = Json(body).into_response();
    resp.headers_mut().insert(
        "MCP-Session-Id",
        session_id().parse().expect("ASCII session id"),
    );
    resp
}

/// Streamable HTTP spec security gate. Allows local-context Origins
/// only — anything from a real domain implies a malicious page is
/// trying to talk to our loopback server via DNS rebinding. Schemes
/// other than http/https (e.g. tauri://, file://) are also allowed
/// because Hermes / Tauri / Electron / curl can show up that way.
fn is_local_origin(origin: &str) -> bool {
    // Cheap allow list. We don't bother parsing the URL because the
    // patterns we accept are exact prefixes.
    const LOCAL_PREFIXES: &[&str] = &[
        "http://127.0.0.1",
        "http://localhost",
        "https://127.0.0.1",
        "https://localhost",
        "http://[::1]",
        "https://[::1]",
        "tauri://",
        "file://",
        "null",
    ];
    LOCAL_PREFIXES.iter().any(|p| origin.starts_with(p))
}

/// Method dispatch. Returns `Ok(result_value)` to be wrapped in a
/// JSON-RPC `result`, or `Err((code, message))` to be wrapped in
/// `error`. JSON-RPC error codes:
///   -32601 method not found, -32602 invalid params, -32603 internal.
async fn dispatch(state: &McpState, method: &str, params: &Value) -> Result<Value, (i32, String)> {
    match method {
        // Capabilities advertise ONLY what we actually serve. Earlier
        // draft included `resources: {}` and `prompts: {}` "for forward
        // compat", but the MCP spec treats key-presence as
        // capability-supported — so Hermes saw two empty capabilities
        // and auto-injected 3 phantom client tools (`list_prompts`,
        // `get_prompt`, `list_resources`) into every chat completion
        // prompt. Each adds ~100+ tokens for zero user benefit. Drop
        // them; we'll add `resources`/`prompts` keys back the day we
        // genuinely implement those features.
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {},
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
