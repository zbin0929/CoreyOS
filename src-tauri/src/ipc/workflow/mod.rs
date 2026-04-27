pub mod generate;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::browser_config as browser_config_ipc;
use crate::adapters::{ChatMessageDto, ChatTurn};
use crate::db::Db;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow;
use crate::workflow::browser_config;
use crate::workflow::engine::{self, StepExecutor, WorkflowRun};
use crate::workflow::model::{WorkflowDef, WorkflowSummary};
use crate::workflow::store::{self, ValidationError};

/// Best-effort persistence of a run's current state to SQLite.
///
/// Stamps `updated_at_ms` to "now" so the History list can MRU-sort
/// without needing every state mutation site to remember to bump it.
/// Persistence errors are logged and swallowed: the in-memory copy
/// remains the source of truth for the running session, and a flaky
/// disk shouldn't take down a workflow that's otherwise progressing.
fn persist_run(db: &Option<Arc<Db>>, run: &mut WorkflowRun) {
    run.updated_at_ms = chrono::Utc::now().timestamp_millis();
    let Some(db) = db.as_ref() else {
        return;
    };
    if let Err(e) = db.upsert_workflow_run(run) {
        tracing::warn!(
            run_id = %run.id,
            error = %e,
            "workflow run persist failed; in-memory state still authoritative"
        );
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

#[tauri::command]
pub async fn workflow_list(state: State<'_, AppState>) -> IpcResult<Vec<WorkflowSummary>> {
    let dir = state.config_dir.clone();
    let summaries = tokio::task::spawn_blocking(move || {
        let defs = store::list()?;
        let mut out = Vec::new();
        for def in &defs {
            let path = dir.join("workflows").join(format!("{}.yaml", def.id));
            let mtime = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(def.summary(mtime));
        }
        anyhow::Ok(out)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_list join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_list: {e}"),
    })?;
    Ok(summaries)
}

#[tauri::command]
pub async fn workflow_get(id: String) -> IpcResult<WorkflowDef> {
    tokio::task::spawn_blocking(move || store::get(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_get join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_get: {e}"),
        })
}

#[tauri::command]
pub async fn workflow_save(def: WorkflowDef) -> IpcResult<WorkflowDef> {
    tokio::task::spawn_blocking(move || {
        store::save(&def)?;
        anyhow::Ok(def)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_save join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_save: {e}"),
    })
}

#[tauri::command]
pub async fn workflow_delete(id: String) -> IpcResult<bool> {
    tokio::task::spawn_blocking(move || store::delete(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_delete join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_delete: {e}"),
        })
}

#[tauri::command]
pub async fn workflow_validate(def: WorkflowDef) -> IpcResult<ValidationResult> {
    let errors = tokio::task::spawn_blocking(move || store::validate(&def))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_validate join: {e}"),
        })?;
    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
    })
}

struct HermesExecutor {
    adapters: std::sync::Arc<crate::adapters::AdapterRegistry>,
}

impl StepExecutor for HermesExecutor {
    fn execute_agent(&self, agent_id: &str, prompt: &str) -> Result<String, String> {
        // Non-streaming path. Kept for symmetry with the trait
        // contract; in production the engine routes agent steps
        // through `execute_agent_streaming` (below) so the UI can
        // surface partial output during a 30+ second call.
        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        rt.block_on(async { adapter.chat_once(turn).await })
            .map_err(|e| format!("agent error: {e}"))
    }

