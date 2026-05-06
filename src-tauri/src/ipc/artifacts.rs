//! IPC for B-9.4 workflow artifacts. Three commands cover the full
//! GUI surface:
//!
//! - `artifact_list(run_id)` — enumerate files under
//!   `~/.hermes/artifacts/<run_id>/` with size + mtime
//! - `artifact_path(run_id, name)` — resolve an absolute path so the
//!   shell can open / reveal the file
//! - `artifact_write(run_id, name, content)` — write text content;
//!   exposed for power-user workflow YAMLs that want to publish
//!   structured outputs without hopping through MCP

use crate::artifacts::{self, ArtifactInfo};
use crate::error::{IpcError, IpcResult};

#[tauri::command]
pub async fn artifact_list(run_id: String) -> IpcResult<Vec<ArtifactInfo>> {
    tokio::task::spawn_blocking(move || artifacts::list_artifacts(&run_id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("artifact_list join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("list_artifacts: {e}"),
        })
}

#[tauri::command]
pub async fn artifact_path(run_id: String, name: String) -> IpcResult<String> {
    tokio::task::spawn_blocking(move || artifacts::artifact_path(&run_id, &name))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("artifact_path join: {e}"),
        })?
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| IpcError::Internal {
            message: format!("artifact_path: {e}"),
        })
}

#[tauri::command]
pub async fn artifact_write(
    run_id: String,
    name: String,
    content: String,
) -> IpcResult<ArtifactInfo> {
    tokio::task::spawn_blocking(move || {
        artifacts::write_artifact(&run_id, &name, content.as_bytes())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("artifact_write join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("write_artifact: {e}"),
    })
}
