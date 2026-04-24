//! Caduceus core library.
//!
//! See `docs/01-architecture.md` for the high-level layout and
//! `docs/03-agent-adapter.md` for the adapter abstraction.

mod adapters;
mod attachments;
mod changelog;
mod channel_status;
mod channels;
mod config;
mod db;
mod error;
mod fs_atomic;
mod hermes_config;
mod hermes_cron;
mod hermes_instances;
mod hermes_logs;
mod hermes_profiles;
mod hermes_profiles_archive;
// llm_profiles — T8 multi-LLM model library (reusable {provider,
// base_url, model, api_key_env} bundles referenced by Hermes instances
// via `llm_profile_id`). Lives next to hermes_instances; similar
// shape, similar validation rules.
mod llm_profiles;
mod ipc;
mod menu;
mod pty;
mod routing_rules;
mod sandbox;
mod skills;
mod state;

use std::sync::Arc;

use tauri::Manager;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::adapters::{
    aider::AiderAdapter, claude_code::ClaudeCodeAdapter, hermes::HermesAdapter, AdapterRegistry,
};
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
        .plugin(tauri_plugin_dialog::init())
        // Auto-update. The plugin inspects `plugins.updater` in
        // tauri.conf.json (endpoints + pubkey) and fetches the latest
        // manifest when the frontend calls `check()`. Wiring from the
        // UI lives in Settings → Updates.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ipc::agents::adapter_list,
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
            ipc::hermes_config::hermes_gateway_start,
            ipc::hermes_config::hermes_detect,
            ipc::changelog::changelog_list,
            ipc::changelog::changelog_revert,
            ipc::db::db_load_all,
            ipc::db::db_session_upsert,
            ipc::db::db_session_delete,
            ipc::db::db_message_upsert,
            ipc::db::db_message_set_usage,
            ipc::db::db_message_set_feedback,
            ipc::db::db_tool_call_append,
            ipc::db::analytics_summary,
            ipc::paths::app_paths,
            ipc::channels::hermes_channel_list,
            ipc::channels::hermes_channel_save,
            ipc::channel_status::hermes_channel_status_list,
            ipc::hermes_logs::hermes_log_tail,
            ipc::hermes_profiles::hermes_profile_list,
            ipc::hermes_profiles::hermes_profile_create,
            ipc::hermes_profiles::hermes_profile_rename,
            ipc::hermes_profiles::hermes_profile_delete,
            ipc::hermes_profiles::hermes_profile_clone,
            ipc::hermes_profiles::hermes_profile_activate,
            ipc::hermes_profiles::hermes_profile_export,
            ipc::hermes_profiles::hermes_profile_import,
            ipc::hermes_profiles::hermes_profile_import_preview,
            ipc::runbooks::runbook_list,
            ipc::runbooks::runbook_upsert,
            ipc::runbooks::runbook_delete,
            ipc::budgets::budget_list,
            ipc::budgets::budget_upsert,
            ipc::budgets::budget_delete,
            ipc::pty::pty_spawn,
            ipc::pty::pty_write,
            ipc::pty::pty_resize,
            ipc::pty::pty_kill,
            ipc::skills::skill_list,
            ipc::skills::skill_get,
            ipc::skills::skill_save,
            ipc::skills::skill_delete,
            ipc::skills::skill_version_list,
            ipc::skills::skill_version_get,
            ipc::skill_hub::skill_hub_exec,
            ipc::attachments::attachment_stage_blob,
            ipc::attachments::attachment_stage_path,
            ipc::attachments::attachment_delete,
            ipc::attachments::attachment_preview,
            ipc::attachments::attachment_gc,
            ipc::db::db_attachment_insert,
            ipc::db::db_attachment_delete,
            ipc::demo::home_stats,
            ipc::sandbox::sandbox_get_state,
            ipc::sandbox::sandbox_add_root,
            ipc::sandbox::sandbox_remove_root,
            ipc::sandbox::sandbox_grant_once,
            ipc::sandbox::sandbox_set_enforced,
            ipc::sandbox::sandbox_clear_session_grants,
            ipc::sandbox::sandbox_scope_list,
            ipc::sandbox::sandbox_scope_upsert,
            ipc::sandbox::sandbox_scope_delete,
            ipc::memory::memory_read,
            ipc::memory::memory_write,
            ipc::session_search::session_search,
            ipc::mcp::mcp_server_list,
            ipc::mcp::mcp_server_upsert,
            ipc::mcp::mcp_server_delete,
            ipc::menu::menu_set_locale,
            ipc::scheduler::scheduler_list_jobs,
            ipc::scheduler::scheduler_upsert_job,
            ipc::scheduler::scheduler_delete_job,
            ipc::scheduler::scheduler_validate_cron,
            ipc::scheduler::scheduler_list_runs,
            ipc::hermes_instances::hermes_instance_list,
            ipc::hermes_instances::hermes_instance_upsert,
            ipc::hermes_instances::hermes_instance_delete,
            ipc::hermes_instances::hermes_instance_test,
            ipc::routing_rules::routing_rule_list,
            ipc::routing_rules::routing_rule_upsert,
            ipc::routing_rules::routing_rule_delete,
            ipc::preset::preset_describe,
            ipc::preset::preset_install,
            ipc::llm_profiles::llm_profile_list,
            ipc::llm_profiles::llm_profile_upsert,
            ipc::llm_profiles::llm_profile_delete,
        ])
        .setup(|app| {
            info!(version = env!("CARGO_PKG_VERSION"), "Corey booting");

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
            // Phase 5 · T5.2a — register the Claude Code mock adapter so the
            // upcoming AgentSwitcher (T5.5) has a second citizen to list.
            // Mock mode only; the real CLI integration lands in T5.2b.
            // Non-default: Hermes stays the primary chat target until the
            // UI offers a way to switch.
            registry.register(Arc::new(ClaudeCodeAdapter::new_mock()));
            // T5.3a — third citizen: Aider (mock). Repo-aware code
            // pair-programmer; needs `ChatTurn.cwd` set to a repo path
            // at send time (the Composer will wire this in a later task).
            registry.register(Arc::new(AiderAdapter::new_mock()));
            registry
                .set_default("hermes")
                .expect("hermes is registered");

            // T6.2 — register any extra Hermes instances from
            // `<app_config_dir>/hermes_instances.json`. Failures per
            // instance are logged and swallowed so one bad URL
            // doesn't block the others (or the whole app).
            for inst in hermes_instances::load(&config_dir) {
                match HermesAdapter::new_live(
                    inst.base_url.clone(),
                    inst.api_key.clone(),
                    inst.default_model.clone(),
                ) {
                    Ok(adapter) => {
                        let adapter_id = hermes_instances::adapter_id_for(&inst.id);
                        let label = if inst.label.trim().is_empty() {
                            inst.id.clone()
                        } else {
                            inst.label.clone()
                        };
                        registry.register_with_id_and_label(
                            adapter_id.clone(),
                            label,
                            Arc::new(adapter),
                        );
                        info!(id = %inst.id, base_url = %inst.base_url, "T6.2: Hermes instance registered");
                    }
                    Err(e) => {
                        tracing::warn!(id = %inst.id, error = %e, "T6.2: skipping malformed Hermes instance");
                    }
                }
            }

            info!(
                adapters = ?registry.all().iter().map(|a| &a.id).collect::<Vec<_>>(),
                "adapter registry populated"
            );

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

            // Phase 3 · T3.4: 30s-TTL cache for channel liveness
            // derived from Hermes's rolling logs. Populated lazily
            // on first IPC call — startup does no work here.
            let channel_status = Arc::new(channel_status::ChannelStatusCache::new());

            let app_state = AppState::new(
                registry,
                cfg,
                config_dir.clone(),
                db,
                changelog_path,
                app_data_dir,
                db_path,
                channel_status,
            );

            // Load sandbox.json (or seed ~/.hermes/ + stay in DevAllow on
            // first launch). Safe to call before `manage` — `authority` is
            // already inside the Arc inside AppState.
            app_state.authority.init_from_disk(&config_dir);

            app.manage(app_state);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            // Native menubar. Build + install once at setup; the menu is
            // app-wide on macOS (single NSMenu) and per-window elsewhere
            // (Tauri mirrors it automatically for new windows).
            // Fallback locale is English — the frontend pushes the real
            // one via `menu_set_locale` a few ticks later, once i18next
            // has hydrated. This keeps the bar usable during the cold-
            // boot JS load without blocking startup on UI.
            match menu::build(app.handle(), menu::Locale::En) {
                Ok(m) => {
                    if let Err(e) = app.set_menu(m) {
                        tracing::warn!(error = %e, "failed to install menu");
                    } else {
                        menu::install_handler(app.handle());
                    }
                }
                Err(e) => tracing::warn!(error = %e, "failed to build menu"),
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
