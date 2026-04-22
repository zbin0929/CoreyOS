//! Phase 4 · T4.6 — Runbooks IPC.
//!
//! Thin CRUD over the `runbooks` table in the local SQLite store. The
//! frontend owns template rendering (simple `{{param}}` substitution) and
//! launches the rendered prompt into the Chat composer — there's no
//! backend-side execution. Keeps the surface small: 3 commands, all
//! `spawn_blocking`-wrapped for Tokio friendliness.

use std::sync::Arc;

use tauri::State;

use crate::db::{Db, RunbookRow};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

fn db_of(state: &AppState) -> IpcResult<Arc<Db>> {
    state.db.clone().ok_or_else(|| IpcError::NotConfigured {
        hint: "database not initialized".into(),
    })
}

#[tauri::command]
pub async fn runbook_list(state: State<'_, AppState>) -> IpcResult<Vec<RunbookRow>> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.list_runbooks())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db list_runbooks: {e}"),
        })
}

#[tauri::command]
pub async fn runbook_upsert(state: State<'_, AppState>, runbook: RunbookRow) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.upsert_runbook(&runbook))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db upsert_runbook: {e}"),
        })
}

#[tauri::command]
pub async fn runbook_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.delete_runbook(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db delete_runbook: {e}"),
        })
}
