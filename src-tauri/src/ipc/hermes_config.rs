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
