//! IPC for Hermes profile management (`~/.hermes/profiles/*`). Thin
//! wrappers around `crate::hermes_profiles`. Every write op funnels its
//! mutation into the changelog journal via the helpers in that module,
//! so the T2.8 revert UI sees profile changes alongside model/env ones.

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_profiles as hp;
use crate::state::AppState;

fn wrap<T, F>(state: &AppState, op: &'static str, f: F) -> IpcResult<T>
where
    F: FnOnce() -> std::io::Result<T>,
{
    let _ = state; // reserved for future plumbing
    f().map_err(|e| IpcError::Internal {
        message: format!("{op}: {e}"),
    })
}

#[tauri::command]
pub async fn hermes_profile_list(state: State<'_, AppState>) -> IpcResult<hp::ProfilesView> {
    let state = state.inner();
    let _ = state;
    tokio::task::spawn_blocking(hp::list_profiles)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile list join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile list: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_profile_create(
    state: State<'_, AppState>,
    name: String,
) -> IpcResult<hp::ProfileInfo> {
    let changelog = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || hp::create_profile(&name, Some(&changelog)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile create join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile create: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_profile_rename(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> IpcResult<()> {
    let changelog = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || hp::rename_profile(&from, &to, Some(&changelog)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile rename join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile rename: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_profile_delete(state: State<'_, AppState>, name: String) -> IpcResult<()> {
    let changelog = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || hp::delete_profile(&name, Some(&changelog)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile delete join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile delete: {e}"),
        })
}

#[tauri::command]
pub async fn hermes_profile_clone(
    state: State<'_, AppState>,
    src: String,
    dst: String,
) -> IpcResult<hp::ProfileInfo> {
    let changelog = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || hp::clone_profile(&src, &dst, Some(&changelog)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile clone join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile clone: {e}"),
        })
}

// Silence the unused-helper warning when other wrappers don't use it
// yet; keep the helper in case a non-changelog op needs it later.
#[allow(dead_code)]
fn _force_use(s: &AppState) {
    let _ = wrap(s, "noop", || Ok::<(), std::io::Error>(()));
}
