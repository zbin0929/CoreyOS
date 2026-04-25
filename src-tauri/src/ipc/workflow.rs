use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow::model::{WorkflowDef, WorkflowSummary};
use crate::workflow::store::{self, ValidationError};
use crate::workflow::engine::{self, WorkflowRun, RunStatus, StepRunStatus};

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
pub async fn workflow_run(
    state: State<'_, AppState>,
    id: String,
    inputs: serde_json::Value,
) -> IpcResult<String> {
    let wf_id = id.clone();
    let runs = state.workflow_runs.clone();

    let run_id = tokio::task::spawn_blocking(move || {
        let def = store::get(&wf_id)?;
        let result = engine::execute_sync(&def, inputs);
        let run = result.run;
        let rid = run.id.clone();
        runs.lock().insert(rid.clone(), run);
        anyhow::Ok(rid)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_run: {e}"),
    })?;

    Ok(run_id)
}

#[tauri::command]
pub async fn workflow_run_status(
    state: State<'_, AppState>,
    run_id: String,
) -> IpcResult<Option<WorkflowRun>> {
    let runs = state.workflow_runs.clone();
    let run = tokio::task::spawn_blocking(move || {
        runs.lock().get(&run_id).cloned()
    })
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

#[tauri::command]
pub async fn workflow_approve(
    state: State<'_, AppState>,
    params: ApproveParams,
) -> IpcResult<bool> {
    let runs = state.workflow_runs.clone();
    tokio::task::spawn_blocking(move || {
        let mut map = runs.lock();
        if let Some(run) = map.get_mut(&params.run_id) {
            if let Some(sr) = run.step_runs.get_mut(&params.step_id) {
                sr.status = StepRunStatus::Completed;
                sr.output = Some(serde_json::json!({
                    "approved": params.approved,
                    "feedback": params.feedback,
                }));
            }
            return Ok(true);
        }
        Ok(false)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("workflow_approve join: {e}"),
    })?
    .map_err(|e: anyhow::Error| IpcError::Internal {
        message: format!("workflow_approve: {e}"),
    })
}