    fn execute_agent_streaming(
        &self,
        agent_id: &str,
        prompt: &str,
        progress: &dyn Fn(&str),
    ) -> Result<String, String> {
        // Stream the agent's response and forward cumulative content
        // to `progress` as deltas arrive. The engine wires `progress`
        // to the step-progress hook, so a step parked in
        // `running` for 30+ seconds renders an actual stream of
        // tokens in the UI instead of a frozen spinner.
        //
        // Reasoning-model chunks (deepseek-reasoner, o1) are NOT
        // forwarded as content — they go to a separate channel in
        // the chat surface, but workflow steps only care about the
        // final answer. We still rely on their arrival to know
        // hermes is alive (no spurious timeouts).
        use crate::adapters::hermes::gateway::ChatStreamEvent;

        let rt = tokio::runtime::Handle::current();
        let adapter_id = if agent_id.is_empty() {
            "hermes"
        } else {
            agent_id
        };
        let adapter = self
            .adapters
            .get(adapter_id)
            .or_else(|| self.adapters.default_adapter())
            .ok_or_else(|| format!("adapter '{}' not found", adapter_id))?;

        let turn = ChatTurn {
            messages: vec![ChatMessageDto {
                role: "user".into(),
                content: prompt.into(),
                attachments: vec![],
            }],
            model: None,
            cwd: None,
            model_supports_vision: None,
        };

        // Buffered enough that the producer (gateway) doesn't park
        // on backpressure during a fast burst, but small enough that
        // we don't materially delay the engine if the consumer
        // (this thread) is slow.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatStreamEvent>(64);

        // The streaming future and its event-pump must run in
        // parallel: the future ends only when [DONE] arrives, but
        // it can't make progress unless someone is draining the
        // channel. `tokio::join!` runs both on the current
        // runtime's worker pool so the producer's `await` and the
        // consumer's `recv` can interleave correctly.
        let result: Result<String, String> = rt.block_on(async move {
            let producer = async {
                adapter
                    .chat_stream(turn, tx)
                    .await
                    .map_err(|e| format!("agent error: {e}"))
            };

            // Consumer: accumulate deltas, fire `progress` per chunk.
            // We throttle to roughly 1 callback per 50 ms of new
            // content so a fast model spitting tokens doesn't cause
            // hundreds of mutex acquisitions per second on the
            // hook's lock + SQLite write path. The final state is
            // always flushed when the channel closes.
            let consumer = async {
                let mut acc = String::new();
                let mut last_emit = std::time::Instant::now();
                while let Some(ev) = rx.recv().await {
                    if let ChatStreamEvent::Delta(chunk) = ev {
                        if !chunk.is_empty() {
                            acc.push_str(&chunk);
                            if last_emit.elapsed() >= std::time::Duration::from_millis(50) {
                                progress(&acc);
                                last_emit = std::time::Instant::now();
                            }
                        }
                    }
                    // Reasoning + tool events are intentionally ignored
                    // here — they're not the agent's final answer.
                }
                // One final flush so the last partial state lands
                // even if the throttle window swallowed it.
                if !acc.is_empty() {
                    progress(&acc);
                }
                acc
            };

            // join: wait for both to finish. Producer's outcome is
            // authoritative for errors; consumer just collects bytes.
            let (producer_res, accumulated) = tokio::join!(producer, consumer);
            producer_res?;
            Ok(accumulated)
        });

        result
    }

