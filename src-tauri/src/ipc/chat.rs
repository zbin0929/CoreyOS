use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::adapters::hermes::gateway::ChatStreamEvent;
use crate::adapters::{AgentAdapter, ChatMessageDto, ChatTurn};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

static STREAM_TASKS: Lazy<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// T5.5b — resolve the adapter the UI wants this request routed to.
/// `None` means "follow the registry default", matching the pre-T5.5b
/// behaviour; an explicit id that isn't registered fails loudly so
/// stale ids in persisted frontend state don't silently fall through
/// to a different adapter.
fn pick_adapter(
    state: &AppState,
    explicit: Option<&str>,
) -> IpcResult<std::sync::Arc<dyn AgentAdapter>> {
    if let Some(id) = explicit {
        return state
            .adapters
            .get(id)
            .ok_or_else(|| IpcError::NotConfigured {
                hint: format!("adapter '{id}' is not registered"),
            });
    }
    state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })
}

#[derive(Debug, Deserialize)]
pub struct ChatSendArgs {
    pub messages: Vec<ChatMessageDto>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default)]
    pub model_supports_vision: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ChatSendReply {
    pub content: String,
}

/// Phase 1 Sprint 1 non-streaming send. Calls the default adapter's
/// `chat_once`. Streaming (`chat:delta:{handle}` events) lands in Sprint 2.
#[tauri::command]
pub async fn chat_send(state: State<'_, AppState>, args: ChatSendArgs) -> IpcResult<ChatSendReply> {
    let adapter = pick_adapter(&state, args.adapter_id.as_deref())?;

    // B: same vision proxy preprocessing as `chat_stream_start`.
    // Non-stream callers (compare lanes, agent eval) get the same
    // benefit transparently.
    let vp_cfg = crate::vision_proxy::load();
    let messages = crate::vision_proxy::expand_images_in_messages(
        &vp_cfg,
        args.messages,
        args.model_supports_vision,
    )
    .await;

    let turn = ChatTurn {
        messages,
        model: args.model,
        cwd: args.cwd,
        model_supports_vision: args.model_supports_vision,
    };
    let content = adapter.chat_once(turn).await?;
    Ok(ChatSendReply { content })
}

// ───────────────────────── Streaming ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct ChatStreamArgs {
    pub messages: Vec<ChatMessageDto>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub handle: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default)]
    pub model_supports_vision: Option<bool>,
}

