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
mod changelog;
mod channel_status;
mod channels;
mod config;
mod db;
mod error;
mod fs_atomic;
mod hermes_config;
mod hermes_logs;
mod hermes_profiles;
mod ipc;
mod sandbox;
mod state;
mod wechat;

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
            ipc::model::model_provider_probe,
            ipc::chat::chat_send,
            ipc::chat::chat_stream_start,
            ipc::config::config_get,
            ipc::config::config_set,
            ipc::config::config_test,
            ipc::hermes_config::hermes_config_read,
            ipc::hermes_config::hermes_config_write_model,
            ipc::hermes_config::hermes_env_set_key,
            ipc::hermes_config::hermes_gateway_restart,
            ipc::changelog::changelog_list,
            ipc::changelog::changelog_revert,
            ipc::db::db_load_all,
            ipc::db::db_session_upsert,
            ipc::db::db_session_delete,
            ipc::db::db_message_upsert,
            ipc::db::db_message_set_usage,
            ipc::db::db_tool_call_append,
            ipc::db::analytics_summary,
            ipc::paths::app_paths,
            ipc::channels::hermes_channel_list,
            ipc::channels::hermes_channel_save,
            ipc::channel_status::hermes_channel_status_list,
            ipc::wechat::wechat_qr_start,
            ipc::wechat::wechat_qr_poll,
            ipc::wechat::wechat_qr_cancel,
            ipc::hermes_logs::hermes_log_tail,
            ipc::hermes_profiles::hermes_profile_list,
            ipc::hermes_profiles::hermes_profile_create,
            ipc::hermes_profiles::hermes_profile_rename,
            ipc::hermes_profiles::hermes_profile_delete,
            ipc::hermes_profiles::hermes_profile_clone,
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

            // Open the SQLite DB under <app_data_dir>/caduceus.db. Missing
            // parent dirs are created by `Db::open`. If it fails we log loudly
            // and start without persistence — the UI still functions.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");
            let db_path = db::db_path(&app_data_dir);
            let db = match db::Db::open(&db_path) {
                Ok(d) => {
                    info!(path = %db_path.display(), "SQLite DB opened");
                    Some(Arc::new(d))
                }
                Err(e) => {
                    tracing::error!(error = %e, path = %db_path.display(), "failed to open DB; persistence disabled");
                    None
                }
            };

            // Mutation journal lives next to the SQLite DB. One file per
            // install; appended forever (Phase 2.8 will add a viewer + revert).
            let changelog_path = app_data_dir.join("changelog.jsonl");

            // Phase 3 · T3.3: the stub QR provider. Swap for
            // `ILinkQrProvider::new(..)` once that ships; no other
            // wiring needs to change. `Some(changelog_path.clone())`
            // so scanned sessions journal their `.env` write.
            let wechat = Arc::new(wechat::WechatRegistry::new(Arc::new(
                wechat::StubQrProvider::new(Some(changelog_path.clone())),
            )));

            // Phase 3 · T3.4: 30s-TTL cache for channel liveness
            // derived from Hermes's rolling logs. Populated lazily
            // on first IPC call — startup does no work here.
            let channel_status = Arc::new(channel_status::ChannelStatusCache::new());

            app.manage(AppState::new(
                registry,
                cfg,
                config_dir,
                db,
                changelog_path,
                app_data_dir,
                db_path,
                wechat,
                channel_status,
            ));

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
