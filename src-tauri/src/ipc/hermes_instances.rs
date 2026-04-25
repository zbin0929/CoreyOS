//! T6.2 — IPC surface for named Hermes instances.
//!
//! CRUD around `<app_config_dir>/hermes_instances.json`, plus a
//! health-probe command that dry-runs a proposed `base_url + api_key`
//! without persisting. Every mutation:
//!   1. Validates id + url (surfacing violations as `IpcError`).
//!   2. Persists atomically.
//!   3. Hot-swaps the corresponding entry in `AdapterRegistry`
//!      (via `register_with_id_and_label` / `unregister`).
//!
//! Existing in-flight streams hold their own `Arc<dyn AgentAdapter>`
//! and are unaffected; new chats pick up the swap on the next turn.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::adapters::hermes::HermesAdapter;
use crate::error::{IpcError, IpcResult};
use crate::hermes_instances::{self, adapter_id_for, HermesInstance, HermesInstancesFile};
use crate::state::AppState;

/// Return the full list in the order the file stores them. Empty when
/// no file exists yet (the common case for first-run users).
#[tauri::command]
pub async fn hermes_instance_list(state: State<'_, AppState>) -> IpcResult<HermesInstancesFile> {
    let dir = state.config_dir.clone();
    let instances = tokio::task::spawn_blocking(move || hermes_instances::load(&dir))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_instance_list join: {e}"),
        })?;
    Ok(HermesInstancesFile { instances })
}

/// Upsert (match on `id`). Validates, persists, then hot-registers the
/// adapter under `hermes:{id}` with the instance's label.
#[tauri::command]
pub async fn hermes_instance_upsert(
    state: State<'_, AppState>,
    instance: HermesInstance,
) -> IpcResult<HermesInstance> {
    let id = instance.id.trim().to_string();
    hermes_instances::validate_id(&id).map_err(|e| IpcError::NotConfigured { hint: e })?;
    let base_url = instance.base_url.trim_end_matches('/').to_string();
    hermes_instances::validate_base_url(&base_url)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;

    let normalised = HermesInstance {
        id: id.clone(),
        label: if instance.label.trim().is_empty() {
            id.clone()
        } else {
            instance.label.trim().to_string()
        },
        base_url,
        api_key: instance.api_key.filter(|s| !s.is_empty()),
        default_model: instance.default_model.filter(|s| !s.is_empty()),
        // T6.5 — normalise empty string to None (same as api_key) and
        // drop an explicit "default" since None already resolves there.
        sandbox_scope_id: instance
            .sandbox_scope_id
            .filter(|s| !s.is_empty() && s != crate::sandbox::DEFAULT_SCOPE_ID),
        // T8 — reference to an LlmProfile. Empty-string → None so the
        // frontend can clear the link by sending `""` from a dropdown.
        llm_profile_id: instance.llm_profile_id.filter(|s| !s.trim().is_empty()),
    };

    // 1. Build the adapter (fail-fast on bad URL before we touch disk).
    let adapter = HermesAdapter::new_live(
        normalised.base_url.clone(),
        normalised.api_key.clone(),
        normalised.default_model.clone(),
    )?;

    // 2. Persist the updated list.
    let dir = state.config_dir.clone();
    let to_save = normalised.clone();
    let saved = tokio::task::spawn_blocking(move || -> IpcResult<HermesInstance> {
        let list = hermes_instances::load(&dir);
        let list = hermes_instances::upsert(list, to_save.clone());
        hermes_instances::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save hermes_instances: {e}"),
        })?;
        Ok(to_save)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_instance_upsert join: {e}"),
    })??;

    // 3. Hot-swap in the registry.
    state.adapters.register_with_id_and_label(
        adapter_id_for(&saved.id),
        saved.label.clone(),
        Arc::new(adapter),
    );

    tracing::info!(id = %saved.id, base_url = %saved.base_url, "T6.2: Hermes instance upserted");
    Ok(saved)
}

/// Delete by id. Removes the file entry and unregisters the adapter.
#[tauri::command]
pub async fn hermes_instance_delete(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let id_norm = id.trim().to_string();
    hermes_instances::validate_id(&id_norm).map_err(|e| IpcError::NotConfigured { hint: e })?;

    let dir = state.config_dir.clone();
    let id_for_task = id_norm.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let list = hermes_instances::load(&dir);
        let (list, removed) = hermes_instances::delete(list, &id_for_task);
        if !removed {
            // Idempotent: deleting a missing row is a no-op, not an
            // error. Mirrors the rest of our delete IPCs.
            return Ok(());
        }
        hermes_instances::save(&dir, &list).map_err(|e| IpcError::Internal {
            message: format!("save hermes_instances: {e}"),
        })?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_instance_delete join: {e}"),
    })??;

    state.adapters.unregister(&adapter_id_for(&id_norm));
    tracing::info!(id = %id_norm, "T6.2: Hermes instance deleted");
    Ok(())
}

/// `HealthProbe` echo with the adapter id so the UI can correlate the
/// result against the row that triggered the test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceProbeResult {
    pub id: String,
    pub ok: bool,
    pub latency_ms: u32,
    pub body: String,
}

/// Dry-run a proposed instance config. Does NOT persist or register.
/// Used by the "Test" button in the instance editor so users can
/// validate credentials before saving.
///
/// We hit `GET /v1/models` with `Authorization: Bearer <api_key>`
/// (when one is present). This is the single endpoint shared by:
///   - a local Hermes gateway (mounts the OpenAI-compatible shim);
///   - every upstream OpenAI-compatible provider we ship a template
///     for (OpenAI, Anthropic, DeepSeek, Gemini OpenAI-shim, Ollama,
///     OpenRouter).
///
/// Earlier versions hit `/health` — that's Hermes-specific and
/// upstream providers respond 401 / 404 (e.g. DeepSeek's governor
/// emits "Authentication Fails" for unknown paths), making the test
/// button lie about valid credentials.
#[tauri::command]
pub async fn hermes_instance_test(instance: HermesInstance) -> IpcResult<InstanceProbeResult> {
    hermes_instances::validate_base_url(&instance.base_url)
        .map_err(|e| IpcError::NotConfigured { hint: e })?;

    let id = instance.id.clone();
    let api_key = instance.api_key.filter(|s| !s.is_empty());

    let started = std::time::Instant::now();
    let report =
        crate::adapters::hermes::probe::probe_models(&instance.base_url, api_key.as_deref()).await;
    let latency_ms = started.elapsed().as_millis() as u32;

    match report {
        Ok(r) => {
            // Body = a short preview so users can sanity-check the
            // endpoint actually speaks OpenAI.
            let preview: Vec<String> = r.models.iter().take(5).map(|m| m.id.clone()).collect();
            let body = if preview.is_empty() {
                "Reachable, but /v1/models returned no entries.".to_string()
            } else {
                format!("OK · {} model(s): {}", r.models.len(), preview.join(", "))
            };
            Ok(InstanceProbeResult {
                id,
                ok: true,
                latency_ms: r.latency_ms,
                body,
            })
        }
        Err(e) => Ok(InstanceProbeResult {
            id,
            ok: false,
            latency_ms,
            body: e.to_string(),
        }),
    }
}
