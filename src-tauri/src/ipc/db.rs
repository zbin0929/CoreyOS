//! IPC bridge for the SQLite persistence layer (`src/db.rs`). The frontend
//! calls `db_load_all` once on startup to hydrate zustand, then fires the
//! upsert/delete commands on every store mutation. All handlers are `async`
//! but the underlying `rusqlite::Connection` is sync — we wrap each call in
//! `spawn_blocking` to avoid stalling the Tokio runtime.

use std::sync::Arc;

use tauri::State;

use crate::db::{
    AnalyticsSummary, AttachmentRow, CostBreakdown, Db, LatencyStats, MessageRow, SessionRow,
    SessionWithMessages, ToolCallRow,
};
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

/// T6.1 — stamp or clear a 👍/👎 rating on an assistant message.
/// Pass `feedback = None` to clear. Invalid values (anything other than
/// "up"/"down"/null) surface as an IPC error so the UI can show a toast.
#[tauri::command]
pub async fn db_message_set_feedback(
    state: State<'_, AppState>,
    message_id: String,
    feedback: Option<String>,
) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.set_message_feedback(&message_id, feedback.as_deref()))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db set_message_feedback: {e}"),
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

/// T1.5 — insert an attachment row. The frontend has already staged the
/// file on disk via `attachment_stage_blob` / `attachment_stage_path`; this
/// call records the association with a message. Duplicate ids are a bug
/// (uuid collision is astronomically unlikely), so we surface the SQL
/// error instead of silently upserting.
#[tauri::command]
pub async fn db_attachment_insert(
    state: State<'_, AppState>,
    attachment: AttachmentRow,
) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.insert_attachment(&attachment))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db insert_attachment: {e}"),
        })
}

/// Delete the DB row for an attachment. The on-disk file is removed
/// separately by `attachment_delete` (the two calls can fail
/// independently, and we prefer the frontend to sequence them rather than
/// coupling the failure modes here).
#[tauri::command]
pub async fn db_attachment_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.delete_attachment(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db delete_attachment: {e}"),
        })
}

#[tauri::command]
pub async fn analytics_summary(
    days: Option<i64>,
    state: State<'_, AppState>,
) -> IpcResult<AnalyticsSummary> {
    let db = db_of(&state)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    tokio::task::spawn_blocking(move || db.analytics_summary(now_ms, days))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("analytics task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("analytics query: {e}"),
        })
}

#[tauri::command]
pub async fn analytics_cost_breakdown(
    days: Option<i64>,
    state: State<'_, AppState>,
) -> IpcResult<CostBreakdown> {
    let db = db_of(&state)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    tokio::task::spawn_blocking(move || db.cost_breakdown(now_ms, days))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("analytics cost join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("analytics cost query: {e}"),
        })
}

#[tauri::command]
pub async fn analytics_latency_stats(
    days: Option<i64>,
    state: State<'_, AppState>,
) -> IpcResult<LatencyStats> {
    let db = db_of(&state)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    tokio::task::spawn_blocking(move || db.latency_stats(now_ms, days))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("analytics latency join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("analytics latency query: {e}"),
        })
}
