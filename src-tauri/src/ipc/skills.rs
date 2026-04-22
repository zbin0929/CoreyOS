//! Phase 4 · T4.2 — Skills IPC.
//!
//! Thin wrappers around `skills::` helpers. Each runs in `spawn_blocking`
//! because file I/O on the main Tokio thread would stall the app.

use crate::error::{IpcError, IpcResult};
use crate::skills::{self, SkillContent, SkillSummary};

fn err(e: anyhow::Error) -> IpcError {
    IpcError::Internal {
        message: e.to_string(),
    }
}

#[tauri::command]
pub async fn skill_list() -> IpcResult<Vec<SkillSummary>> {
    tokio::task::spawn_blocking(skills::list)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_list join: {e}"),
        })?
        .map_err(err)
}

#[tauri::command]
pub async fn skill_get(path: String) -> IpcResult<SkillContent> {
    tokio::task::spawn_blocking(move || skills::get(&path))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_get join: {e}"),
        })?
        .map_err(err)
}

#[tauri::command]
pub async fn skill_save(path: String, body: String, create_new: bool) -> IpcResult<SkillContent> {
    tokio::task::spawn_blocking(move || skills::save(&path, &body, create_new))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_save join: {e}"),
        })?
        .map_err(err)
}

#[tauri::command]
pub async fn skill_delete(path: String) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || skills::delete(&path))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_delete join: {e}"),
        })?
        .map_err(err)
}
