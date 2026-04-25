use serde::{Deserialize, Serialize};
use tauri::State;

use crate::adapters::{ChatMessageDto, ChatTurn};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::workflow::browser_config::{self, BrowserConfig};
use crate::workflow::engine::{self, StepExecutor, WorkflowRun};
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

fn find_browser_runner() -> std::path::PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let exe_dir = exe
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();

    let candidates: Vec<std::path::PathBuf> = vec![
        exe_dir.join("scripts/browser-runner"),
        exe_dir.join("../scripts/browser-runner"),
        exe_dir.join("../../scripts/browser-runner"),
        exe_dir.join("../../../scripts/browser-runner"),
        exe_dir.join("scripts/browser-runner.cjs"),
        exe_dir.join("../scripts/browser-runner.cjs"),
        exe_dir.join("../../scripts/browser-runner.cjs"),
        exe_dir.join("../../../scripts/browser-runner.cjs"),
        std::path::PathBuf::from("../scripts/browser-runner.cjs"),
    ];
    for p in &candidates {
        if p.exists() {
            return p.canonicalize().unwrap_or_else(|_| p.clone());
        }
    }
    exe_dir.join("scripts/browser-runner")
}

struct HermesExecutor {
    adapters: std::sync::Arc<crate::adapters::AdapterRegistry>,
}

impl StepExecutor for HermesExecutor {
    fn execute_agent(&self, agent_id: &str, prompt: &str) -> Result<String, String> {
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

    fn execute_browser(
        &self,
        action: &str,
        url: &str,
        instruction: &str,
        profile: &str,
    ) -> Result<String, String> {
        use std::process::Command;

        let cfg = browser_config::load();

        let script_path = find_browser_runner();
        let is_binary = script_path.extension().is_some_and(|e| e == "exe")
            || !script_path.extension().is_some_and(|e| e == "cjs");

        let task = serde_json::json!({
            "action": action,
            "url": url,
            "instruction": instruction,
            "profile": if profile.is_empty() { "" } else { profile },
        });

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
        if !cfg.api_key.is_empty() {
            cmd.env("BROWSER_LLM_API_KEY", &cfg.api_key);
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
            return Err(format!("browser-runner failed: {}{}", stdout, stderr));
        }

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
    let adapters = state.adapters.clone();

    let def = tokio::task::spawn_blocking(move || store::get(&wf_id))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("workflow_run load: {e}"),
        })?;

    let (run, mut ctx) = engine::create_initial_run(&def, inputs);
    let run_id = run.id.clone();
    runs.lock().insert(run_id.clone(), run);

    let cloned_runs = runs.clone();
    let rid_for_log = run_id.clone();
    let rid_return = run_id.clone();
    tokio::task::spawn_blocking(move || {
        let executor = HermesExecutor { adapters };
        if let Some(r) = cloned_runs.lock().get_mut(&run_id) {
            engine::execute_with_executor(&def, r, &mut ctx, &executor);
        }
        tracing::info!(wf_id = %def.id, run_id = %rid_for_log, status = ?cloned_runs.lock().get(&rid_for_log).map(|r| &r.status), "workflow run finished");
    });

    Ok(rid_return)
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
                sr.status = engine::StepRunStatus::Completed;
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

#[tauri::command]
pub async fn workflow_active_runs(
    state: State<'_, AppState>,
) -> IpcResult<Vec<WorkflowRun>> {
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

#[tauri::command]
pub async fn browser_config_get() -> IpcResult<BrowserConfig> {
    let cfg = tokio::task::spawn_blocking(browser_config::load)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("browser_config_get join: {e}"),
        })?;
    Ok(cfg)
}

#[tauri::command]
pub async fn browser_config_set(config: BrowserConfig) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || browser_config::save(&config))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("browser_config_set join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("browser_config_set: {e}"),
        })
}
