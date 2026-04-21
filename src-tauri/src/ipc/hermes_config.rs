//! IPC for reading + writing Hermes's own `~/.hermes/config.yaml`.
//!
//! Unlike `config_*` (which manages Caduceus's `gateway.json`), these commands
//! touch the *Hermes* process's config. Changes require a gateway restart to
//! take effect — the frontend surfaces that.

use crate::error::{IpcError, IpcResult};
use crate::hermes_config::{self, HermesConfigView, HermesModelSection};

#[tauri::command]
pub async fn hermes_config_read() -> IpcResult<HermesConfigView> {
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("read hermes config: {e}"),
    })
}

#[tauri::command]
pub async fn hermes_config_write_model(model: HermesModelSection) -> IpcResult<HermesConfigView> {
    hermes_config::write_model(&model).map_err(|e| IpcError::Internal {
        message: format!("write hermes config: {e}"),
    })?;
    // Return the refreshed view so the UI can reconcile immediately.
    hermes_config::read_view().map_err(|e| IpcError::Internal {
        message: format!("re-read hermes config: {e}"),
    })
}

/// Upsert (or delete, when `value` is empty/null) a single API-key env var
/// in `~/.hermes/.env`. Returns the refreshed view so the UI can re-check
/// `env_keys_present` without a separate read.
#[tauri::command]
pub async fn hermes_env_set_key(key: String, value: Option<String>) -> IpcResult<HermesConfigView> {
    hermes_config::write_env_key(&key, value.as_deref()).map_err(|e| IpcError::Internal {
        message: format!("write hermes env: {e}"),
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
