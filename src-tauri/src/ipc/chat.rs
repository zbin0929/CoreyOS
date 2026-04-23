use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::adapters::hermes::gateway::ChatStreamEvent;
use crate::adapters::{ChatMessageDto, ChatTurn};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ChatSendArgs {
    /// Full conversation history so far. Frontend is source of truth for
    /// Sprint 1; sessions + server-side history land in Sprint 2.
    pub messages: Vec<ChatMessageDto>,
    /// Optional model override; if `None`, the adapter's default model is used.
    #[serde(default)]
    pub model: Option<String>,
    /// T5.1 — optional working directory for code-centric adapters
    /// (Claude Code / Aider). Hermes ignores it.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatSendReply {
    pub content: String,
}

/// Phase 1 Sprint 1 non-streaming send. Calls the default adapter's
/// `chat_once`. Streaming (`chat:delta:{handle}` events) lands in Sprint 2.
#[tauri::command]
pub async fn chat_send(state: State<'_, AppState>, args: ChatSendArgs) -> IpcResult<ChatSendReply> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;

    let turn = ChatTurn {
        messages: args.messages,
        model: args.model,
        cwd: args.cwd,
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
    /// Optional caller-supplied handle so the frontend can attach listeners
    /// *before* this call, eliminating the "first delta before listener
    /// registered" race. If omitted, Rust generates one.
    #[serde(default)]
    pub handle: Option<String>,
    /// T5.1 — working directory for code-centric adapters.
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Kick off a streaming completion. Returns the handle used to scope events:
///
/// - `chat:delta:{handle}` — payload is the delta string
/// - `chat:done:{handle}`  — payload is a `ChatStreamDone` summary
/// - `chat:error:{handle}` — payload is the serialized `IpcError`
#[tauri::command]
pub async fn chat_stream_start(
    app: AppHandle,
    state: State<'_, AppState>,
    args: ChatStreamArgs,
) -> IpcResult<String> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;

    let handle = args.handle.unwrap_or_else(|| Uuid::new_v4().to_string());

    // Channel: gateway → pump → frontend. Buffer small; backpressure is fine.
    let (tx, mut rx) = mpsc::channel::<ChatStreamEvent>(64);

    // Pump: relay deltas + tool events on distinct Tauri events. Exits when
    // `tx` is dropped (i.e. stream ends).
    let delta_event = format!("chat:delta:{handle}");
    let tool_event = format!("chat:tool:{handle}");
    let pump_app = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                ChatStreamEvent::Delta(text) => {
                    let _ = pump_app.emit(&delta_event, text);
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
