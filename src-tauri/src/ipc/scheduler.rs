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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_from: Option<String>,
}

impl SchedulerJobView {
    fn from_hermes(job: &HermesJob, latest_run: Option<i64>) -> Self {
        let created_at = job.corey_created_at.unwrap_or(0);
        let updated_at = job.corey_updated_at.unwrap_or(created_at);
        Self {
            id: job.id.clone(),
            name: job.display_name().to_string(),
            cron_expression: job.schedule_display(),
            prompt: job.prompt.clone(),
            adapter_id: "hermes".into(),
            enabled: !job.paused,
            last_run_at: latest_run,
            last_run_ok: None,
            last_run_error: None,
            created_at,
            updated_at,
            workdir: job.workdir.clone(),
            context_from: job.context_from.clone(),
        }
    }
}

/// Wire shape for the scheduler upsert IPC. `adapter_id` is kept
/// in the struct for forward compat — Hermes is the only cron runner
/// in T6.8 so we ignore it today, but the field lets the frontend
/// keep sending its current payload without breaking deserialization
/// if we ever start routing cron through non-Hermes adapters.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SchedulerJobUpsert {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub cron_expression: String,
    pub prompt: String,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub workflow_id: Option<String>,
    #[serde(default)]
    pub workflow_inputs: Option<serde_json::Value>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub context_from: Option<String>,
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
        job.set_schedule_str(args.cron_expression.clone());
        job.prompt = args.prompt.clone();
        job.paused = !args.enabled;
        job.corey_created_at = job.corey_created_at.or(Some(now));
        job.corey_updated_at = Some(now);
        job.workflow_id = args.workflow_id.clone();
        job.workflow_inputs = args.workflow_inputs.clone();
        job.workdir = args.workdir.clone();
        job.context_from = args.context_from.clone();

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
    tokio::task::spawn_blocking(move || {
        hcron::list_runs(&job_id).map_err(|e| io_err("list_runs", e))
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("scheduler_list_runs join: {e}"),
    })?
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerIntent {
    pub detected: bool,
    pub cron_expression: String,
    pub suggested_name: String,
    pub prompt: String,
    pub confidence: f64,
}

#[tauri::command]
pub async fn scheduler_extract_intent(message: String) -> IpcResult<SchedulerIntent> {
    let lower = message.to_lowercase();
    let tokens: Vec<&str> = lower.split_whitespace().collect();
    let token_set: std::collections::HashSet<&str> = tokens.iter().copied().collect();

    let patterns: &[(&[&str], &str, f64)] = &[
        (&["每天", "早上", "8点"], "0 8 * * *", 0.9),
        (&["每天", "早上", "9点"], "0 9 * * *", 0.9),
        (&["每天", "早上"], "0 9 * * *", 0.7),
        (&["每天", "晚上", "8点"], "0 20 * * *", 0.9),
        (&["每天", "晚上", "9点"], "0 21 * * *", 0.9),
        (&["每天", "晚上"], "0 20 * * *", 0.7),
        (&["每天", "中午"], "0 12 * * *", 0.8),
        (&["每天", "定时"], "0 9 * * *", 0.6),
        (&["每天"], "0 9 * * *", 0.5),
        (&["每周一"], "0 9 * * 1", 0.8),
        (&["每周五"], "0 9 * * 5", 0.8),
        (&["每周", "一"], "0 9 * * 1", 0.7),
        (&["每周", "五"], "0 9 * * 5", 0.7),
        (&["每周"], "0 9 * * 1", 0.5),
        (&["每小时"], "0 * * * *", 0.8),
        (&["每", "小时"], "0 * * * *", 0.7),
        (&["每30分钟"], "*/30 * * * *", 0.8),
        (&["每", "分钟"], "*/5 * * * *", 0.6),
        (&["每小时", "整点"], "0 * * * *", 0.9),
        (&["every", "day", "morning"], "0 9 * * *", 0.8),
        (&["every", "day"], "0 9 * * *", 0.7),
        (&["every", "hour"], "0 * * * *", 0.8),
        (&["every", "week"], "0 9 * * 1", 0.7),
        (&["every", "monday"], "0 9 * * 1", 0.8),
        (&["every", "friday"], "0 9 * * 5", 0.8),
        (&["daily"], "0 9 * * *", 0.7),
        (&["hourly"], "0 * * * *", 0.7),
        (&["weekly"], "0 9 * * 1", 0.7),
        (&["cron"], "0 9 * * *", 0.4),
        (&["schedule", "daily"], "0 9 * * *", 0.6),
    ];

    let mut best_match: Option<(&str, f64)> = None;
    for (keywords, cron, confidence) in patterns {
        let matched = keywords.iter().all(|k| token_set.contains(k));
        if matched {
            if let Some((_, best_conf)) = best_match {
                if *confidence > best_conf {
                    best_match = Some((cron, *confidence));
                }
            } else {
                best_match = Some((cron, *confidence));
            }
        }
    }

    let Some((cron, confidence)) = best_match else {
        return Ok(SchedulerIntent {
            detected: false,
            cron_expression: String::new(),
            suggested_name: String::new(),
            prompt: String::new(),
            confidence: 0.0,
        });
    };

    let suggested_name: String = message.chars().take(30).collect();
    Ok(SchedulerIntent {
        detected: true,
        cron_expression: cron.to_string(),
        suggested_name,
        prompt: message.clone(),
        confidence,
    })
}
