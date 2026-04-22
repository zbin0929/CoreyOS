//! IPC bridge for the SQLite persistence layer (`src/db.rs`). The frontend
//! calls `db_load_all` once on startup to hydrate zustand, then fires the
//! upsert/delete commands on every store mutation. All handlers are `async`
//! but the underlying `rusqlite::Connection` is sync — we wrap each call in
//! `spawn_blocking` to avoid stalling the Tokio runtime.

use std::sync::Arc;

use tauri::State;

use crate::db::{AnalyticsSummary, Db, MessageRow, SessionRow, SessionWithMessages, ToolCallRow};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

fn db_of(state: &AppState) -> IpcResult<Arc<Db>> {
    state.db.clone().ok_or_else(|| IpcError::NotConfigured {
        hint: "database not initialized".into(),
    })
}

#[tauri::command]
pub async fn db_load_all(state: State<'_, AppState>) -> IpcResult<Vec<SessionWithMessages>> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.load_all())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db load_all: {e}"),
        })
}

#[tauri::command]
pub async fn db_session_upsert(state: State<'_, AppState>, session: SessionRow) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.upsert_session(&session))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db upsert_session: {e}"),
        })
}

#[tauri::command]
pub async fn db_session_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.delete_session(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db delete_session: {e}"),
        })
}

#[tauri::command]
pub async fn db_message_upsert(state: State<'_, AppState>, message: MessageRow) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.upsert_message(&message))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db upsert_message: {e}"),
        })
}

/// Stamp token usage onto an already-upserted message. Called from the
/// streaming `onDone` callback so the totals in Analytics reflect real
/// provider-reported usage, not an estimate.
#[tauri::command]
pub async fn db_message_set_usage(
    state: State<'_, AppState>,
    message_id: String,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || {
        db.set_message_usage(&message_id, prompt_tokens, completion_tokens)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("db task join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("db set_message_usage: {e}"),
    })
}

#[tauri::command]
pub async fn db_tool_call_append(state: State<'_, AppState>, call: ToolCallRow) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.append_tool_call(&call))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db append_tool_call: {e}"),
        })
}

#[tauri::command]
pub async fn analytics_summary(state: State<'_, AppState>) -> IpcResult<AnalyticsSummary> {
    let db = db_of(&state)?;
    // Snapshot the wall clock on the Tokio thread so the blocking closure
    // stays deterministic / testable.
    let now_ms = chrono::Utc::now().timestamp_millis();
    tokio::task::spawn_blocking(move || db.analytics_summary(now_ms))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("analytics task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("analytics query: {e}"),
        })
}
