//! Scheduler IPC — CRUD for cron-driven prompt runs.
//!
//! See `src-tauri/src/scheduler.rs` for the worker model. These commands
//! just shuffle rows into / out of SQLite and signal the worker to
//! reload after any write.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Db, SchedulerJobRow};
use crate::error::{IpcError, IpcResult};
use crate::scheduler as sched;
use crate::state::AppState;

fn db_of(state: &AppState) -> IpcResult<Arc<Db>> {
    state.db.clone().ok_or_else(|| IpcError::NotConfigured {
        hint: "database not initialized".into(),
    })
}

fn reload_worker(state: &AppState) {
    if let Some(s) = &state.scheduler {
        s.reload();
    }
}

/// Payload for `scheduler_upsert_job`. Absent `id` = create new; present
/// `id` = update in place. Validation of `cron_expression` happens here
/// so the frontend gets an inline error rather than a silent swallow.
#[derive(Debug, Clone, Deserialize)]
pub struct SchedulerJobUpsert {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub cron_expression: String,
    pub prompt: String,
    #[serde(default = "default_adapter")]
    pub adapter_id: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_adapter() -> String {
    "hermes".into()
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerValidateResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Unix seconds of the next fire time computed from `now`. `None`
    /// when `ok` is false or when the schedule produces no future fires.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_fire_at: Option<i64>,
}

#[tauri::command]
pub async fn scheduler_list_jobs(state: State<'_, AppState>) -> IpcResult<Vec<SchedulerJobRow>> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.list_scheduler_jobs())
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db list_scheduler_jobs: {e}"),
        })
}

#[tauri::command]
pub async fn scheduler_upsert_job(
    state: State<'_, AppState>,
    args: SchedulerJobUpsert,
) -> IpcResult<SchedulerJobRow> {
    // Reject empty required fields early — friendlier than a SQL constraint.
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
    if let Err(e) = sched::validate_cron(&args.cron_expression) {
        return Err(IpcError::Internal {
            message: format!("invalid cron expression: {e}"),
        });
    }

    let db = db_of(&state)?;
    let now = sched::now_unix();
    let id = args.id.unwrap_or_else(sched::new_job_id);
    let row = SchedulerJobRow {
        id: id.clone(),
        name: args.name,
        cron_expression: args.cron_expression,
        prompt: args.prompt,
        adapter_id: args.adapter_id,
        enabled: args.enabled,
        last_run_at: None,
        last_run_ok: None,
        last_run_error: None,
        created_at: now,
        updated_at: now,
    };

    let row_clone = row.clone();
    tokio::task::spawn_blocking(move || db.upsert_scheduler_job(&row_clone))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db upsert_scheduler_job: {e}"),
        })?;

    reload_worker(&state);
    Ok(row)
}

#[tauri::command]
pub async fn scheduler_delete_job(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let db = db_of(&state)?;
    tokio::task::spawn_blocking(move || db.delete_scheduler_job(&id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("db task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("db delete_scheduler_job: {e}"),
        })?;
    reload_worker(&state);
    Ok(())
}

/// Preview a cron expression: returns whether it parses, plus the next
/// fire time for the UI to show as a sanity check ("next run: tomorrow
/// at 09:00"). Pure — never writes to DB.
#[tauri::command]
pub async fn scheduler_validate_cron(
    expression: String,
) -> IpcResult<SchedulerValidateResult> {
    match sched::validate_cron(&expression) {
        Ok(()) => {
            let next = sched::next_fire_after(&expression, chrono::Utc::now())
                .map(|t| t.timestamp());
            Ok(SchedulerValidateResult {
                ok: true,
                error: None,
                next_fire_at: next,
            })
        }
        Err(e) => Ok(SchedulerValidateResult {
            ok: false,
            error: Some(e),
            next_fire_at: None,
        }),
    }
}
