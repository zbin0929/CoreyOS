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
mod customer;
mod db;
// `pack` — Pack manifest schema + (later) scanner / lifecycle / MCP
// supervision. v0.2.0-dev: schema parser only; nothing wired into
// AppState yet. See `docs/01-architecture.md` § Pack Architecture.
mod error;
mod fs_atomic;
mod hermes_config;
mod hermes_cron;
mod hermes_instances;
mod hermes_logs;
mod hermes_profiles;
mod hermes_profiles_archive;
mod pack;
// llm_profiles — T8 multi-LLM model library (reusable {provider,
// base_url, model, api_key_env} bundles referenced by Hermes instances
// via `llm_profile_id`). Lives next to hermes_instances; similar
// shape, similar validation rules.
mod ipc;
mod license;
mod llm_profiles;
// mcp_server — Tauri-side MCP server exposing native desktop
// capabilities (file pickers, notifications, Settings deep-link, …)
// to Hermes Agent. Hermes connects as an MCP client. See module
// docstring for protocol + transport details.
mod mcp_server;
mod menu;
mod paths;
mod pty;
mod routing_rules;
mod sandbox;
mod skills;
mod state;
mod tfidf;
mod tray;
mod workflow;

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                tracing::info!("close requested, hiding window");
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Native desktop notifications — used both by the in-app
        // Notification Center widget and by the MCP-server bridge
        // (`corey_native.notify` tool, see `mcp_server::tools`).
        .plugin(tauri_plugin_notification::init())
        // Auto-update. The plugin inspects `plugins.updater` in
        // tauri.conf.json (endpoints + pubkey) and fetches the latest
        // manifest when the frontend calls `check()`. Wiring from the
        // UI lives in Settings → Updates.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let windows = app.webview_windows();
            if let Some(w) = windows.values().next() {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            ipc::agents::adapter_list,
            ipc::health::health_check,
            ipc::session::session_list,
            ipc::session::session_get,
            ipc::model::model_list,
            ipc::model::model_provider_probe,
            ipc::chat::chat_send,
            ipc::chat::chat_stream_start,
            ipc::chat::hermes_approval_respond,
            ipc::config::config_get,
            ipc::config::config_set,
            ipc::config::config_test,
            ipc::hermes_config::hermes_config_read,
            ipc::hermes_config::hermes_config_write_model,
            ipc::hermes_config::hermes_config_write_compression,
            ipc::hermes_config::hermes_config_write_security,
            ipc::hermes_config::hermes_env_set_key,
            ipc::hermes_memory::hermes_memory_status,
            ipc::hermes_memory::hermes_user_md_write,
            ipc::hermes_memory::hermes_compression_stats,
            ipc::hermes_memory::hermes_session_usage,
            ipc::hermes_memory::hermes_session_cleanup,
            ipc::hermes_config::hermes_gateway_restart,
            ipc::hermes_config::hermes_gateway_start,
            ipc::hermes_config::hermes_gateway_stop,
            ipc::hermes_config::hermes_detect,
            ipc::hermes_config::hermes_install_preflight,
            ipc::hermes_config::hermes_install,
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
            ipc::paths::app_data_dir_set,
            ipc::paths::app_data_dir_clear,
            ipc::channels::hermes_channel_list,
            ipc::channels::hermes_channel_save,
            ipc::channels::probe::hermes_channel_probe_token,
            ipc::channels::hermes_channel_setup_qr,
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
            ipc::attachments::attachment_thumbnail,
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
            ipc::learning::learning_extract,
            ipc::learning::learning_read_learnings,
            ipc::learning::learning_write_learnings,
            ipc::learning::learning_index_message,
            ipc::learning::learning_search_similar,
            ipc::learning::patterns::learning_detect_pattern,
            ipc::learning::patterns::learning_suggest_routing,
            ipc::learning::learning_compact_memory,
            ipc::session_search::session_search,
            ipc::mcp::mcp_server_list,
            ipc::mcp::mcp_server_upsert,
            ipc::mcp::mcp_server_delete,
            ipc::mcp::mcp_server_probe,
            ipc::menu::menu_set_locale,
            ipc::scheduler::scheduler_list_jobs,
            ipc::scheduler::scheduler_upsert_job,
            ipc::scheduler::scheduler_delete_job,
            ipc::scheduler::scheduler_validate_cron,
            ipc::scheduler::scheduler_list_runs,
            ipc::scheduler::scheduler_extract_intent,
            // `ipc::rag::*` was removed in v9 — see `embedding.rs` doc
            // comment for context. Real semantic search will land
            // again as a fresh module backed by Hermes /v1/embeddings.
            ipc::knowledge::knowledge_upload,
            ipc::knowledge::knowledge_list,
            ipc::knowledge::knowledge_delete,
            ipc::knowledge::knowledge_search,
            ipc::knowledge::rag_status,
            ipc::knowledge::rag_download_model,
            ipc::voice::voice_transcribe,
            ipc::voice::tts::voice_tts,
            ipc::voice::voice_get_config,
            ipc::voice::voice_set_config,
            ipc::voice::voice_audit_log,
            ipc::voice::recorder::voice_record,
            ipc::voice::recorder::voice_record_stop,
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
            ipc::llm_profiles::llm_profile_ensure_adapter,
            ipc::llm_profiles::llm_profile_probe_vision,
            ipc::license::license_status,
            ipc::license::license_install,
            ipc::license::license_clear,
            ipc::license::license_machine_id,
            ipc::customer::customer_config_get,
            ipc::pack::pack_list,
            ipc::pack::pack_set_enabled,
            ipc::workflow::workflow_list,
            ipc::workflow::workflow_get,
            ipc::workflow::workflow_save,
            ipc::workflow::workflow_delete,
            ipc::workflow::workflow_validate,
            ipc::workflow::workflow_run,
            ipc::workflow::workflow_run_status,
            ipc::workflow::workflow_run_cancel,
            ipc::workflow::workflow_active_runs,
            ipc::workflow::workflow_history_list,
            ipc::workflow::workflow_run_get,
            ipc::workflow::workflow_run_delete,
            ipc::workflow::generate::workflow_generate,
            ipc::workflow_intent::workflow_extract_intent,
            ipc::workflow::workflow_approve,
            ipc::browser_config::browser_config_get,
            ipc::browser_config::browser_config_set,
            ipc::browser_config::browser_diagnose,
            ipc::gateway_sessions::gateway_sessions_list,
            ipc::download::download_start,
            ipc::download::download_cancel,
            ipc::download::download_list,
            ipc::download::download_clear_completed,
            ipc::gateway_sessions::gateway_session_messages,
            ipc::gateway_sessions::gateway_source_messages,
        ])
        .setup(|app| {
            info!(version = env!("CARGO_PKG_VERSION"), "Corey booting");

            // Resolve the config directory AFTER Tauri has initialized —
            // `app.path().app_config_dir()` is only available here.
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app_config_dir");
            // Install the central path resolver BEFORE any subsystem
            // tries to locate `~/.hermes` — hermes_config, skills, and
            // the sandbox all read through it.
            paths::set_app_config_dir(config_dir.clone());
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

            // Register every saved LLM Profile as a Hermes-backed adapter
            // under `hermes:profile:<id>`.
            //
            // **Critical**: profile-backed adapters route to the LOCAL
            // Hermes gateway (`cfg.base_url`), NOT to the profile's own
            // `base_url`. The profile is the user's choice of MODEL — the
            // execution environment is always Hermes (so we get its agent
            // loop, tool registry, delegation, cron, skills, …). Passing
            // `profile.base_url` directly here was the original wiring,
            // and it bypassed Hermes entirely — every "profile" chat went
            // straight to vendor APIs without an agent loop, defeating
            // the whole point of integrating with Hermes-agent.
            //
            // The profile's `model` field is forwarded as the chat
            // completion request's `model`. Hermes' provider resolution
            // looks up which provider handles `deepseek-chat` /
            // `glm-5.1` / etc. and uses the credentials in its own
            // `~/.hermes/auth.json`. Corey's `api_key_env` field is
            // therefore informational only on this path; the source of
            // truth for vendor keys is Hermes.
            //
            // Failures per profile are logged and swallowed — a malformed
            // profile must not block the others or the app boot.
            for profile in llm_profiles::load(&config_dir) {
                match HermesAdapter::new_live(
                    cfg.base_url.clone(),
                    None,
                    Some(profile.model.clone()),
                ) {
                    Ok(adapter) => {
                        let adapter_id = format!("hermes:profile:{}", profile.id);
                        let label = if profile.label.trim().is_empty() {
                            profile.id.clone()
                        } else {
                            profile.label.clone()
                        };
                        registry.register_with_id_and_label(
                            adapter_id.clone(),
                            format!("LLM · {label}"),
                            Arc::new(adapter),
                        );
                        info!(profile_id = %profile.id, adapter_id = %adapter_id, "LLM profile registered as adapter");
                    }
                    Err(e) => {
                        tracing::warn!(id = %profile.id, error = %e, "skipping malformed LLM profile");
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

            let mut app_state = AppState::new(
                registry,
                cfg,
                config_dir.clone(),
                db,
                changelog_path,
                app_data_dir,
                db_path,
                channel_status,
            );

            // Load `~/.hermes/customer.yaml` for white-label
            // customization (Pack Architecture v2.0+). Best-effort:
            // a missing file is the common case (default Corey),
            // a malformed file is logged and the app launches with
            // defaults. The frontend reads this via
            // `customer_config_get` IPC at startup.
            match paths::hermes_data_dir() {
                Ok(hermes_dir) => match customer::load_from_dir(&hermes_dir) {
                    customer::LoadOutcome::NotPresent => {
                        info!("customer.yaml: not present (default Corey branding)");
                    }
                    customer::LoadOutcome::Loaded(cfg) => {
                        info!(
                            schema_version = cfg.schema_version,
                            app_name = ?cfg.brand.app_name,
                            hidden_routes = cfg.navigation.hidden_routes.len(),
                            "customer.yaml: loaded white-label config"
                        );
                        app_state.set_customer(Some(cfg), None);
                    }
                    customer::LoadOutcome::Invalid(err) => {
                        tracing::warn!(error = %err, "customer.yaml: invalid; ignoring");
                        app_state.set_customer(None, Some(err));
                    }
                },
                Err(e) => {
                    tracing::warn!(error = %e, "could not resolve hermes data dir; skipping customer.yaml");
                }
            }

            // Scan `~/.hermes/skill-packs/` and load
            // `~/.hermes/pack-state.json` into AppState.packs. Stage 2
            // of the Pack subsystem rollout (see `pack/mod.rs`):
            // discovery + persistence only — flipping the enable bit
            // doesn't yet spawn MCPs / mount routes (that's stage 3+).
            if let Ok(hermes_dir) = paths::hermes_data_dir() {
                let registry = pack::Registry::scan(&hermes_dir);
                info!(
                    packs = registry.packs.len(),
                    enabled = registry.packs.iter().filter(|p| p.enabled).count(),
                    healthy = registry.packs.iter().filter(|p| p.manifest.is_some()).count(),
                    "pack registry scanned"
                );
                app_state.set_packs(registry);
            }

            // Load sandbox.json (or seed ~/.hermes/ + stay in DevAllow on
            // first launch). Safe to call before `manage` — `authority` is
            // already inside the Arc inside AppState.
            app_state.authority.init_from_disk(&config_dir);

            match workflow::templates::ensure_templates() {
                Ok(n) => info!(n, "workflow templates checked"),
                Err(e) => tracing::error!(error = %e, "workflow templates install failed"),
            }

            // Rehydrate any non-terminal workflow runs from the DB
            // back into `state.workflow_runs`. Without this, a Corey
            // restart wipes paused approval gates — workflow's whole
            // "audit + human approval + strict order" pitch falls
            // apart the moment the user closes the app.
            //
            // Beyond rehydrating, we also AUTO-RESUME any run whose
            // last persisted state was `pending` or `running`. Reason:
            // those mean "the engine was driving this run when Corey
            // died", and there's no IPC that triggers a resume
            // otherwise — the user would see a step parked at
            // `running` forever. Steps that were mid-execution
            // (status=Running) are demoted to Pending so the engine's
            // resume bootstrap re-runs them; partial agent output
            // from before the kill is discarded (it's not safe to
            // assume a half-streamed answer was correct).
            //
            // `paused` runs are NOT auto-resumed: those wait on a
            // human approval, and the resume is initiated by
            // `workflow_approve`. Terminal runs (completed / failed
            // / cancelled) stay in SQLite as history but don't pin
            // engine memory.
            let mut to_resume: Vec<(String, String)> = Vec::new();
            if let Some(db) = app_state.db.as_ref() {
                match db.load_active_workflow_runs() {
                    Ok(runs) => {
                        let n = runs.len();
                        if n > 0 {
                            let mut map = app_state.workflow_runs.lock();
                            for mut r in runs {
                                let needs_resume = matches!(
                                    r.status,
                                    workflow::engine::RunStatus::Running
                                        | workflow::engine::RunStatus::Pending
                                );
                                if needs_resume {
                                    // Demote any half-executed step
                                    // to Pending so the engine reruns
                                    // it. Without this the resume
                                    // bootstrap would skip the step
                                    // (it only marks-completed steps
                                    // as `Completed`) but the planner
                                    // would also not re-add it to
                                    // `ready` — fatal for the run.
                                    for sr in r.step_runs.values_mut() {
                                        if sr.status == workflow::engine::StepRunStatus::Running {
                                            sr.status = workflow::engine::StepRunStatus::Pending;
                                            sr.error = None;
                                            sr.duration_ms = None;
                                            sr.output = None;
                                        }
                                    }
                                    to_resume.push((r.id.clone(), r.workflow_id.clone()));
                                }
                                map.insert(r.id.clone(), r);
                            }
                            info!(n, "rehydrated active workflow runs from SQLite");
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "workflow run rehydrate failed; starting empty");
                    }
                }
            }

            // Snap a few clones BEFORE app.manage moves app_state. We
            // can't reach into AppState by handle until after manage,
            // and we need these to spawn the resume tasks below.
            let runs_for_resume = app_state.workflow_runs.clone();
            let adapters_for_resume = app_state.adapters.clone();
            let db_for_resume = app_state.db.clone();
            let cancel_flags_for_resume = app_state.workflow_cancel_flags.clone();

            app.manage(app_state);

            // Now spawn the resume executors. We do this AFTER manage
            // so the shared state pointers are stable for the full
            // lifetime of the workflow.
            for (run_id, workflow_id) in to_resume {
                let runs = runs_for_resume.clone();
                let adapters = adapters_for_resume.clone();
                let db = db_for_resume.clone();
                let cancel_flags = cancel_flags_for_resume.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let def = match workflow::store::get(&workflow_id) {
                        Ok(d) => d,
                        Err(e) => {
                            tracing::warn!(workflow_id = %workflow_id, error = %e, "rehydrate resume: cannot load def, skipping");
                            return;
                        }
                    };
                    let inputs = runs
                        .lock()
                        .get(&run_id)
                        .map(|r| r.inputs.clone())
                        .unwrap_or(serde_json::Value::Null);
                    let ctx = workflow::context::RunContext::new(&def.id, &run_id, inputs);
                    // Allocate a fresh cancel flag for the resumed run.
                    // The user can `workflow_run_cancel` it just like
                    // a fresh run.
                    let flag: std::sync::Arc<std::sync::atomic::AtomicBool> =
                        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    cancel_flags.lock().insert(run_id.clone(), flag.clone());
                    info!(run_id = %run_id, workflow_id = %workflow_id, "auto-resuming workflow run after restart");
                    crate::ipc::workflow::spawn_run_executor(
                        runs, adapters, db, def, run_id, ctx, flag,
                    );
                });
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            // Spin up the MCP-over-HTTP bridge that exposes desktop-
            // native tools (file picker, notification, deep-link to
            // Settings) to Hermes Agent. Bound to 127.0.0.1 on a port
            // chosen by the OS — Hermes connects via
            // `hermes mcp add corey-native --url http://127.0.0.1:<port>/`.
            // Failure inside `start()` only logs at WARN; Corey stays
            // fully usable, Hermes just doesn't gain the native
            // tools. See `mcp_server` module docstring.
            mcp_server::start(app.handle().clone());

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

            tray::build(app);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Caduceus")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                tray::show_window(_app);
            }
        });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .with(filter)
        .init();
}
