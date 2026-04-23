//! Agent registry IPC (T5.5a).
//!
//! The frontend `AgentSwitcher` wants one round trip to paint the topbar:
//! "who's registered, who's the default, and how healthy is each one".
//! Exposing `health()` per-adapter as a fan-out avoids N sequential IPC
//! calls from the UI and keeps the list render atomic.

use serde::Serialize;
use tauri::State;

use crate::adapters::{AdapterInfo, Health};
use crate::error::IpcResult;
use crate::state::AppState;

/// One row in the `adapter_list` response. The frontend renders these as
/// items in the Topbar dropdown; fields mirror the existing types
/// (`AdapterInfo` + `Health`) so nothing new needs binding on the TS
/// side beyond the outer wrapper.
#[derive(Debug, Serialize)]
pub struct AdapterListEntry {
    #[serde(flatten)]
    pub info: AdapterInfo,
    /// `None` when the adapter's `health()` call errored; the UI surfaces
    /// that as a red dot + tooltip rather than hiding the row entirely.
    pub health: Option<Health>,
    /// When `health` is `None`, the serialised error message for tooltip
    /// hover. Never populated on the happy path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_error: Option<String>,
}

/// List every registered adapter and probe each one's health in parallel.
/// Individual probe failures do NOT fail the IPC — they produce a row
/// with `health: None` so the switcher can still list the adapter as
/// "registered but unreachable".
#[tauri::command]
pub async fn adapter_list(state: State<'_, AppState>) -> IpcResult<Vec<AdapterListEntry>> {
    let infos = state.adapters.all();

    // Fan out health probes in parallel. `AdapterRegistry::all()` returns
    // `Vec<AdapterInfo>` (owned), so we re-resolve each adapter by id for
    // the actual probe. Mapping is tiny; this runs at most every 30s.
    let mut handles = Vec::with_capacity(infos.len());
    for info in &infos {
        let id = info.id.clone();
        let registry = state.adapters.clone();
        handles.push(tokio::spawn(async move {
            match registry.get(&id) {
                Some(adapter) => match adapter.health().await {
                    Ok(h) => (id, Some(h), None),
                    Err(e) => (id, None, Some(e.to_string())),
                },
                None => (id, None, Some("adapter vanished from registry".into())),
            }
        }));
    }

    let mut probes: std::collections::HashMap<String, (Option<Health>, Option<String>)> =
        std::collections::HashMap::new();
    for h in handles {
        if let Ok((id, health, err)) = h.await {
            probes.insert(id, (health, err));
        }
    }

    Ok(infos
        .into_iter()
        .map(|info| {
            let (health, health_error) = probes.remove(&info.id).unwrap_or((None, None));
            AdapterListEntry {
                info,
                health,
                health_error,
            }
        })
        .collect())
}

// ───────────────────────── Tests ─────────────────────────

#[cfg(test)]
mod tests {
    use crate::adapters::claude_code::ClaudeCodeAdapter;
    use crate::adapters::hermes::HermesAdapter;
    use crate::adapters::AdapterRegistry;
    use std::sync::Arc;

    /// The IPC command isn't directly callable outside of a Tauri
    /// runtime context, so we test the underlying fan-out shape by
    /// exercising the registry + probing logic inline.
    #[tokio::test]
    async fn adapter_list_shape_matches_expectations() {
        let registry = AdapterRegistry::new();
        registry.register(Arc::new(HermesAdapter::new_stub()));
        registry.register(Arc::new(ClaudeCodeAdapter::new_mock()));
        registry.set_default("hermes").unwrap();

        let infos = registry.all();
        assert_eq!(infos.len(), 2);

        // Both adapters' health() succeed in their canonical mock/stub
        // mode, so the fan-out should produce 2 rows with `health: Some`.
        let mut entries = Vec::new();
        for info in infos {
            let adapter = registry.get(&info.id).unwrap();
            let h = adapter.health().await.ok();
            entries.push((info, h));
        }
        assert!(entries.iter().all(|(_, h)| h.is_some()));
        // Default flag survived the round trip.
        let default_row = entries.iter().find(|(i, _)| i.is_default).unwrap();
        assert_eq!(default_row.0.id, "hermes");
    }
}
