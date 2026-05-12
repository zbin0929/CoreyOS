//! Guard-prompt bridge — lets `file-ops-guard.py` route its
//! user-confirmation dialog through the CoreyOS desktop app instead
//! of spawning `osascript` / PowerShell system popups.
//!
//! ```
//!  guard block()                          CoreyOS desktop
//!    │                                      │
//!    ├─ POST /guard/prompt {reason,id} ──►  │
//!    │                                      ├─ emit "guard:prompt:request"
//!    │                                      ├─ show GuardConfirmModal in chat
//!    │  ◄── {allowed:true/false} ────────────┤  (user clicked)
//!    │                                      │
//!    ├─ return 200 {allowed} ──────────────►│
//! ```
//!
//! If the app isn't running, the POST gets connection-refused and the
//! guard falls back to its native osascript/PowerShell dialog.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex, OnceCell};
use tracing::{info, warn};

#[derive(Debug, Clone, Deserialize)]
pub struct GuardPromptRequest {
    pub reason: String,
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuardPromptResponse {
    pub allowed: bool,
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

#[derive(Clone)]
pub struct GuardState {
    pending: PendingMap,
    app: AppHandle,
}

impl GuardState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            app,
        }
    }
}

static GUARD_STATE: OnceCell<GuardState> = OnceCell::const_new();

pub fn set_guard_state(state: GuardState) {
    let _ = GUARD_STATE.set(state);
}

#[allow(dead_code)]
pub fn get_guard_state() -> Option<&'static GuardState> {
    GUARD_STATE.get()
}

const GUARD_PROMPT_TIMEOUT: Duration = Duration::from_secs(130);

pub async fn handle_guard_prompt(
    State(state): State<GuardState>,
    Json(req): Json<GuardPromptRequest>,
) -> Result<Json<GuardPromptResponse>, StatusCode> {
    let id = if req.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        req.id.clone()
    };

    info!(%id, reason = %req.reason, "guard/prompt: received");

    let (tx, rx) = oneshot::channel::<bool>();
    {
        let mut map = state.pending.lock().await;
        if map.contains_key(&id) {
            warn!(%id, "guard/prompt: duplicate id");
            return Err(StatusCode::CONFLICT);
        }
        map.insert(id.clone(), tx);
    }

    let _ = state.app.emit(
        "guard:prompt:request",
        GuardPromptEvent {
            id: id.clone(),
            reason: req.reason,
        },
    );

    let result = tokio::time::timeout(GUARD_PROMPT_TIMEOUT, rx).await;
    {
        let mut map = state.pending.lock().await;
        map.remove(&id);
    }

    match result {
        Ok(Ok(allowed)) => {
            info!(%id, allowed, "guard/prompt: resolved");
            Ok(Json(GuardPromptResponse { allowed }))
        }
        Ok(Err(_)) => {
            warn!(%id, "guard/prompt: channel closed");
            Ok(Json(GuardPromptResponse { allowed: false }))
        }
        Err(_) => {
            warn!(%id, "guard/prompt: timed out");
            Ok(Json(GuardPromptResponse { allowed: false }))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GuardPromptEvent {
    pub id: String,
    pub reason: String,
}

pub async fn resolve_guard_prompt(id: &str, allowed: bool) -> Result<(), String> {
    let state = GUARD_STATE
        .get()
        .ok_or_else(|| "guard bridge not initialised".to_string())?;
    let mut map = state.pending.lock().await;
    if let Some(tx) = map.remove(id) {
        let _ = tx.send(allowed);
        info!(%id, allowed, "guard/prompt: resolved via IPC");
        Ok(())
    } else {
        Err(format!("no pending guard prompt with id={id}"))
    }
}
