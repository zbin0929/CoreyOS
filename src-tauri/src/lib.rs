//! Caduceus core library.
//!
//! See `docs/01-architecture.md` for the high-level layout and
//! `docs/03-agent-adapter.md` for the adapter abstraction.

// Phase 0 ships the full scaffold (adapter trait surface, sandbox APIs,
// error taxonomy) but only a subset is wired to IPC. The remaining items
// are consumed starting Phase 1. TODO(phase-1-end): remove this allow
// once every symbol has at least one production call site.
#![allow(dead_code)]

mod adapters;
mod error;
mod ipc;
mod sandbox;
mod state;

use std::sync::Arc;

use tauri::Manager;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::adapters::{hermes::HermesAdapter, AdapterRegistry};
use crate::state::AppState;

/// Gateway defaults. Phase 2 will surface these in Settings; for Sprint 1
/// we read env overrides and fall back to the documented defaults.
/// - `HERMES_GATEWAY_URL`  — base URL (default `http://127.0.0.1:8642`)
/// - `HERMES_GATEWAY_KEY`  — bearer token (matches `API_SERVER_KEY`)
/// - `HERMES_DEFAULT_MODEL`— model id (falls back to adapter default)
fn build_hermes_adapter() -> Arc<HermesAdapter> {
    let base_url =
        std::env::var("HERMES_GATEWAY_URL").unwrap_or_else(|_| "http://127.0.0.1:8642".to_string());
    let api_key = std::env::var("HERMES_GATEWAY_KEY").ok().filter(|k| !k.is_empty());
    let default_model = std::env::var("HERMES_DEFAULT_MODEL").ok().filter(|k| !k.is_empty());

    match HermesAdapter::new_live(base_url.clone(), api_key, default_model) {
        Ok(adapter) => {
            info!(base_url, "Hermes adapter: live mode");
            Arc::new(adapter)
        }
        Err(e) => {
            tracing::warn!(error = %e, "falling back to Hermes stub adapter");
            Arc::new(HermesAdapter::new_stub())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let mut registry = AdapterRegistry::new();
    registry.register(build_hermes_adapter());
    registry
        .set_default("hermes")
        .expect("hermes is registered");

    let app_state = AppState::new(registry);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            ipc::health::health_check,
            ipc::session::session_list,
            ipc::session::session_get,
            ipc::model::model_list,
            ipc::chat::chat_send,
            ipc::chat::chat_stream_start,
            ipc::demo::home_stats,
        ])
        .setup(|app| {
            info!(version = env!("CARGO_PKG_VERSION"), "Caduceus booting");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Caduceus");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .with(filter)
        .init();
}
