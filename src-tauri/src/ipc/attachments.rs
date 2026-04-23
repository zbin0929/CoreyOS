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

use std::collections::HashSet;
use std::path::PathBuf;

use tauri::State;

use crate::attachments::{self, GcReport, StagedAttachment};
use crate::error::{IpcError, IpcResult};
use crate::sandbox::{AccessOp, DEFAULT_SCOPE_ID};
use crate::state::AppState;

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

/// T6.5 — stage a user-picked file under the given sandbox scope. The
/// sandbox check runs BEFORE the copy, so a path outside the scope's
/// roots surfaces as `SandboxConsentRequired` (UI pops the consent
/// modal) without ever reading the bytes.
///
/// `sandbox_scope_id` is optional for back-compat: `None`, empty, or
/// `"default"` all resolve to the always-present default scope. The
/// frontend typically passes the `sandbox_scope_id` of the active
/// Hermes instance, looked up once at send-time from the agent store.
///
/// The copy itself (`attachments::stage_path`) stays synchronous-plus-
/// blocking-task so the Tokio runtime doesn't stall on large files.
#[tauri::command]
pub async fn attachment_stage_path(
    state: State<'_, AppState>,
    path: String,
    mime_hint: Option<String>,
    #[allow(non_snake_case)]
    sandbox_scope_id: Option<String>,
) -> IpcResult<StagedAttachment> {
    let p = PathBuf::from(path);

    // Sandbox gate. Empty string / "default" / None all route to the
    // default scope. An unknown scope id surfaces as Internal here —
    // the UI re-fetches the scope list on any save error so stale
    // caches self-heal on the next render.
    let scope_id = match sandbox_scope_id {
        Some(ref s) if !s.is_empty() => s.clone(),
        _ => DEFAULT_SCOPE_ID.to_string(),
    };
    state
        .authority
        .check_scoped(&scope_id, &p, AccessOp::Read)
        .map_err(IpcError::from)?;

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

/// T1.5d — read a staged image and return a `data:<mime>;base64,<…>`
/// URL for an `<img>` preview in chat bubbles. Caller passes the same
/// `path` that's persisted on the attachment row so sandbox checks can
/// confirm it belongs under `~/.hermes/attachments/`.
#[tauri::command]
pub async fn attachment_preview(path: String, mime: Option<String>) -> IpcResult<String> {
    tokio::task::spawn_blocking(move || attachments::read_as_data_url(&path, mime.as_deref()))
        .await
        .map_err(map_join)?
        .map_err(map_anyhow)
}

/// T1.5e — sweep orphaned attachment files. Called at app startup from
/// the chat-store hydrate path with the set of paths the DB still
/// references; everything else under `attachments_dir` gets reaped.
#[tauri::command]
pub async fn attachment_gc(live_paths: Vec<String>) -> IpcResult<GcReport> {
    tokio::task::spawn_blocking(move || {
        let set: HashSet<PathBuf> = live_paths.into_iter().map(PathBuf::from).collect();
        attachments::gc_orphans(&set)
    })
    .await
    .map_err(map_join)?
    .map_err(map_anyhow)
}
