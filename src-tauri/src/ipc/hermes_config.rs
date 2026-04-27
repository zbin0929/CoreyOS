//! IPC for reading + writing Hermes's own `~/.hermes/config.yaml`.
//!
//! Unlike `config_*` (which manages Caduceus's `gateway.json`), these commands
//! touch the *Hermes* process's config. Changes require a gateway restart to
//! take effect — the frontend surfaces that.

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config::{self, HermesCompressionSection, HermesConfigView, HermesModelSection};
use crate::state::AppState;

#[tauri::command]
pub async fn hermes_config_read() -> IpcResult<HermesConfigView> {
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("read hermes config: {e}"),
    })
}

#[tauri::command]
pub async fn hermes_config_write_model(
    model: HermesModelSection,
    state: State<'_, AppState>,
) -> IpcResult<HermesConfigView> {
    let journal = state.changelog_path.clone();
    hermes_config::write_model(&model, Some(&journal)).map_err(|e| IpcError::Internal {
        message: format!("write hermes config: {e}"),
    })?;
    // Return the refreshed view so the UI can reconcile immediately.
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("re-read hermes config: {e}"),
    })
}

/// Write the `compression:` section in `~/.hermes/config.yaml`. Each
/// `Some(_)` field gets persisted; `None` fields are left as-is on
/// disk. Returns the refreshed view so the UI can reconcile in one
/// round-trip — same shape as `hermes_config_write_model`.
#[tauri::command]
pub async fn hermes_config_write_compression(
    compression: HermesCompressionSection,
    state: State<'_, AppState>,
) -> IpcResult<HermesConfigView> {
    let journal = state.changelog_path.clone();
    hermes_config::write_compression(&compression, Some(&journal)).map_err(|e| {
        IpcError::Internal {
            message: format!("write hermes compression: {e}"),
        }
    })?;
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("re-read hermes config: {e}"),
    })
}

/// Upsert (or delete, when `value` is empty/null) a single API-key env var
/// in `~/.hermes/.env`. Returns the refreshed view so the UI can re-check
/// `env_keys_present` without a separate read.
#[tauri::command]
pub async fn hermes_env_set_key(
    key: String,
    value: Option<String>,
    state: State<'_, AppState>,
) -> IpcResult<HermesConfigView> {
    let journal = state.changelog_path.clone();
    hermes_config::write_env_key(&key, value.as_deref(), Some(&journal)).map_err(|e| {
        IpcError::Internal {
            message: format!("write hermes env: {e}"),
        }
    })?;
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("re-read hermes config: {e}"),
    })
}

/// Shell out to `hermes gateway restart`. Blocking work is moved onto a
/// blocking thread pool so the IPC handler remains non-blocking.
#[tauri::command]
pub async fn hermes_gateway_restart() -> IpcResult<String> {
    tokio::task::spawn_blocking(hermes_config::gateway_restart)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("restart task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("restart hermes gateway: {e}"),
        })
}

/// `hermes gateway start` — launches the gateway if it's not running.
/// Used by Home's "Start gateway" button when the binary is present
/// but the /health probe is failing (most commonly on a fresh install
/// where the user hasn't started the gateway yet).
#[tauri::command]
pub async fn hermes_gateway_start() -> IpcResult<String> {
    tokio::task::spawn_blocking(hermes_config::gateway_start)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("start task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("start hermes gateway: {e}"),
        })
}

/// First-run detection: is the Hermes binary present on PATH / at
/// `~/.local/bin/hermes`? Non-blocking; returns a structured view
/// the frontend can branch on without parsing error messages.
#[tauri::command]
pub async fn hermes_detect() -> IpcResult<hermes_config::HermesDetection> {
    tokio::task::spawn_blocking(hermes_config::detect)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("detect task join: {e}"),
        })
}
