use crate::error::{IpcError, IpcResult};
use crate::workflow::browser_config::{self, BrowserConfig};

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
