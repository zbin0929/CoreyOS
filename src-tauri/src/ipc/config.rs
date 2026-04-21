//! Settings IPC: read / write / test the runtime gateway configuration.
//!
//! Saving a new config does three things, in order:
//! 1. Validate + build a fresh `HermesAdapter` (so bad URLs fail fast).
//! 2. Persist to `<app_config_dir>/gateway.json` (atomic rename).
//! 3. Hot-swap the adapter in the `AdapterRegistry` — existing in-flight
//!    streams keep running against the old `Arc<HermesAdapter>`; new
//!    requests pick up the new one.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::adapters::hermes::gateway::{HealthProbe, HermesGateway};
use crate::adapters::hermes::HermesAdapter;
use crate::config::GatewayConfig;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfigDto {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
}

impl From<GatewayConfig> for GatewayConfigDto {
    fn from(c: GatewayConfig) -> Self {
        Self {
            base_url: c.base_url,
            api_key: c.api_key,
            default_model: c.default_model,
        }
    }
}

impl From<GatewayConfigDto> for GatewayConfig {
    fn from(d: GatewayConfigDto) -> Self {
        Self {
            base_url: d.base_url,
            api_key: d.api_key,
            default_model: d.default_model,
        }
    }
}

/// Return the current gateway config. The API key is returned verbatim —
/// the frontend stores it locally and the call is over Tauri's intra-process
/// channel, not the network.
#[tauri::command]
pub async fn config_get(state: State<'_, AppState>) -> IpcResult<GatewayConfigDto> {
    let cfg = state.config.read().expect("config poisoned").clone();
    Ok(cfg.into())
}

/// Validate → persist → hot-swap.
#[tauri::command]
pub async fn config_set(state: State<'_, AppState>, config: GatewayConfigDto) -> IpcResult<()> {
    let base_url = config.base_url.trim().to_string();
    if base_url.is_empty() {
        return Err(IpcError::NotConfigured {
            hint: "base_url cannot be empty".into(),
        });
    }
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(IpcError::NotConfigured {
            hint: "base_url must start with http:// or https://".into(),
        });
    }
    let new_cfg = GatewayConfig {
        base_url,
        api_key: config.api_key.filter(|s| !s.is_empty()),
        default_model: config.default_model.filter(|s| !s.is_empty()),
    };

    // 1. Build. Propagates AdapterError → IpcError via `?`.
    let adapter = HermesAdapter::new_live(
        new_cfg.base_url.clone(),
        new_cfg.api_key.clone(),
        new_cfg.default_model.clone(),
    )?;

    // 2. Persist. Map IO errors into an IpcError::Internal.
    new_cfg
        .save(&state.config_dir)
        .map_err(|e| IpcError::Internal {
            message: format!("save config: {e}"),
        })?;

    // 3. Hot-swap in the registry + update in-memory snapshot.
    state.adapters.register(Arc::new(adapter));
    *state.config.write().expect("config poisoned") = new_cfg;

    tracing::info!("gateway config updated via IPC");
    Ok(())
}

/// Probe a proposed config WITHOUT persisting it. Builds a throwaway
/// `HermesGateway` and hits `/health`. Lets the Settings UI show a green
/// dot before the user saves.
#[tauri::command]
pub async fn config_test(config: GatewayConfigDto) -> IpcResult<HealthProbe> {
    let gateway = HermesGateway::new(config.base_url, config.api_key.filter(|s| !s.is_empty()))?;
    Ok(gateway.health().await?)
}
