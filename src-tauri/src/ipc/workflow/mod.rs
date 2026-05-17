pub mod generate;

mod execution;
pub use execution::spawn_run_executor;
// `workflow_run` is `#[tauri::command]`; `tauri::generate_handler!` in
// lib.rs needs BOTH the original fn and its `__cmd__workflow_run` shim
// reachable at `crate::ipc::workflow::*`. Glob-export everything from
// `execution` so the path stays stable (and future commands added
// there don't require touching this re-export line).
#[allow(unused_imports)]
pub use execution::*;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow;
use crate::workflow::engine::{self, WorkflowRun};
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
        Err(e) => {
            return Err(IpcError::Internal {
                message: format!("workflow_approve def load join: {e}"),
            })
        }
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
    spawn_run_executor(
        runs.clone(),
        adapters,
        state.authority.clone(),
        db.clone(),
        def,
        run_id.clone(),
        ctx,
        cancel_flag,
    );
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
pub async fn workflow_run_cancel(state: State<'_, AppState>, run_id: String) -> IpcResult<bool> {
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
        // 2. ALWAYS flip status to Cancelled immediately, regardless
        //    of current state. Earlier draft only did this for
        //    Paused/Pending runs (with the rationale that the engine
        //    would handle Running runs at the next step boundary).
        //    Problem: an in-flight 30 s `chat_stream` is a step
        //    boundary that's 30 seconds away — the user clicked
        //    Stop, saw nothing happen, assumed cancellation was
        //    broken, and complained.
        //
        //    Now we set Cancelled in-memory + persist immediately
        //    so the next status poll shows it. The engine still
        //    finishes the current step's chat_stream (hermes already
        //    billed for it; aborting wastes the tokens), then sees
        //    `should_cancel = true` on the next dispatch and exits
        //    cleanly. The terminal `on_step_end` fire will not
        //    overwrite Cancelled because the engine's terminal
        //    transitions only set Completed when status != Failed,
        //    and the cancel branch sets it to Cancelled before
        //    returning.
        let mut map = runs.lock();
        let Some(run) = map.get_mut(&rid) else {
            return had_flag;
        };
        // Already terminal — no-op so we don't overwrite Failed /
        // Completed with Cancelled.
        let already_terminal = matches!(
            run.status,
            engine::RunStatus::Cancelled
                | engine::RunStatus::Failed
                | engine::RunStatus::Completed
        );
        if !already_terminal {
            run.status = engine::RunStatus::Cancelled;
            run.error = Some("Cancelled by user".into());
            run.updated_at_ms = chrono::Utc::now().timestamp_millis();
            if let Some(db) = db.as_ref() {
                if let Err(e) = db.upsert_workflow_run(run) {
                    tracing::warn!(run_id = %rid, error = %e, "cancel persist failed");
                }
            }
        }
        tracing::info!(run_id = %rid, "workflow run cancelled (status=Cancelled, executor will exit at next step boundary)");
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
        db.get_workflow_run(&run_id)
            .map_err(|e| IpcError::Internal {
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
pub async fn workflow_run_delete(state: State<'_, AppState>, run_id: String) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        // Evict in-memory copy first so a concurrent active-runs poll
        // can't briefly resurrect what we're about to delete.
        runs.lock().remove(&run_id);
        if let Some(db) = db {
            db.delete_workflow_run(&run_id)
                .map_err(|e| IpcError::Internal {
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

#[derive(Debug, Clone, Serialize)]
pub struct HermesOneshotResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
    pub cli_available: bool,
}

#[tauri::command]
pub async fn hermes_oneshot(prompt: String) -> IpcResult<HermesOneshotResult> {
    tokio::task::spawn_blocking(move || -> IpcResult<HermesOneshotResult> {
        let binary = match crate::hermes_config::gateway::resolve_hermes_binary() {
            Ok(b) => b,
            Err(_) => {
                return Ok(HermesOneshotResult {
                    stdout: String::new(),
                    stderr: "hermes CLI not found".into(),
                    status: -1,
                    cli_available: false,
                })
            }
        };
        let mut cmd = std::process::Command::new(&binary);
        cmd.arg("-z").arg(&prompt);
        crate::hermes_config::suppress_window(&mut cmd);
        let output = cmd.output();
        match output {
            Ok(o) => Ok(HermesOneshotResult {
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
                status: o.status.code().unwrap_or(-1),
                cli_available: true,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HermesOneshotResult {
                stdout: String::new(),
                stderr: format!("hermes CLI not found: {e}"),
                status: -1,
                cli_available: false,
            }),
            Err(e) => Err(IpcError::Internal {
                message: format!("hermes -z spawn: {e}"),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_oneshot join: {e}"),
    })?
}