/// Kick off a streaming completion. Returns the handle used to scope events:
///
/// - `chat:delta:{handle}` — payload is the content delta string
/// - `chat:reasoning:{handle}` — payload is the reasoning-content delta
///   (only emitted by reasoning-capable models like deepseek-reasoner /
///   o1; plain chat models never fire this event).
/// - `chat:tool:{handle}`  — payload is a `HermesToolProgress`
/// - `chat:done:{handle}`  — payload is a `ChatStreamDone` summary
/// - `chat:error:{handle}` — payload is the serialized `IpcError`
#[tauri::command]
pub async fn chat_stream_start(
    app: AppHandle,
    state: State<'_, AppState>,
    args: ChatStreamArgs,
) -> IpcResult<String> {
    let adapter = pick_adapter(&state, args.adapter_id.as_deref())?;

    let handle = args.handle.unwrap_or_else(|| Uuid::new_v4().to_string());

    // Channel: gateway → pump → frontend. Buffer small; backpressure is fine.
    let (tx, mut rx) = mpsc::channel::<ChatStreamEvent>(64);

    // Pump: relay deltas + tool events on distinct Tauri events. Exits when
    // `tx` is dropped (i.e. stream ends).
    let delta_event = format!("chat:delta:{handle}");
    let reasoning_event = format!("chat:reasoning:{handle}");
    let tool_event = format!("chat:tool:{handle}");
    let approval_event = format!("chat:approval:{handle}");
    let pump_app = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                ChatStreamEvent::Delta(text) => {
                    let _ = pump_app.emit(&delta_event, text);
                }
                ChatStreamEvent::Reasoning(text) => {
                    let _ = pump_app.emit(&reasoning_event, text);
                }
                ChatStreamEvent::Tool(progress) => {
                    let _ = pump_app.emit(&tool_event, progress);
                }
                ChatStreamEvent::Approval(approval) => {
                    let _ = pump_app.emit(&approval_event, approval);
                }
            }
        }
    });

    // B: vision proxy hook. If the user is on a non-vision model
    // and has a vision proxy configured, expand image attachments
    // on the latest user turn into inline text descriptions BEFORE
    // we hand the messages to the adapter. Adapter sees a
    // pre-resolved turn and never has to know about the proxy.
    //
    // Skipped synchronously when the proxy is disabled or vision
    // is supported, so non-users pay zero cost.
    let vp_cfg = crate::vision_proxy::load();
    let messages_with_vision = crate::vision_proxy::expand_images_in_messages(
        &vp_cfg,
        args.messages,
        args.model_supports_vision,
    )
    .await;

    let turn = ChatTurn {
        messages: messages_with_vision,
        model: args.model,
        cwd: args.cwd,
        model_supports_vision: args.model_supports_vision,
    };
    let done_event = format!("chat:done:{handle}");
    let err_event = format!("chat:error:{handle}");
    let handle_out = handle.clone();
    let adapter_id_log = args.adapter_id.clone().unwrap_or_default();
    let model_log = turn.model.clone().unwrap_or_default();
    let msg_count = turn.messages.len();
    let handle_log = handle_out.clone();

    let task_key = handle_out.clone();
    let stream_task = tokio::spawn(async move {
        let start = std::time::Instant::now();
        tracing::info!(
            handle = %handle_log,
            adapter = %adapter_id_log,
            model = %model_log,
            messages = msg_count,
            "chat_stream start"
        );
        match adapter.chat_stream(turn, tx).await {
            Ok(done) => {
                tracing::info!(
                    handle = %handle_log,
                    duration_ms = start.elapsed().as_millis() as u64,
                    finish_reason = ?done.finish_reason,
                    prompt_tokens = ?done.prompt_tokens,
                    completion_tokens = ?done.completion_tokens,
                    "chat_stream done"
                );
                let _ = app.emit(&done_event, done);
            }
            Err(e) => {
                tracing::warn!(
                    handle = %handle_log,
                    duration_ms = start.elapsed().as_millis() as u64,
                    error = %e,
                    "chat_stream error"
                );
                let ipc_err: IpcError = e.into();
                let _ = app.emit(&err_event, ipc_err);
            }
        }
        if let Ok(mut tasks) = STREAM_TASKS.lock() {
            tasks.remove(&task_key);
        }
    });

    if let Ok(mut tasks) = STREAM_TASKS.lock() {
        tasks.insert(handle_out.clone(), stream_task);
    }

    Ok(handle_out)
}

#[derive(Debug, Deserialize)]
pub struct ChatStreamCancelArgs {
    handle: String,
}

#[tauri::command]
pub async fn chat_stream_cancel(args: ChatStreamCancelArgs) -> IpcResult<()> {
    if let Ok(mut tasks) = STREAM_TASKS.lock() {
        if let Some(task) = tasks.remove(&args.handle) {
            task.abort();
        }
    }
    Ok(())
}

/// Args for `hermes_approval_respond`. The Hermes 0.13.0 `/v1/runs`
/// migration replaced the per-session approval queue with a per-run
/// endpoint, so the frontend now echoes back the `run_id` it received
/// on the `chat:approval` event payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRespondArgs {
    run_id: String,
    choice: String,
}

#[tauri::command]
pub async fn hermes_approval_respond(
    _app: AppHandle,
    state: State<'_, AppState>,
    args: ApprovalRespondArgs,
) -> IpcResult<serde_json::Value> {
    let base_url = {
        let cfg = state.config.read().unwrap_or_else(|e| e.into_inner());
        cfg.base_url.clone()
    };
    // `base_url` is whatever the gateway adapter is pointing at — could
    // be `http://127.0.0.1:8642` or `http://127.0.0.1:8642/v1`. Strip
    // a trailing `/v1` so we can append the canonical path uniformly.
    let trimmed = base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/');
    let url = format!("{trimmed}/v1/runs/{}/approval", args.run_id);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({"choice": args.choice}))
        .send()
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("approval respond: {e}"),
        })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(IpcError::Internal {
            message: format!("approval respond {}: {}", status.as_u16(), body),
        });
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({"ok": true}));
    Ok(body)
}
