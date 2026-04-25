//! IPC surface for the LLM profile library.
//!
//! CRUD around `<app_config_dir>/llm_profiles.json`. Unlike
//! `hermes_instances`, profiles don't register themselves with the
//! adapter registry — they're plain data referenced by agents
//! (HermesInstance rows) via `llm_profile_id`.
//!
//! Mutations validate id / base_url / model before persisting so
//! a frontend bug can't land a corrupt row on disk.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::adapters::hermes::HermesAdapter;
use crate::error::{IpcError, IpcResult};
use crate::llm_profiles::{self, LlmProfile};
use crate::state::AppState;

/// Adapter id under which we register a Profile-backed Hermes adapter.
/// Namespaced with `profile:` to keep it separate from user-created
/// Hermes Instances (`hermes:<id>`), avoiding any chance of collision
/// between an instance id and a profile id that happen to share a slug.
fn profile_adapter_id(profile_id: &str) -> String {
    format!("hermes:profile:{profile_id}")
}

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
    llm_profiles::validate_base_url(&base_url).map_err(|e| IpcError::NotConfigured { hint: e })?;
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
        vision: profile.vision,
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
    let id_for_task = id_norm.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let list = llm_profiles::load(&dir);
        let (list, removed) = llm_profiles::delete(list, &id_for_task);
        if !removed {
            return Err(IpcError::NotConfigured {
                hint: format!("no llm profile with id {id_for_task:?}"),
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

    // Also unregister any Profile-backed adapter that may have been
    // created via `llm_profile_ensure_adapter`. Silently no-ops when
    // nothing's registered under that id.
    state.adapters.unregister(&profile_adapter_id(&id_norm));

    Ok(())
}

/// Result of materialising an `LlmProfile` as a live chat-capable
/// adapter. Returned to the frontend so it can pin the session to the
/// right `adapter_id` and `model` in a single round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProfileAdapterInfo {
    /// `hermes:profile:<profile_id>`. Stable across re-calls — the
    /// registry performs an insert-or-replace keyed on this id.
    pub adapter_id: String,
    /// The profile's `model` — what the session should pin as the
    /// default turn model so the composer ships the right field
    /// upstream.
    pub model: String,
    /// UI label (profile.label, falling back to its id).
    pub label: String,
}

/// Register the given `LlmProfile` as an in-memory Hermes adapter so
/// the Chat page can route turns to it without the user first having
/// to hand-create a matching Hermes Instance. Idempotent: calling
/// twice with the same id simply hot-swaps the existing adapter with
/// a fresh one built from the current profile contents (picks up key
/// rotations or base_url edits).
///
/// The registration is NOT persisted to `hermes_instances.json` — we
/// rebuild it on every app boot by iterating `llm_profiles.json`
/// (see `lib.rs`), so the adapter slot stays in sync with the profile
/// on disk and deleting the profile reliably removes the adapter.
#[tauri::command]
pub async fn llm_profile_ensure_adapter(
    state: State<'_, AppState>,
    profile_id: String,
) -> IpcResult<LlmProfileAdapterInfo> {
    let id = profile_id.trim().to_string();
    llm_profiles::validate_id(&id).map_err(|e| IpcError::NotConfigured { hint: e })?;

    let dir = state.config_dir.clone();
    let id_for_load = id.clone();
    let profile = tokio::task::spawn_blocking(move || {
        llm_profiles::load(&dir)
            .into_iter()
            .find(|p| p.id == id_for_load)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("llm_profile_ensure_adapter join: {e}"),
    })?
    .ok_or_else(|| IpcError::NotConfigured {
        hint: format!("no llm profile with id {id:?}"),
    })?;

    // Resolve the API key value from ~/.hermes/.env if the profile
    // references one. Missing env entries are NOT fatal — we register
    // the adapter anyway and let the upstream 401 bubble up at chat
    // time so the user sees the actual error.
    let api_key = match profile.api_key_env.as_deref().filter(|k| !k.is_empty()) {
        Some(env_name) => {
            crate::hermes_config::read_env_value(env_name).map_err(|e| IpcError::Internal {
                message: format!("read env for profile adapter: {e}"),
            })?
        }
        None => None,
    };

    let adapter = HermesAdapter::new_live(
        profile.base_url.clone(),
        api_key,
        Some(profile.model.clone()),
    )?;

    let adapter_id = profile_adapter_id(&profile.id);
    let label = if profile.label.trim().is_empty() {
        profile.id.clone()
    } else {
        profile.label.clone()
    };
    state.adapters.register_with_id_and_label(
        adapter_id.clone(),
        format!("LLM · {label}"),
        Arc::new(adapter),
    );

    tracing::info!(
        profile_id = %profile.id,
        adapter_id = %adapter_id,
        base_url = %profile.base_url,
        "llm profile registered as adapter"
    );

    Ok(LlmProfileAdapterInfo {
        adapter_id,
        model: profile.model,
        label,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct VisionProbeResult {
    pub profile_id: String,
    pub vision: bool,
    pub model_id: String,
}

#[tauri::command]
pub async fn llm_profile_probe_vision(
    state: State<'_, AppState>,
    profile_id: String,
) -> IpcResult<VisionProbeResult> {
    let dir = state.config_dir.clone();
    let id = profile_id.trim().to_string();
    let id_for_err = id.clone();
    let profile = tokio::task::spawn_blocking(move || {
        llm_profiles::load(&dir).into_iter().find(|p| p.id == id)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("probe_vision join: {e}"),
    })?
    .ok_or_else(|| IpcError::NotConfigured {
        hint: format!("no llm profile {id_for_err:?}"),
    })?;

    let url = format!("{}/v1/models", profile.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| IpcError::Internal {
            message: format!("build client: {e}"),
        })?;

    let api_key = profile
        .api_key_env
        .as_deref()
        .and_then(|k| crate::hermes_config::read_env_value(k).ok().flatten());
    let mut req = client.get(&url);
    if let Some(ref key) = api_key {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    let resp = req.send().await;

    let vision = match resp {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            let model_lower = profile.model.to_lowercase();
            body.get("data")
                .and_then(|d| d.as_array())
                .map(|models| {
                    let model_ids: Vec<&str> = models
                        .iter()
                        .filter_map(|m| m.get("id").and_then(|i| i.as_str()))
                        .collect();
                    model_ids.iter().any(|m| {
                        let m_lower = m.to_lowercase();
                        m_lower == model_lower
                            && (m_lower.contains("vision")
                                || m_lower.contains("gpt-4o")
                                || m_lower.contains("gpt-4-turbo")
                                || m_lower.contains("claude-3")
                                || m_lower.contains("gemini")
                                || m_lower.contains("qwen-vl")
                                || m_lower.contains("glm-4v"))
                    })
                })
                .unwrap_or(false)
        }
        _ => false,
    };

    let dir2 = state.config_dir.clone();
    let pid = profile.id.clone();
    let model = profile.model.clone();
    tokio::task::spawn_blocking(move || {
        let mut list = llm_profiles::load(&dir2);
        if let Some(p) = list.iter_mut().find(|p| p.id == pid) {
            p.vision = Some(vision);
            let _ = llm_profiles::save(&dir2, &list);
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("save vision: {e}"),
    })?;

    Ok(VisionProbeResult {
        profile_id: profile.id,
        vision,
        model_id: model,
    })
}
