//! IPC surface for the LLM profile library.
//!
//! CRUD around `<app_config_dir>/llm_profiles.json`. Unlike
//! `hermes_instances`, profiles don't register themselves with the
//! adapter registry — they're plain data referenced by agents
//! (HermesInstance rows) via `llm_profile_id`.
//!
//! Mutations validate id / base_url / model before persisting so
//! a frontend bug can't land a corrupt row on disk.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::llm_profiles::{self, LlmProfile};
use crate::state::AppState;

/// Wrapper so we can add fields (e.g. `defaults_id`) later without
/// breaking the TS binding.
#[derive(Debug, Serialize, Deserialize)]
pub struct LlmProfilesFile {
    pub profiles: Vec<LlmProfile>,
}

#[tauri::command]
pub async fn llm_profile_list(state: State<'_, AppState>) -> IpcResult<LlmProfilesFile> {
    let dir = state.config_dir.clone();
    let profiles = tokio::task::spawn_blocking(move || llm_profiles::load(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("llm_profile_list join: {e}"),
        })?;
    Ok(LlmProfilesFile { profiles })
}

#[tauri::command]
pub async fn llm_profile_upsert(
    state: State<'_, AppState>,
    profile: LlmProfile,
) -> IpcResult<LlmProfile> {
    let id = profile.id.trim().to_string();
    llm_profiles::validate_id(&id).map_err(|e| IpcError::NotConfigured { hint: e })?;
    let base_url = profile.base_url.trim_end_matches('/').to_string();
    llm_profiles::validate_base_url(&base_url)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;
    llm_profiles::validate_model(&profile.model)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;

    let normalised = LlmProfile {
        id: id.clone(),
        label: if profile.label.trim().is_empty() {
            id.clone()
        } else {
            profile.label.trim().to_string()
        },
        provider: profile.provider.trim().to_string(),
        base_url,
        model: profile.model.trim().to_string(),
        api_key_env: profile
            .api_key_env
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    let dir = state.config_dir.clone();
    let to_save = normalised.clone();
    let saved = tokio::task::spawn_blocking(move || -> IpcResult<LlmProfile> {
        let list = llm_profiles::load(&dir);
        let list = llm_profiles::upsert(list, to_save.clone());
        llm_profiles::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save llm_profiles: {e}"),
        })?;
        Ok(to_save)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("llm_profile_upsert join: {e}"),
    })??;

    tracing::info!(id = %saved.id, provider = %saved.provider, model = %saved.model, "llm profile upserted");
    Ok(saved)
}

#[tauri::command]
pub async fn llm_profile_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let id_norm = id.trim().to_string();
    llm_profiles::validate_id(&id_norm).map_err(|e| IpcError::NotConfigured { hint: e })?;

    let dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let list = llm_profiles::load(&dir);
        let (list, removed) = llm_profiles::delete(list, &id_norm);
        if !removed {
            return Err(IpcError::NotConfigured {
                hint: format!("no llm profile with id {id_norm:?}"),
            });
        }
        llm_profiles::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save llm_profiles: {e}"),
        })?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("llm_profile_delete join: {e}"),
    })??;

    Ok(())
}
