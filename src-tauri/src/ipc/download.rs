//! Unified download center — manages file downloads with progress events.
//!
//! Provides `download_start`, `download_cancel`, and `download_list` IPC
//! commands. Downloads run on a tokio background task; progress is pushed
//! to the frontend via Tauri events:
//!
//!   - `download:progress`  { task_id, downloaded, total, speed_bps }
//!   - `download:completed` { task_id, path }
//!   - `download:error`     { task_id, message }

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub target_path: String,
    pub filename: String,
    pub label: String,
    pub status: DownloadStatus,
    pub downloaded: u64,
    pub total: u64,
    pub speed_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Completed,
    Error { message: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressPayload {
    task_id: String,
    downloaded: u64,
    total: u64,
    speed_bps: u64,
}

#[derive(Debug, Clone, Serialize)]
struct CompletedPayload {
    task_id: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorPayload {
    task_id: String,
    message: String,
}

pub struct DownloadManager {
    tasks: Mutex<HashMap<String, DownloadTask>>,
    cancel_tokens: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DownloadStartRequest {
    pub url: String,
    pub target_path: String,
    pub label: String,
}

#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, AppState>,
    req: DownloadStartRequest,
) -> IpcResult<String> {
    let task_id = Uuid::new_v4().to_string();
    let filename = req.url.rsplit('/').next().unwrap_or("download").to_string();

    let target = PathBuf::from(&req.target_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
            message: format!("create_dir_all: {e}"),
        })?;
    }

    let target_path = req.target_path.clone();
    let task = DownloadTask {
        id: task_id.clone(),
        url: req.url.clone(),
        target_path: req.target_path,
        filename: filename.clone(),
        label: req.label,
        status: DownloadStatus::Pending,
        downloaded: 0,
        total: 0,
        speed_bps: 0,
    };

    let manager = get_manager(&state);
    manager.tasks.lock().insert(task_id.clone(), task);
    let cancel_token = tokio_util::sync::CancellationToken::new();
    manager
        .cancel_tokens
        .lock()
        .insert(task_id.clone(), cancel_token.clone());

    let mgr = manager.clone();
    let app_clone = app.clone();
    let tid = task_id.clone();
    let url = req.url;
    let target_path_out = target_path.clone();

    tokio::spawn(async move {
        run_download(mgr, app_clone, tid, url, target_path_out, cancel_token).await;
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn download_cancel(state: State<'_, AppState>, task_id: String) -> IpcResult<()> {
    let manager = get_manager(&state);
    if let Some(token) = manager.cancel_tokens.lock().get(&task_id) {
        token.cancel();
    }
    if let Some(task) = manager.tasks.lock().get_mut(&task_id) {
        task.status = DownloadStatus::Cancelled;
    }
    Ok(())
}

#[tauri::command]
pub fn download_list(state: State<'_, AppState>) -> IpcResult<Vec<DownloadTask>> {
    let manager = get_manager(&state);
    let tasks: Vec<DownloadTask> = manager.tasks.lock().values().cloned().collect();
    Ok(tasks)
}

#[tauri::command]
pub fn download_clear_completed(state: State<'_, AppState>) -> IpcResult<()> {
    let manager = get_manager(&state);
    manager.tasks.lock().retain(|_, t| {
        !matches!(
            t.status,
            DownloadStatus::Completed | DownloadStatus::Cancelled
        )
    });
    Ok(())
}

fn get_manager(state: &AppState) -> Arc<DownloadManager> {
    state.download_manager.clone()
}

async fn run_download(
    manager: Arc<DownloadManager>,
    app: AppHandle,
    task_id: String,
    url: String,
    target_path: String,
    cancel_token: tokio_util::sync::CancellationToken,
) {
    {
        let mut tasks = manager.tasks.lock();
        if let Some(t) = tasks.get_mut(&task_id) {
            t.status = DownloadStatus::Downloading;
        }
    }

    let result = do_download(&manager, &app, &task_id, &url, &target_path, &cancel_token).await;

    match result {
        Ok(()) => {
            let mut tasks = manager.tasks.lock();
            if let Some(t) = tasks.get_mut(&task_id) {
                t.status = DownloadStatus::Completed;
            }
            manager.cancel_tokens.lock().remove(&task_id);
            let _ = app.emit(
                "download:completed",
                CompletedPayload {
                    task_id: task_id.clone(),
                    path: target_path,
                },
            );
            tracing::info!(task_id = %task_id, "download completed");
        }
        Err(e) => {
            let msg = format!("{e}");
            let mut tasks = manager.tasks.lock();
            if let Some(t) = tasks.get_mut(&task_id) {
                if matches!(t.status, DownloadStatus::Cancelled) {
                    return;
                }
                t.status = DownloadStatus::Error {
                    message: msg.clone(),
                };
            }
            manager.cancel_tokens.lock().remove(&task_id);
            let _ = app.emit(
                "download:error",
                ErrorPayload {
                    task_id: task_id.clone(),
                    message: msg,
                },
            );
            tracing::warn!(task_id = %task_id, error = %e, "download failed");
        }
    }
}

async fn do_download(
    manager: &Arc<DownloadManager>,
    app: &AppHandle,
    task_id: &str,
    url: &str,
    target_path: &str,
    cancel_token: &tokio_util::sync::CancellationToken,
) -> anyhow::Result<()> {
    use futures::StreamExt;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?;

    let resp = client.get(url).send().await?;

    if !resp.status().is_success() {
        anyhow::bail!("HTTP {}", resp.status());
    }

    let total = resp.content_length().unwrap_or(0);

    {
        let mut tasks = manager.tasks.lock();
        if let Some(t) = tasks.get_mut(task_id) {
            t.total = total;
        }
    }

    let mut file = tokio::fs::File::create(target_path).await?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_progress_time = std::time::Instant::now();
    let mut last_progress_bytes: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancel_token.is_cancelled() {
            tokio::fs::remove_file(target_path).await.ok();
            anyhow::bail!("cancelled");
        }

        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_progress_time);
        if elapsed >= std::time::Duration::from_millis(250) {
            let speed_bps = if elapsed.as_secs() > 0 {
                ((downloaded - last_progress_bytes) as f64 / elapsed.as_secs_f64()) as u64
            } else {
                0
            };

            {
                let mut tasks = manager.tasks.lock();
                if let Some(t) = tasks.get_mut(task_id) {
                    t.downloaded = downloaded;
                    t.speed_bps = speed_bps;
                }
            }

            let _ = app.emit(
                "download:progress",
                ProgressPayload {
                    task_id: task_id.to_string(),
                    downloaded,
                    total,
                    speed_bps,
                },
            );

            last_progress_time = now;
            last_progress_bytes = downloaded;
        }
    }

    file.flush().await?;

    {
        let mut tasks = manager.tasks.lock();
        if let Some(t) = tasks.get_mut(task_id) {
            t.downloaded = downloaded;
            t.speed_bps = 0;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_status_serializes() {
        let s = DownloadStatus::Downloading;
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("downloading"));
    }

    #[test]
    fn download_task_round_trip() {
        let task = DownloadTask {
            id: "test-id".into(),
            url: "https://example.com/file.zip".into(),
            target_path: "/tmp/file.zip".into(),
            filename: "file.zip".into(),
            label: "Test Download".into(),
            status: DownloadStatus::Pending,
            downloaded: 0,
            total: 1024,
            speed_bps: 0,
        };
        let json = serde_json::to_string(&task).unwrap();
        let back: DownloadTask = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "test-id");
        assert_eq!(back.total, 1024);
    }

    #[test]
    fn manager_new_is_empty() {
        let mgr = DownloadManager::new();
        assert!(mgr.tasks.lock().is_empty());
        assert!(mgr.cancel_tokens.lock().is_empty());
    }
}
