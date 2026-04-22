use tauri::State;

use crate::adapters::hermes::probe::{self, ProbeReport};
use crate::adapters::ModelInfo;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[tauri::command]
pub async fn model_list(state: State<'_, AppState>) -> IpcResult<Vec<ModelInfo>> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;
    adapter.list_models().await.map_err(Into::into)
}

/// Probe an OpenAI-compatible `GET {base_url}/v1/models` endpoint and return
/// the list of discovered models. Does NOT go through the running Hermes
/// gateway — we talk directly to the upstream provider so the user can
/// discover models **before** committing a provider+model combo to
/// `config.yaml`.
///
/// Authentication source: exactly one of `api_key` (inline, never persisted)
/// or `env_key` (server reads `~/.hermes/.env` by name — raw value never
/// transits IPC). Passing neither probes anonymously.
#[tauri::command]
pub async fn model_provider_probe(
    base_url: String,
    api_key: Option<String>,
    env_key: Option<String>,
) -> IpcResult<ProbeReport> {
    // If the caller named an env var, look it up server-side. A missing entry
    // is not an error — we probe anonymously and the upstream will 401 if that
    // matters (which the frontend surfaces as "Unauthorized").
    let resolved_key = match env_key.as_deref().filter(|k| !k.is_empty()) {
        Some(name) => {
            crate::hermes_config::read_env_value(name).map_err(|e| IpcError::Internal {
                message: format!("read env for probe: {e}"),
            })?
        }
        None => api_key,
    };
    probe::probe_models(&base_url, resolved_key.as_deref())
        .await
        .map_err(Into::into)
}
