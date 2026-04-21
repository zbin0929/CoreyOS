//! Phase 0 "hello disk" demo — proves the IPC pipe + sandbox + Rust fs
//! round-trip works end-to-end.
//!
//! Flow: frontend `invoke()` → Tauri IPC → `sandbox::fs::read_dir_count` →
//! `PathAuthority::check` (denylist + roots) → `tokio::fs` → back.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::sandbox::fs as sbx_fs;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct HomeStats {
    pub path: String,
    pub entry_count: usize,
    pub sandbox_mode: &'static str,
}

#[tauri::command]
pub async fn home_stats(state: State<'_, AppState>) -> IpcResult<HomeStats> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| IpcError::Internal {
            message: "HOME not set".into(),
        })?;
    let home_path = PathBuf::from(&home);

    let sandbox_mode = if state.authority.roots().is_empty() {
        "dev-allow"
    } else {
        "enforced"
    };

    let entry_count = sbx_fs::read_dir_count(&state.authority, &home_path)
        .await
        .map_err(IpcError::from)?;

    Ok(HomeStats {
        path: home,
        entry_count,
        sandbox_mode,
    })
}
