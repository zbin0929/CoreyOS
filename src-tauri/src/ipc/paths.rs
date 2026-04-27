//! IPC surface for "where does this app keep its stuff on disk?". Backs
//! the Settings → Storage section so users can locate their config, DB,
//! and changelog for backup or manual cleanup without guessing Tauri's
//! platform-specific path conventions.
//!
//! Also exposes the **Hermes data dir** override (`get`/`set`/`clear`)
//! so the Settings page can let users relocate `~/.hermes/` without
//! digging through env vars. See `crate::paths` for the resolver.
//!
//! All Tauri-managed paths (config_dir / data_dir / db / changelog)
//! are resolved once at startup (`lib.rs::setup`) and cached on
//! `AppState`; this module just projects them to strings.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::IpcResult;
use crate::paths;
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
    /// Currently-resolved Hermes data directory (`.hermes`). Reflects
    /// env var + user override if set, otherwise the platform default.
    pub hermes_data_dir: String,
    /// `true` when the user has a non-default data dir configured (via
    /// the override file; env vars don't count because they're not
    /// persistent). Lets the UI show a "reset to default" button.
    pub hermes_data_dir_overridden: bool,
}

/// Return the set of platform-native paths the app is using. Pure read
/// from `AppState` + `crate::paths` — no expensive I/O.
#[tauri::command]
pub async fn app_paths(state: State<'_, AppState>) -> IpcResult<AppPaths> {
    let hermes = paths::hermes_data_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let overridden = paths::has_override();
    Ok(AppPaths {
        config_dir: state.config_dir.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        db_path: state.db_path.display().to_string(),
        changelog_path: state.changelog_path.display().to_string(),
        hermes_data_dir: hermes,
        hermes_data_dir_overridden: overridden,
    })
}

#[derive(Debug, Deserialize)]
pub struct SetDataDirArgs {
    /// Absolute path the user wants to use. Empty string is rejected —
    /// use `app_data_dir_clear` to reset to default.
    pub path: String,
}

/// Persist a user-selected Hermes data dir. The path is not created
/// here; we just record the preference. Subsystems (skills,
/// hermes_config, sandbox) will materialise it on next write.
///
/// Rejects empty paths and paths that don't parse — the Settings UI
/// uses a native directory picker so these shouldn't normally arrive,
/// but the IPC surface stays defensive anyway.
#[tauri::command]
pub async fn app_data_dir_set(args: SetDataDirArgs) -> IpcResult<String> {
    let trimmed = args.path.trim();
    if trimmed.is_empty() {
        return Err(crate::error::IpcError::Internal {
            message: "path is empty; use app_data_dir_clear to reset".into(),
        });
    }
    let path = PathBuf::from(trimmed);
    paths::write_override(Some(&path)).map_err(|e| crate::error::IpcError::Internal {
        message: format!("write data_dir override failed: {e}"),
    })?;
    Ok(path.display().to_string())
}

/// Clear the override and fall back to the platform default. Idempotent
/// (deleting a non-existent override is not an error).
#[tauri::command]
pub async fn app_data_dir_clear() -> IpcResult<()> {
    paths::write_override(None).map_err(|e| crate::error::IpcError::Internal {
        message: format!("clear data_dir override failed: {e}"),
    })?;
    Ok(())
}
