//! IPC for reading + writing Hermes's own `~/.hermes/config.yaml`.
//!
//! Unlike `config_*` (which manages Caduceus's `gateway.json`), these commands
//! touch the *Hermes* process's config. Changes require a gateway restart to
//! take effect — the frontend surfaces that.

use tauri::{Manager, State};

use crate::error::{IpcError, IpcResult};
use crate::hermes_config::{
    self, HermesCompressionSection, HermesConfigView, HermesModelSection, HermesSecuritySection,
};
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

/// Persist `approvals.*` + `command_allowlist`. Mirrors
/// `hermes_config_write_compression`: each `Some(_)` field on
/// `security` overwrites; `None` is left as-is on disk.
/// `command_allowlist` is replaced wholesale (it's a flat list).
#[tauri::command]
pub async fn hermes_config_write_security(
    security: HermesSecuritySection,
    state: State<'_, AppState>,
) -> IpcResult<HermesConfigView> {
    let journal = state.changelog_path.clone();
    hermes_config::write_security(&security, Some(&journal)).map_err(|e| IpcError::Internal {
        message: format!("write hermes security: {e}"),
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

#[tauri::command]
pub async fn hermes_gateway_stop() -> IpcResult<String> {
    tokio::task::spawn_blocking(hermes_config::gateway_stop)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("stop task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("stop hermes gateway: {e}"),
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
/// Pre-flight check for the Hermes install: detect Python 3.11+
/// and pip. Surfaces structured "you're missing X" output so the
/// Home install card can give precise guidance instead of the
/// generic copy-paste command. Cheap (2 short subprocess calls);
/// safe to call on every Re-check click.
#[tauri::command]
pub async fn hermes_install_preflight() -> IpcResult<hermes_config::HermesInstallPreflight> {
    tokio::task::spawn_blocking(hermes_config::install_preflight)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_install_preflight join: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_detect() -> IpcResult<hermes_config::HermesDetection> {
    tokio::task::spawn_blocking(hermes_config::detect)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("detect task join: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_install(app: tauri::AppHandle) -> IpcResult<String> {
    let resource_dir = app.path().resource_dir().map_err(|e| IpcError::Internal {
        message: format!("resource_dir: {e}"),
    })?;
    tokio::task::spawn_blocking(move || hermes_config::run_bootstrap_script(&resource_dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_install join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("run bootstrap: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_update_check() -> IpcResult<hermes_config::HermesUpdateCheck> {
    tokio::task::spawn_blocking(hermes_config::hermes_update_check)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_update_check join: {e}"),
        })
}
