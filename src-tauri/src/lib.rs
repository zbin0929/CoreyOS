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
mod config;
mod error;
mod hermes_config;
mod ipc;
mod sandbox;
mod state;

use std::sync::Arc;

use tauri::Manager;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::adapters::{hermes::HermesAdapter, AdapterRegistry};
use crate::config::GatewayConfig;
use crate::state::AppState;

/// Build a live Hermes adapter from the given config. Falls back to a stub
/// on construction failure so the app stays usable (the user can still open
/// Settings and fix the URL).
fn build_hermes_adapter(cfg: &GatewayConfig) -> Arc<HermesAdapter> {
    match HermesAdapter::new_live(
        cfg.base_url.clone(),
        cfg.api_key.clone(),
        cfg.default_model.clone(),
    ) {
        Ok(adapter) => {
            info!(base_url = %cfg.base_url, "Hermes adapter: live mode");
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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            ipc::health::health_check,
            ipc::session::session_list,
            ipc::session::session_get,
            ipc::model::model_list,
            ipc::chat::chat_send,
            ipc::chat::chat_stream_start,
            ipc::config::config_get,
            ipc::config::config_set,
            ipc::config::config_test,
            ipc::hermes_config::hermes_config_read,
            ipc::hermes_config::hermes_config_write_model,
            ipc::demo::home_stats,
        ])
        .setup(|app| {
            info!(version = env!("CARGO_PKG_VERSION"), "Caduceus booting");

            // Resolve the config directory AFTER Tauri has initialized —
            // `app.path().app_config_dir()` is only available here.
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app_config_dir");
            let cfg = GatewayConfig::load_or_default(&config_dir);
            info!(
                base_url = %cfg.base_url,
                dir = %config_dir.display(),
                "gateway config loaded",
            );

            // Build the registry + state with the resolved config.
            let registry = AdapterRegistry::new();
            registry.register(build_hermes_adapter(&cfg));
            registry
                .set_default("hermes")
                .expect("hermes is registered");

            app.manage(AppState::new(registry, cfg, config_dir));

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
