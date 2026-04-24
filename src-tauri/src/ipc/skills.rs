//! Phase 4 · T4.2 — Skills IPC.
//!
//! Thin wrappers around `skills::` helpers. Each runs in `spawn_blocking`
//! because file I/O on the main Tokio thread would stall the app.

use tauri::State;

use crate::db::{SkillVersion, SkillVersionSummary};
use crate::error::{IpcError, IpcResult};
use crate::skills::{self, SkillContent, SkillSummary};
use crate::state::AppState;

fn err(e: anyhow::Error) -> IpcError {
    IpcError::Internal {
        message: e.to_string(),
    }
}

#[tauri::command]
pub async fn skill_list() -> IpcResult<Vec<SkillSummary>> {
    tokio::task::spawn_blocking(skills::list)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_list join: {e}"),
        })?
        .map_err(err)
}

#[tauri::command]
pub async fn skill_get(path: String) -> IpcResult<SkillContent> {
    tokio::task::spawn_blocking(move || skills::get(&path))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_get join: {e}"),
        })?
        .map_err(err)
}

#[tauri::command]
pub async fn skill_save(
    state: State<'_, AppState>,
    path: String,
    body: String,
    create_new: bool,
) -> IpcResult<SkillContent> {
    // v9 — snapshot the PRIOR body into the version-history table
    // before overwriting. We read the old bytes from disk directly
    // (not via `skills::get`, which also returns mtime — we only need
    // the body here). A missing / unreadable file is normal on the
    // create path and shouldn't block the save; we just skip the
    // snapshot in that case.
    let db = state.db.clone();
    let prior_body: Option<String> = if create_new {
        None
    } else {
        let path_for_read = path.clone();
        tokio::task::spawn_blocking(move || skills::get(&path_for_read).ok().map(|c| c.body))
            .await
            .ok()
            .flatten()
    };

    let saved = tokio::task::spawn_blocking({
        let path = path.clone();
        let body = body.clone();
        move || skills::save(&path, &body, create_new)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("skill_save join: {e}"),
    })?
    .map_err(err)?;

    if let (Some(db), Some(prior)) = (db, prior_body) {
        // Only snapshot when the body actually changed — a no-op save
        // (user hits Cmd+S without edits) shouldn't clutter the
        // history. Also skip identical trailing-whitespace-only diffs
        // by comparing after a trim of each side; still records the
        // first real edit after that.
        if prior.trim_end() != body.trim_end() {
            let path_for_snapshot = path.clone();
            let _ = tokio::task::spawn_blocking(move || {
                // Use the old file's mtime shape — but we don't have
                // it here without another stat; use `now` which is
                // close enough (snapshot happens within ms of the
                // overwrite).
                let now = chrono::Utc::now().timestamp_millis();
                db.snapshot_skill_version(&path_for_snapshot, &prior, now)
            })
            .await;
        }
    }

    Ok(saved)
}

#[tauri::command]
pub async fn skill_delete(path: String) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || skills::delete(&path))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_delete join: {e}"),
        })?
        .map_err(err)
}

// ─────────────────── Version history (v9) ───────────────────

/// Returns the snapshot list for one skill, newest first. Used by the
/// editor's "History (N)" button.
#[tauri::command]
pub async fn skill_version_list(
    state: State<'_, AppState>,
    path: String,
) -> IpcResult<Vec<SkillVersionSummary>> {
    let Some(db) = state.db.clone() else {
        return Ok(Vec::new());
    };
    tokio::task::spawn_blocking(move || db.list_skill_versions(&path))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_version_list join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("skill_version_list: {e}"),
        })
}

/// Returns one snapshot including the stored body. Used by preview
/// (display in a side panel) and restore (feed into a regular save).
#[tauri::command]
pub async fn skill_version_get(
    state: State<'_, AppState>,
    id: i64,
) -> IpcResult<Option<SkillVersion>> {
    let Some(db) = state.db.clone() else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || db.get_skill_version(id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("skill_version_get join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("skill_version_get: {e}"),
        })
}
