//! Phase 4 · T4.4 — Budgets IPC.
//!
//! Storage-only CRUD. Cost projection, breach checks, and the 80%/100%
//! notifications live on the frontend — that's where the model price table
//! is anyway (we don't want to duplicate it in Rust), and the UI already
//! knows when a stream starts / finishes.
//!
//! Backend enforcement (the "block further sends" action) is deliberately
//! deferred until the frontend interceptor proves out — adding it here
//! before that signal would be speculation.

use std::sync::Arc;

use tauri::State;

use crate::db::{BudgetRow, Db};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

fn db_of(state: &AppState) -> IpcResult<Arc<Db>> {
    state.db.clone().ok_or_else(|| IpcError::NotConfigured {
        hint: "database not initialized".into(),
    })
}

#[tauri::command]
pub async fn budget_list(state: State<'_, AppState>) -> IpcResult<Vec<BudgetRow>> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.list_budgets())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db list_budgets: {e}"),
        })
}

#[tauri::command]
pub async fn budget_upsert(state: State<'_, AppState>, budget: BudgetRow) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.upsert_budget(&budget))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db upsert_budget: {e}"),
        })
}

#[tauri::command]
pub async fn budget_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.delete_budget(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db delete_budget: {e}"),
        })
}
