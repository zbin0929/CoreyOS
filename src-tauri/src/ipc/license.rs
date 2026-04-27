//! License-key IPC. Three commands the frontend uses:
//!   - `license_status` — current verdict, called on app boot to
//!     decide whether to show the gate.
//!   - `license_install` — verify + persist a token the user pasted.
//!   - `license_clear` — wipe the on-disk file (Settings "Sign out").
//!
//! Each command is `spawn_blocking` because the verification touches
//! the filesystem; `verify_token` itself is fast (a single ed25519
//! check) but we don't want to block the Tauri runtime thread on a
//! slow network drive.

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::license::{self, Verdict};
use crate::state::AppState;

/// Wrapper so the frontend gets `{ verdict, dev_mode }` and can
/// short-circuit the gate on dev builds without a separate IPC.
#[derive(Debug, Serialize)]
pub struct LicenseStatusReply {
    pub verdict: Verdict,
    /// True when the binary was built in debug mode. Frontend uses
    /// this to render a "DEV BUILD — license bypassed" banner instead
    /// of the full-screen gate. Production builds always send
    /// `dev_mode: false` so the gate is enforced.
    pub dev_mode: bool,
}

#[tauri::command]
pub async fn license_status(state: State<'_, AppState>) -> IpcResult<LicenseStatusReply> {
    let dir = state.config_dir.clone();
    let verdict = tokio::task::spawn_blocking(move || license::status(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_status join: {e}"),
        })?;
    Ok(LicenseStatusReply {
        verdict,
        dev_mode: cfg!(debug_assertions),
    })
}

#[tauri::command]
pub async fn license_install(
    state: State<'_, AppState>,
    token: String,
) -> IpcResult<LicenseStatusReply> {
    let dir = state.config_dir.clone();
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(IpcError::NotConfigured {
            hint: "license token is empty".into(),
        });
    }
    let verdict = tokio::task::spawn_blocking(move || license::install(&dir, &token))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_install join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("license_install: {e}"),
        })?;
    Ok(LicenseStatusReply {
        verdict,
        dev_mode: cfg!(debug_assertions),
    })
}

/// Return this install's persistent machine id. The activation UI
/// shows it BEFORE a license is installed so the user can email /
/// IM it to the seller, who mints a license bound to that exact id.
#[tauri::command]
pub async fn license_machine_id(state: State<'_, AppState>) -> IpcResult<String> {
    let dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || license::machine_id(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_machine_id join: {e}"),
        })
}

#[tauri::command]
pub async fn license_clear(state: State<'_, AppState>) -> IpcResult<()> {
    let dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || license::clear(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("license_clear join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("license_clear: {e}"),
        })?;
    Ok(())
}
