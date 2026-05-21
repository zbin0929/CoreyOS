//! IPC for Hermes profile management (`~/.hermes/profiles/*`). Thin
//! wrappers around `crate::hermes_profiles`. Every write op funnels its
//! mutation into the changelog journal via the helpers in that module,
//! so the T2.8 revert UI sees profile changes alongside model/env ones.

use tauri::State;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::{IpcError, IpcResult};
use crate::hermes_profiles as hp;
use crate::hermes_profiles_archive as hpa;
use crate::state::AppState;

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

/// Switch the Hermes active-profile pointer. Does NOT bounce the
/// gateway — the UI chains `hermes_gateway_restart` after a successful
/// activation when the user has opted into that in the confirm dialog.
#[tauri::command]
pub async fn hermes_profile_activate(
    state: State<'_, AppState>,
    name: String,
) -> IpcResult<hp::ProfileInfo> {
    let changelog = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || hp::activate_profile(&name, Some(&changelog)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile activate join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile activate: {e}"),
        })
}

// ─────────────────────── tar.gz import / export ───────────────────────
//
// Export returns base64-encoded bytes so the frontend can `atob` them
// into a `Blob` and trigger a `<a download>` without touching Tauri's
// file-dialog plugin. Import accepts base64 from a plain
// `<input type="file">` + `FileReader`. Keeps the dependency surface
// flat and the download/upload UX identical to the browser's native
// flow.

/// Export request payload. Only the name; everything else (manifest
/// version, exporter tag) is computed in the archive module.
#[derive(Debug, serde::Deserialize)]
pub struct ProfileExportArgs {
    pub name: String,
}

/// Response shape for `hermes_profile_export`. The bytes are
/// base64-encoded for transport; the frontend decodes with `atob`
/// before stuffing them into a `Blob`. Size is reported separately so
/// a future UI can show an "exporting… (4.2 MB)" toast without decoding.
#[derive(Debug, serde::Serialize)]
pub struct ProfileExportResponse {
    pub name: String,
    pub bytes_base64: String,
    pub raw_size: usize,
}

#[tauri::command]
pub async fn hermes_profile_export(
    args: ProfileExportArgs,
    state: State<'_, AppState>,
) -> IpcResult<ProfileExportResponse> {
    let _ = state; // no journaling: an export is a read, not a mutation.
    let name_for_response = args.name.clone();
    let bytes = tokio::task::spawn_blocking(move || hpa::export_profile(&args.name))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile export join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile export: {e}"),
        })?;
    let raw_size = bytes.len();
    Ok(ProfileExportResponse {
        name: name_for_response,
        bytes_base64: STANDARD.encode(&bytes),
        raw_size,
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct ProfileImportPreviewArgs {
    /// Base64-encoded `.tar.gz` payload.
    pub bytes_base64: String,
}

#[tauri::command]
pub async fn hermes_profile_import_preview(
    args: ProfileImportPreviewArgs,
    state: State<'_, AppState>,
) -> IpcResult<hpa::ImportPreview> {
    let _ = state;
    let bytes = STANDARD
        .decode(args.bytes_base64.as_bytes())
        .map_err(|e| IpcError::Internal {
            message: format!("profile import preview: base64 decode failed: {e}"),
        })?;
    tokio::task::spawn_blocking(move || hpa::preview_import(&bytes))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("profile import preview join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("profile import preview: {e}"),
        })
}

#[derive(Debug, serde::Deserialize)]
pub struct ProfileImportArgs {
    /// Base64-encoded `.tar.gz` payload.
    pub bytes_base64: String,
    /// Optional override of the archive's manifest name. `None` keeps
    /// whatever the exporter wrote.
    #[serde(default)]
    pub target_name: Option<String>,
    /// Set to `true` after the user has confirmed replacing an
    /// existing profile of the same name.
    #[serde(default)]
    pub overwrite: bool,
}

#[tauri::command]
pub async fn hermes_profile_import(
    args: ProfileImportArgs,
    state: State<'_, AppState>,
) -> IpcResult<hpa::ImportResult> {
    let changelog = state.changelog_path.clone();
    let bytes = STANDARD
        .decode(args.bytes_base64.as_bytes())
        .map_err(|e| IpcError::Internal {
            message: format!("profile import: base64 decode failed: {e}"),
        })?;
    let target_name = args.target_name.clone();
    let overwrite = args.overwrite;
    tokio::task::spawn_blocking(move || {
        hpa::import_profile(&bytes, target_name.as_deref(), overwrite, Some(&changelog))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("profile import join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("profile import: {e}"),
    })
}

/// Profile detail info including SOUL content.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProfileDetail {
    pub name: String,
    pub soul_content: Option<String>,
    pub model: Option<String>,
    pub skills_count: usize,
}

/// Get detailed info for a profile (SOUL content, model, skills count).
#[tauri::command]
pub async fn hermes_profile_detail(name: String) -> IpcResult<ProfileDetail> {
    use std::fs;
    use crate::paths::hermes_data_dir;

    let hermes_dir = hermes_data_dir().map_err(|e| IpcError::Internal {
        message: format!("hermes dir: {e}"),
    })?;

    let profile_dir = hermes_dir.join("profiles").join(&name);
    if !profile_dir.exists() {
        return Err(IpcError::Internal {
            message: format!("Profile not found: {name}"),
        });
    }

    // Read SOUL.md
    let soul_path = profile_dir.join("SOUL.md");
    let soul_content = fs::read_to_string(&soul_path).ok();

    // Read model from config.yaml
    let config_path = profile_dir.join("config.yaml");
    let model = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| {
                // Simple extraction: look for "model:" line
                content.lines()
                    .find(|line| line.trim().starts_with("model:"))
                    .map(|line| line.trim().strip_prefix("model:").unwrap_or("").trim().to_string())
            })
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    // Count skills
    let skills_dir = profile_dir.join("skills");
    let skills_count = if skills_dir.exists() {
        fs::read_dir(&skills_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };

    Ok(ProfileDetail {
        name,
        soul_content,
        model,
        skills_count,
    })
}
