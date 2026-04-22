//! IPC bridge for `src/attachments.rs`.
//!
//! Three commands:
//!   - `attachment_stage_blob` — base64 body from clipboard paste or a
//!     FileReader read-as-data-url.
//!   - `attachment_stage_path` — an absolute path the user picked from
//!     the native file dialog (the frontend is responsible for the
//!     dialog itself; Tauri's `dialog` plugin isn't pulled in here).
//!   - `attachment_delete` — removes the staged file from disk. The DB
//!     row is the frontend's responsibility (separate call), keeping
//!     concerns per-resource.
//!
//! All three are `spawn_blocking`-wrapped — the core module does sync
//! file I/O and base64 decoding that could stall the Tokio runtime.

use std::path::PathBuf;

use crate::attachments::{self, StagedAttachment};
use crate::error::{IpcError, IpcResult};

fn map_anyhow(e: anyhow::Error) -> IpcError {
    IpcError::Internal {
        message: e.to_string(),
    }
}

fn map_join(e: tokio::task::JoinError) -> IpcError {
    IpcError::Internal {
        message: format!("attachment task join: {e}"),
    }
}

#[tauri::command]
pub async fn attachment_stage_blob(
    name: String,
    mime: String,
    base64_body: String,
) -> IpcResult<StagedAttachment> {
    tokio::task::spawn_blocking(move || attachments::stage_blob(&name, &mime, &base64_body))
        .await
        .map_err(map_join)?
        .map_err(map_anyhow)
}

#[tauri::command]
pub async fn attachment_stage_path(
    path: String,
    mime_hint: Option<String>,
) -> IpcResult<StagedAttachment> {
    let p = PathBuf::from(path);
    tokio::task::spawn_blocking(move || attachments::stage_path(&p, mime_hint.as_deref()))
        .await
        .map_err(map_join)?
        .map_err(map_anyhow)
}

#[tauri::command]
pub async fn attachment_delete(path: String) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || attachments::delete(&path))
        .await
        .map_err(map_join)?
        .map_err(map_anyhow)
}
