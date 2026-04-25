use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow::model::{WorkflowDef, WorkflowSummary};
use crate::workflow::store::{self, ValidationError};

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
