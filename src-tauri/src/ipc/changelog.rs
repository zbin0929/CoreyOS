//! Changelog journal IPC.
//!
//! Phase 2.1 ships list-only. Revert (Phase 2.8) will be added alongside the
//! settings-level undo UI — revert dispatches by `op` back to the adapter
//! module that originally wrote.

use tauri::State;

use crate::changelog::{self, Entry};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

#[tauri::command]
pub async fn changelog_list(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> IpcResult<Vec<Entry>> {
    let lim = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let path = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || changelog::tail(&path, lim))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("changelog join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("read changelog: {e}"),
        })
}
