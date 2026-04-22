//! IPC surface for "where does this app keep its stuff on disk?". Backs
//! the Settings → Storage section so users can locate their config, DB,
//! and changelog for backup or manual cleanup without guessing Tauri's
//! platform-specific path conventions.
//!
//! All paths are resolved once at startup (`lib.rs::setup`) and cached
//! on `AppState`; this module just projects them to strings.

use serde::Serialize;
use tauri::State;

use crate::error::IpcResult;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AppPaths {
    /// Directory holding `gateway.json`. Platform-native
    /// (`~/Library/Application Support/com.caduceus.app` on macOS,
    /// `%APPDATA%\com.caduceus.app` on Windows, `~/.config/com.caduceus.app`
    /// on Linux).
    pub config_dir: String,
    /// Directory holding `caduceus.db` + `changelog.jsonl`.
    pub data_dir: String,
    /// Absolute path to the SQLite DB. Surfaced separately because it's
    /// the single most-asked-for path ("where's my chat history?").
    pub db_path: String,
    /// Absolute path to the mutation journal.
    pub changelog_path: String,
}

/// Return the set of platform-native paths the app is using. Pure read
/// from `AppState` — no I/O, always succeeds.
#[tauri::command]
pub async fn app_paths(state: State<'_, AppState>) -> IpcResult<AppPaths> {
    Ok(AppPaths {
        config_dir: state.config_dir.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        db_path: state.db_path.display().to_string(),
        changelog_path: state.changelog_path.display().to_string(),
    })
}
