use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::adapters::hermes::gateway::ChatStreamEvent;
use crate::adapters::{AgentAdapter, ChatMessageDto, ChatTurn};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

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

    let turn = ChatTurn {
        messages: args.messages,
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
            }
        }
    });

    let turn = ChatTurn {
        messages: args.messages,
        model: args.model,
        cwd: args.cwd,
        model_supports_vision: args.model_supports_vision,
    };
    let done_event = format!("chat:done:{handle}");
    let err_event = format!("chat:error:{handle}");
    let handle_out = handle.clone();

    tokio::spawn(async move {
        match adapter.chat_stream(turn, tx).await {
            Ok(done) => {
                let _ = app.emit(&done_event, done);
            }
            Err(e) => {
                let ipc_err: IpcError = e.into();
                let _ = app.emit(&err_event, ipc_err);
            }
        }
    });

    Ok(handle_out)
}
