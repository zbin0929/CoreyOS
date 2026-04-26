use crate::error::{IpcError, IpcResult};
use crate::workflow::browser_config::{self, BrowserConfig};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserDiagResult {
    pub node_available: bool,
    pub node_version: Option<String>,
    pub runner_found: bool,
    pub runner_path: Option<String>,
    pub browser_config_set: bool,
    pub browser_model_set: bool,
}

pub fn find_browser_runner() -> std::path::PathBuf {
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

#[tauri::command]
pub async fn browser_diagnose() -> IpcResult<BrowserDiagResult> {
    tokio::task::spawn_blocking(|| {
        let node_output = std::process::Command::new("node").arg("--version").output();
        let (node_available, node_version) = match node_output {
            Ok(o) if o.status.success() => {
                let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                (true, Some(v))
            }
            _ => (false, None),
        };

        let runner = find_browser_runner();
        let runner_found = runner.exists();

        let cfg = browser_config::load();
        let browser_config_set = !cfg.model.is_empty() || !cfg.base_url.is_empty();
        let browser_model_set = !cfg.model.is_empty();

        BrowserDiagResult {
            node_available,
            node_version,
            runner_found,
            runner_path: Some(runner.to_string_lossy().to_string()),
            browser_config_set,
            browser_model_set,
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("browser_diagnose join: {e}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_browser_diag_result_serializes_expected_fields() {
        let diag = BrowserDiagResult {
            node_available: true,
            node_version: Some("v20.0.0".into()),
            runner_found: false,
            runner_path: Some("/path/to/runner".into()),
            browser_config_set: true,
            browser_model_set: true,
        };
        let val = serde_json::to_value(&diag).unwrap();
        assert!(
            val.get("node_available").is_some(),
            "missing node_available"
        );
        assert!(val.get("node_version").is_some(), "missing node_version");
        assert!(val.get("runner_found").is_some(), "missing runner_found");
        assert!(val.get("runner_path").is_some(), "missing runner_path");
        assert!(
            val.get("browser_config_set").is_some(),
            "missing browser_config_set"
        );
        assert!(
            val.get("browser_model_set").is_some(),
            "missing browser_model_set"
        );
        assert_eq!(val["node_available"], true);
        assert_eq!(val["runner_found"], false);
    }
}
