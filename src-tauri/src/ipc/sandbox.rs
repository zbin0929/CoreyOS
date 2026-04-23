//! Sandbox IPC — lets the frontend enumerate workspace roots, add/remove
//! them, flip to enforced mode, and resolve `SandboxConsentRequired` errors
//! by granting one-shot access or promoting a path to a full root.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::sandbox::{AccessMode, SandboxMode, WorkspaceRoot};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SandboxRootDto {
    pub path: String,
    pub label: String,
    pub mode: AccessMode,
}

impl From<WorkspaceRoot> for SandboxRootDto {
    fn from(r: WorkspaceRoot) -> Self {
        SandboxRootDto {
            path: r.path.display().to_string(),
            label: r.label,
            mode: r.mode,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SandboxStateDto {
    pub mode: SandboxMode,
    pub roots: Vec<SandboxRootDto>,
    /// Session grants (one-shot, not persisted). Useful for the Settings UI
    /// to surface what's temporarily allowed so users understand why some
    /// operations work in this session but won't on restart.
    pub session_grants: Vec<String>,
    pub config_path: String,
}

#[tauri::command]
pub async fn sandbox_get_state(state: State<'_, AppState>) -> IpcResult<SandboxStateDto> {
    let auth = &state.authority;
    Ok(SandboxStateDto {
        mode: auth.mode(),
        roots: auth.roots().into_iter().map(Into::into).collect(),
        session_grants: auth
            .session_grants()
            .into_iter()
            .map(|p| p.display().to_string())
            .collect(),
        config_path: state
            .config_dir
            .join("sandbox.json")
            .display()
            .to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct AddRootArgs {
    pub path: String,
    pub label: String,
    pub mode: AccessMode,
}

#[tauri::command]
pub async fn sandbox_add_root(
    state: State<'_, AppState>,
    args: AddRootArgs,
) -> IpcResult<SandboxRootDto> {
    let root = state
        .authority
        .add_root(WorkspaceRoot {
            path: PathBuf::from(&args.path),
            label: args.label.trim().to_string(),
            mode: args.mode,
        })
        .map_err(IpcError::from)?;
    Ok(root.into())
}

#[derive(Debug, Deserialize)]
pub struct RemoveRootArgs {
    pub path: String,
}

#[tauri::command]
pub async fn sandbox_remove_root(
    state: State<'_, AppState>,
    args: RemoveRootArgs,
) -> IpcResult<()> {
    state
        .authority
        .remove_root(std::path::Path::new(&args.path))
        .map_err(IpcError::from)
}

#[derive(Debug, Deserialize)]
pub struct GrantOnceArgs {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct GrantOnceReply {
    /// Canonicalized path actually granted — the frontend should replay
    /// the original operation with this path so symlink normalization is
    /// applied consistently.
    pub canonical: String,
}

#[tauri::command]
pub async fn sandbox_grant_once(
    state: State<'_, AppState>,
    args: GrantOnceArgs,
) -> IpcResult<GrantOnceReply> {
    let canon = state
        .authority
        .grant_once(PathBuf::from(&args.path))
        .map_err(IpcError::from)?;
    Ok(GrantOnceReply {
        canonical: canon.display().to_string(),
    })
}

#[tauri::command]
pub async fn sandbox_set_enforced(state: State<'_, AppState>) -> IpcResult<()> {
    state.authority.set_enforced();
    Ok(())
}

#[tauri::command]
pub async fn sandbox_clear_session_grants(state: State<'_, AppState>) -> IpcResult<()> {
    state.authority.clear_session_grants();
    Ok(())
}
