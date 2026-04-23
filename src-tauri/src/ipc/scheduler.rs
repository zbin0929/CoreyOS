//! Scheduler IPC — T6.8 refactor (2026-04-23 pm).
//!
//! Before T6.8 this module CRUD'd rows in our own `scheduler_jobs`
//! SQLite table and kicked a Rust worker (`src-tauri/src/scheduler.rs`)
//! that ran cron in-process. Both are gone: Hermes natively owns cron
//! (`~/.hermes/cron/jobs.json` + gateway process), so Corey's job is
//! just to GUI-edit that file and surface run outputs.
//!
//! The IPC wire shape (`SchedulerJob`, `SchedulerJobUpsert`,
//! `SchedulerValidateResult`) is preserved so the existing Scheduler
//! page needs no restructuring — under the hood we translate to
//! `HermesJob` (see `crate::hermes_cron`).
//!
//! New command: `scheduler_list_runs` surfaces the markdown run logs
//! Hermes drops under `~/.hermes/cron/output/{job_id}/`. This is the
//! one capability only Corey provides — a GUI browser for cron output.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_cron::{self as hcron, HermesJob, RunInfo};
use crate::state::AppState;

/// Wire shape returned to the frontend. Kept identical to the pre-T6.8
/// `SchedulerJob` so `src/features/scheduler/index.tsx` is unchanged.
/// The `last_run_*` fields are synthesized from the filesystem (the
/// latest `.md` in the job's `output/` subtree), which gives us
/// best-effort observability even though Hermes doesn't stamp them
/// into `jobs.json` itself.
#[derive(Debug, Clone, Serialize)]
pub struct SchedulerJobView {
    pub id: String,
    pub name: String,
    /// Renamed on the wire as `cron_expression` for UI compat. In
    /// Hermes's schema this is `schedule` and accepts more than cron
    /// (`"30m"`, `"every 2h"`, ISO timestamps, classic cron).
    pub cron_expression: String,
    pub prompt: String,
    /// Always `"hermes"` post-T6.8 — Hermes is the only backend that
    /// runs cron jobs, and we don't model per-instance selection yet.
    /// Kept in the shape for forward-compat with T6.2 multi-instance.
    pub adapter_id: String,
    pub enabled: bool,
    pub last_run_at: Option<i64>,
    /// Hermes doesn't record success/failure in `jobs.json`; without a
    /// structured runs index we can't reliably distinguish. Always
    /// `None` for now. A future enhancement can parse run file
    /// frontmatter (Hermes writes a YAML header with a status field)
    /// but that's a polish pass, not T6.8.
    pub last_run_ok: Option<bool>,
    pub last_run_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SchedulerJobView {
    fn from_hermes(job: &HermesJob, latest_run: Option<i64>) -> Self {
        let created_at = job.corey_created_at.unwrap_or_else(|| 0);
        let updated_at = job.corey_updated_at.unwrap_or(created_at);
        Self {
            id: job.id.clone(),
            name: job.display_name().to_string(),
            cron_expression: job.schedule.clone(),
            prompt: job.prompt.clone(),
            adapter_id: "hermes".into(),
            enabled: !job.paused,
            last_run_at: latest_run,
            last_run_ok: None,
            last_run_error: None,
            created_at,
            updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SchedulerJobUpsert {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub cron_expression: String,
    pub prompt: String,
    /// Kept for forward-compat; ignored in T6.8 (only `hermes` runs cron).
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerValidateResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_fire_at: Option<i64>,
    /// `true` when the schedule parsed as classic cron. `false` means
    /// it might still be valid Hermes syntax (`"every 2h"`, `"30m"`,
    /// ISO timestamp) but we can't preview next fire locally — Hermes
    /// will compute it at runtime.
    #[serde(default)]
    pub is_cron: bool,
}

// ───────────────────────── Helpers ─────────────────────────

/// Peek at the newest run file's mtime for a job. `None` if no runs yet.
fn latest_run_mtime(job_id: &str) -> Option<i64> {
    hcron::list_runs(job_id)
        .ok()
        .and_then(|runs| runs.first().map(|r| r.modified_at))
}

fn io_err(context: &str, e: std::io::Error) -> IpcError {
    IpcError::Internal {
        message: format!("{context}: {e}"),
    }
}

// ───────────────────────── Commands ─────────────────────────

#[tauri::command]
pub async fn scheduler_list_jobs(_state: State<'_, AppState>) -> IpcResult<Vec<SchedulerJobView>> {
    tokio::task::spawn_blocking(|| {
        let jobs = hcron::load_jobs().map_err(|e| io_err("load_jobs", e))?;
        Ok::<_, IpcError>(
            jobs.iter()
                .map(|j| {
                    let latest = latest_run_mtime(&j.id);
                    SchedulerJobView::from_hermes(j, latest)
                })
                .collect(),
        )
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("scheduler_list_jobs join: {e}"),
    })?
}

#[tauri::command]
pub async fn scheduler_upsert_job(
    _state: State<'_, AppState>,
    args: SchedulerJobUpsert,
) -> IpcResult<SchedulerJobView> {
    if args.name.trim().is_empty() {
        return Err(IpcError::Internal {
            message: "name must not be empty".into(),
        });
    }
    if args.prompt.trim().is_empty() {
        return Err(IpcError::Internal {
            message: "prompt must not be empty".into(),
        });
    }
    // Reject clearly-empty schedules; Hermes rejects them too. Non-cron
    // forms (`"30m"`, `"every 2h"`, ISO) pass through — Hermes validates
    // at runtime.
    if args.cron_expression.trim().is_empty() {
        return Err(IpcError::Internal {
            message: "schedule must not be empty".into(),
        });
    }

    tokio::task::spawn_blocking(move || {
        let mut jobs = hcron::load_jobs().map_err(|e| io_err("load_jobs", e))?;

        let now = hcron::now_unix();
        let id = args.id.clone().unwrap_or_else(hcron::new_job_id);

        // If updating, start from the existing record so we preserve
        // Hermes-set fields (skills, per-job model override, `extra`).
        let existing = jobs.iter().find(|j| j.id == id).cloned();
        let mut job = existing.unwrap_or_else(|| HermesJob {
            id: id.clone(),
            corey_created_at: Some(now),
            ..HermesJob::default()
        });
        // Apply the UI patch.
        job.id = id.clone();
        job.name = Some(args.name.clone());
        job.schedule = args.cron_expression.clone();
        job.prompt = args.prompt.clone();
        job.paused = !args.enabled;
        job.corey_created_at = job.corey_created_at.or(Some(now));
        job.corey_updated_at = Some(now);

        // Upsert back into the list.
        if let Some(slot) = jobs.iter_mut().find(|j| j.id == id) {
            *slot = job.clone();
        } else {
            jobs.push(job.clone());
        }
        hcron::save_jobs(&jobs).map_err(|e| io_err("save_jobs", e))?;

        let latest = latest_run_mtime(&id);
        Ok::<_, IpcError>(SchedulerJobView::from_hermes(&job, latest))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("scheduler_upsert_job join: {e}"),
    })?
}

#[tauri::command]
pub async fn scheduler_delete_job(_state: State<'_, AppState>, id: String) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || hcron::delete_job(&id).map_err(|e| io_err("delete_job", e)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("scheduler_delete_job join: {e}"),
        })?
}

/// Preview a schedule expression. Cron forms get a concrete next-fire
/// time; Hermes-extended forms (`"every 2h"`, ISO) return `ok: true`
/// + `is_cron: false` + `next_fire_at: None` — the UI should render
/// "next fire: (handled by Hermes)" or similar.
#[tauri::command]
pub async fn scheduler_validate_cron(expression: String) -> IpcResult<SchedulerValidateResult> {
    match hcron::inspect_schedule(&expression, chrono::Utc::now()) {
        Ok((is_cron, next)) => Ok(SchedulerValidateResult {
            ok: true,
            error: None,
            next_fire_at: next.map(|t| t.timestamp()),
            is_cron,
        }),
        Err(e) => Ok(SchedulerValidateResult {
            ok: false,
            error: Some(e),
            next_fire_at: None,
            is_cron: false,
        }),
    }
}

/// NEW in T6.8: list the most-recent run outputs for a job. Feeds the
/// "Runs" drawer on the Scheduler page.
#[tauri::command]
pub async fn scheduler_list_runs(
    _state: State<'_, AppState>,
    job_id: String,
) -> IpcResult<Vec<RunInfo>> {
    tokio::task::spawn_blocking(move || hcron::list_runs(&job_id).map_err(|e| io_err("list_runs", e)))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("scheduler_list_runs join: {e}"),
        })?
}

// Suppress unused-import warning for `UNIX_EPOCH` / `SystemTime` during
// CI strict builds: the helpers above may eventually need them for
// frontmatter-parsed success/failure fields (see `last_run_ok` note).
// Keep the imports so future reviewers see the intent.
#[allow(dead_code)]
fn _retain_time_imports() {
    let _ = SystemTime::now();
    let _ = UNIX_EPOCH;
}