    fn execute_browser(
        &self,
        action: &str,
        url: &str,
        instruction: &str,
        profile: &str,
    ) -> Result<String, String> {
        use std::process::Command;

        let cfg = browser_config::load();

        let script_path = browser_config_ipc::find_browser_runner();
        let is_binary = script_path.extension().is_some_and(|e| e == "exe")
            || !script_path.extension().is_some_and(|e| e == "cjs");

        tracing::info!(action = %action, url = %url, profile = %profile, "browser step start");

        let task = serde_json::json!({
            "action": action,
            "url": url,
            "instruction": instruction,
            "profile": if profile.is_empty() { "" } else { profile },
        });

        let start = std::time::Instant::now();

        let mut cmd = if is_binary {
            let mut c = Command::new(&script_path);
            c.arg(task.to_string());
            c
        } else {
            let mut c = Command::new("node");
            c.arg(&script_path).arg(task.to_string());
            c
        };

        if !cfg.model.is_empty() {
            cmd.env("BROWSER_LLM_MODEL", &cfg.model);
        }
        if let Some(key) = browser_config::resolve_api_key(&cfg) {
            cmd.env("BROWSER_LLM_API_KEY", key);
        }
        if !cfg.base_url.is_empty() {
            cmd.env("BROWSER_LLM_BASE_URL", &cfg.base_url);
        }

        let output = cmd
            .output()
            .map_err(|e| format!("failed to spawn browser-runner: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if !output.status.success() {
            tracing::warn!(
                action = %action,
                duration_ms = start.elapsed().as_millis() as u64,
                stderr = %stderr,
                "browser step failed"
            );
            return Err(format!("browser-runner failed: {}{}", stdout, stderr));
        }

        tracing::info!(
            action = %action,
            duration_ms = start.elapsed().as_millis() as u64,
            "browser step done"
        );
        Ok(stdout.trim().to_string())
    }
}

#[tauri::command]
pub async fn workflow_run(
    state: State<'_, AppState>,
    id: String,
    inputs: serde_json::Value,
) -> IpcResult<String> {
    let wf_id = id.clone();
    let runs = state.workflow_runs.clone();

    let def = tokio::task::spawn_blocking(move || store::get(&wf_id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?;

    let (mut run, ctx) = engine::create_initial_run(&def, inputs);
    let run_id = run.id.clone();

    // Stamp the initial Pending state to disk before the executor
    // even starts. This costs ~1 ms and means a crash mid-startup
    // (rare but possible: Hermes hangs while we're trying to chat
    // its first agent step) still leaves a trace the History view
    // can show.
    let db = state.db.clone();
    persist_run(&db, &mut run);
    runs.lock().insert(run_id.clone(), run);

    // Allocate a cancel flag for this run so `workflow_run_cancel`
    // has somewhere to flip the bit. We hold a shared Arc clone in
    // both `state.workflow_cancel_flags` (so the cancel IPC can
    // find it by run_id) and inside `spawn_run_executor` (so the
    // engine's should_cancel hook reads it).
    let cancel_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    state
        .workflow_cancel_flags
        .lock()
        .insert(run_id.clone(), cancel_flag.clone());

    spawn_run_executor(
        runs.clone(),
        state.adapters.clone(),
        db.clone(),
        def,
        run_id.clone(),
        ctx,
        cancel_flag,
    );

    Ok(run_id)
}

/// Public spawn helper: kick the engine on `run_id` in a blocking
/// task. Used by:
///   * `workflow_run` — initial start
///   * `workflow_approve` — resume after an approval gate
///   * `lib.rs setup()` — rehydrate executor on app boot for runs
///     that were `running` / `pending` when Corey was last killed
///
/// All three paths need the same dance (take owned → re-insert →
/// execute_with_hooks → final sync → persist), and inlining it 3×
/// guaranteed drift, so it lives here. `pub` so the boot path can
/// call it from `lib.rs` without going through an IPC dispatch.
pub fn spawn_run_executor(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    adapters: std::sync::Arc<crate::adapters::AdapterRegistry>,
    db: Option<Arc<Db>>,
    def: WorkflowDef,
    run_id: String,
    mut ctx: workflow::context::RunContext,
    cancel_flag: Arc<AtomicBool>,
) {
    let rid_for_log = run_id.clone();
    let wf_id_for_log = def.id.clone();
    tokio::task::spawn_blocking(move || {
        let executor = HermesExecutor { adapters };
        let hook = make_step_end_hook(runs.clone(), db.clone(), run_id.clone());
        let progress_hook = make_step_progress_hook(runs.clone(), run_id.clone());
        let should_cancel = {
            let flag = cancel_flag.clone();
            move || flag.load(Ordering::Relaxed)
        };
        // Take the run OUT of the in-memory map for the duration of
        // execution. The hook syncs the run back into the map at
        // every step boundary, so concurrent `workflow_run_status`
        // polls can read fresh state without us holding the lock
        // while a 30 s agent step churns.
        let Some(mut owned) = runs.lock().remove(&run_id) else {
            return;
        };
        // Make the run visible to pollers immediately, before the
        // first agent call.
        runs.lock().insert(run_id.clone(), owned.clone());
        engine::execute_with_hooks(
            &def,
            &mut owned,
            &mut ctx,
            &executor,
            &hook,
            &progress_hook,
            &should_cancel,
        );
        // Final sync (hook already did this on the terminal
        // transition; this is belt-and-suspenders for safety).
        runs.lock().insert(run_id.clone(), owned.clone());
        persist_run(&db, &mut owned);
        tracing::info!(
            wf_id = %wf_id_for_log,
            run_id = %rid_for_log,
            status = ?runs.lock().get(&rid_for_log).map(|r| &r.status),
            "workflow run finished"
        );
    });
}

/// Closure factory for the engine's step-progress hook. Called many
/// times per agent step (every ~50 ms) with cumulative partial
/// content. We push it into `step.output["partial"]` and snapshot
/// the in-memory copy back so polls see live text streaming in. We
/// deliberately DON'T persist progress to SQLite — that would mean
/// hundreds of DB writes per agent step and the partial isn't
/// authoritative anyway (the final `step_end` hook supersedes it).
fn make_step_progress_hook(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    run_id: String,
) -> impl Fn(&str, &str) {
    move |step_id: &str, partial: &str| {
        let mut map = runs.lock();
        let Some(run) = map.get_mut(&run_id) else {
            return;
        };
        let Some(sr) = run.step_runs.get_mut(step_id) else {
            return;
        };
        // Stash the partial under a stable key the frontend reads.
        // We preserve any other fields the agent might have already
        // produced (currently none for streaming agent steps; this
        // is just defensive in case the engine starts setting an
        // `output: {}` placeholder).
        let mut out = sr
            .output
            .clone()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        out.insert(
            "partial".into(),
            serde_json::Value::String(partial.to_string()),
        );
        sr.output = Some(serde_json::Value::Object(out));
        run.updated_at_ms = chrono::Utc::now().timestamp_millis();
    }
}

/// Closure factory for the engine's step-end hook. Each invocation
/// captures `Arc<Mutex<…>>` and an `Option<Arc<Db>>`, returning a
/// `Fn(&WorkflowRun)` that snapshots the run back into the in-memory
/// map AND persists to SQLite. Called once per step transition
/// (running / completed / failed / paused).
fn make_step_end_hook(
    runs: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<String, WorkflowRun>>>,
    db: Option<Arc<Db>>,
    run_id: String,
) -> impl Fn(&WorkflowRun) {
    move |r: &WorkflowRun| {
        // Step 1: refresh in-memory copy so pollers see live state.
        // Acquire-and-release in a tight scope so the hot loop doesn't
        // sit on the lock during the upcoming SQLite write.
        {
            let mut map = runs.lock();
            // `insert` (rather than `get_mut + clone_from`) keeps the
            // semantics simple: even if the run was evicted by a
            // concurrent delete, we re-insert to reflect that the
            // executor is still authoritatively driving it.
            map.insert(run_id.clone(), r.clone());
        }
        // Step 2: persist to SQLite outside the in-memory lock. Best-
        // effort: a flaky disk shouldn't stop the engine.
        let mut snap = r.clone();
        snap.updated_at_ms = chrono::Utc::now().timestamp_millis();
        if let Some(db) = db.as_ref() {
            if let Err(e) = db.upsert_workflow_run(&snap) {
                tracing::warn!(
                    run_id = %snap.id,
                    error = %e,
                    "step-end persist failed; in-memory state still authoritative"
                );
            }
        }
    }
}

#[tauri::command]
pub async fn workflow_run_status(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<Option<WorkflowRun>> {
    let runs = state.workflow_runs.clone();
    let run = tokio::task::spawn_blocking(move || runs.lock().get(&run_id).cloned())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run_status join: {e}"),
        })?;
    Ok(run)
}

#[derive(Debug, Deserialize)]
pub struct ApproveParams {
    pub run_id: String,
    pub step_id: String,
    pub approved: bool,
    pub feedback: Option<String>,
}

/// Resolve a paused approval step.
///
/// `approved=true` flips the step to Completed and re-enters the
/// engine to drive the rest of the workflow forward (the executor
/// is idempotent — it picks up where it left off).
///
/// `approved=false` flips the run to Failed with a clear error so
/// downstream steps don't run. We deliberately don't have a
/// "resume from elsewhere" path; rejection means abort.
#[tauri::command]
pub async fn workflow_approve(
    state: State<'_, AppState>,
    params: ApproveParams,
) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let adapters = state.adapters.clone();
    let db = state.db.clone();
    let run_id = params.run_id.clone();
    let step_id = params.step_id.clone();
    let approved = params.approved;
    let feedback = params.feedback.clone();

    // Phase 1: stamp the approval verdict onto the step + decide
    // whether we still need to drive the engine forward.
    let (should_resume, workflow_id) = tokio::task::spawn_blocking({
        let runs = runs.clone();
        let run_id = run_id.clone();
        let step_id = step_id.clone();
        let feedback = feedback.clone();
        let db = db.clone();
        move || -> Option<(bool, String)> {
            let mut map = runs.lock();
            let run = map.get_mut(&run_id)?;
            let sr = run.step_runs.get_mut(&step_id)?;
            // Only act on a step that's actually paused on us.
            // Re-clicks (network retry, double-tap) become no-ops.
            if sr.status != engine::StepRunStatus::AwaitingApproval {
                return Some((false, run.workflow_id.clone()));
            }
            if approved {
                sr.status = engine::StepRunStatus::Completed;
                sr.output = Some(serde_json::json!({
                    "approved": true,
                    "feedback": feedback,
                    "decided_at": chrono::Utc::now().to_rfc3339(),
                }));
            } else {
                // The frontend always passes a localized feedback
                // string (defaulting to t('workflow_page.rejected_default')
                // when the user clicked Reject without typing a reason),
                // so we just surface it verbatim. Avoids hard-coded
                // English in the run error pill / banner.
                let reason = feedback
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "rejected".into());
                sr.error = Some(reason.clone());
                run.status = engine::RunStatus::Failed;
                run.error = Some(reason);
            }
            // Persist the verdict immediately. If the user closes
            // Corey before the resume task fires (or the resume
            // crashes), the History view still records exactly what
            // happened on the approval gate.
            persist_run(&db, run);
            Some((approved, run.workflow_id.clone()))
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_approve join: {e}"),
    })?
    .ok_or_else(|| IpcError::Internal {
        message: format!("run/step not found: {run_id}/{step_id}"),
    })?;

    // Phase 2: if approved, fire the executor again to resume the
    // run. This mirrors what `workflow_run` does on initial start —
    // we re-load the def from disk (small YAML, cheap) and re-build
    // ctx from the run's persisted step_runs.
    if !should_resume {
        return Ok(true);
    }

    // Resume: load the def, build a fresh ctx (the engine's resume
    // bootstrap will repopulate step outputs from `step_runs`), then
    // hand off to the shared executor spawn helper.
    let def = match tokio::task::spawn_blocking(move || store::get(&workflow_id)).await {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => {
            tracing::error!(error = %e, "workflow_approve: cannot reload def to resume");
            return Ok(true);
        }
        Err(e) => return Err(IpcError::Internal {
            message: format!("workflow_approve def load join: {e}"),
        }),
    };
    let inputs_for_ctx = runs
        .lock()
        .get(&run_id)
        .map(|r| r.inputs.clone())
        .unwrap_or(serde_json::Value::Null);
    let ctx = workflow::context::RunContext::new(&def.id, &run_id, inputs_for_ctx);
    // Reuse the existing cancel flag if one is already registered
    // (the run was started in this session and never finished); else
    // allocate a fresh one so `workflow_run_cancel` can still target
    // a resumed-from-disk run.
    let cancel_flag = state
        .workflow_cancel_flags
        .lock()
        .entry(run_id.clone())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone();
    spawn_run_executor(runs.clone(), adapters, db.clone(), def, run_id.clone(), ctx, cancel_flag);
    tracing::info!(run_id = %run_id, "workflow_approve: resume task spawned");

    Ok(true)
}

/// Manually stop a running workflow. Sets the cancel flag and (for
/// already-paused runs that have no executor running) flips the
/// in-memory + persisted status to `Cancelled` directly. Returns
/// `true` on success, `false` if the run wasn't found.
///
/// Cancellation is honored at the next step boundary — an in-flight
/// agent step (~30 s `chat_stream`) finishes its current call before
/// the engine exits. We deliberately don't abort mid-stream because
/// hermes would still bill for the partial response.
#[tauri::command]
pub async fn workflow_run_cancel(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let flags = state.workflow_cancel_flags.clone();
    let db = state.db.clone();
    let rid = run_id.clone();
    tokio::task::spawn_blocking(move || -> bool {
        // 1. Flip the atomic flag so the engine sees it on the
        //    next step boundary (covers running / resuming runs).
        let had_flag = flags.lock().get(&rid).is_some();
        if let Some(flag) = flags.lock().get(&rid) {
            flag.store(true, Ordering::Relaxed);
        }
        // 2. For runs in `Paused` (awaiting approval, no executor
        //    running) or `Pending` (queued, executor hasn't started),
        //    the engine isn't going to revisit a step boundary — flip
        //    the run status manually + persist.
        let mut map = runs.lock();
        let Some(run) = map.get_mut(&rid) else {
            return had_flag;
        };
        let needs_manual_terminate = matches!(
            run.status,
            engine::RunStatus::Paused | engine::RunStatus::Pending
        );
        if needs_manual_terminate {
            run.status = engine::RunStatus::Cancelled;
            run.error = Some("Cancelled by user".into());
            run.updated_at_ms = chrono::Utc::now().timestamp_millis();
            if let Some(db) = db.as_ref() {
                if let Err(e) = db.upsert_workflow_run(run) {
                    tracing::warn!(run_id = %rid, error = %e, "cancel persist failed");
                }
            }
        }
        true
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_cancel join: {e}"),
    })
}

/// History list for the workflow page's "past runs" view. Returns
/// MRU-first summaries of every persisted run (terminal + active),
/// optionally filtered to one workflow id. `limit` caps the result so
/// a workflow that's been hammered for months doesn't blow render
/// time; the typed clamp lives inside `db.list_workflow_history`.
#[tauri::command]
pub async fn workflow_history_list(
    state: State<'_, AppState>,
    workflow_id: Option<String>,
    limit: Option<u32>,
) -> IpcResult<Vec<crate::db::WorkflowRunSummary>> {
    let db = state.db.clone();
    let lim = limit.unwrap_or(100);
    let rows = tokio::task::spawn_blocking(move || -> IpcResult<Vec<_>> {
        let Some(db) = db else {
            return Ok(Vec::new());
        };
        db.list_workflow_history(workflow_id.as_deref(), lim)
            .map_err(|e| IpcError::Internal {
                message: format!("list workflow history: {e}"),
            })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_history_list join: {e}"),
    })??;
    Ok(rows)
}

/// Fetch one full historical run (header + all steps) by id. Returns
/// `Ok(None)` when the run id is unknown — used by the History view's
/// "view past audit trail" affordance.
#[tauri::command]
pub async fn workflow_run_get(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<Option<WorkflowRun>> {
    let db = state.db.clone();
    let run = tokio::task::spawn_blocking(move || -> IpcResult<Option<WorkflowRun>> {
        let Some(db) = db else {
            return Ok(None);
        };
        db.get_workflow_run(&run_id).map_err(|e| IpcError::Internal {
            message: format!("get workflow run: {e}"),
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_get join: {e}"),
    })??;
    Ok(run)
}

/// Hard-delete one run + its step rows from the audit trail. Used by
/// the History view's trash affordance. Also evicts the run from the
/// in-memory active-runs map so a re-open doesn't surface a ghost.
#[tauri::command]
pub async fn workflow_run_delete(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        // Evict in-memory copy first so a concurrent active-runs poll
        // can't briefly resurrect what we're about to delete.
        runs.lock().remove(&run_id);
        if let Some(db) = db {
            db.delete_workflow_run(&run_id).map_err(|e| IpcError::Internal {
                message: format!("delete workflow run: {e}"),
            })?;
        }
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run_delete join: {e}"),
    })??;
    Ok(true)
}

#[tauri::command]
pub async fn workflow_active_runs(state: State<'_, AppState>) -> IpcResult<Vec<WorkflowRun>> {
    let runs = state.workflow_runs.clone();
    let active = tokio::task::spawn_blocking(move || {
        runs.lock()
            .values()
            .filter(|r| {
                matches!(
                    r.status,
                    engine::RunStatus::Running
                        | engine::RunStatus::Pending
                        | engine::RunStatus::Paused
                )
            })
            .cloned()
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_active_runs join: {e}"),
    })?;
    Ok(active)
}
