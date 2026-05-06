//! IPC for the vision proxy (B). Three commands:
//!
//! - `vision_proxy_get` — read config (or defaults if file missing)
//! - `vision_proxy_set` — overwrite config (atomic write)
//! - `vision_proxy_clear_cache` — empty `~/.hermes/vision_cache/`
//!   so the user can force-redescribe after changing the model.

use crate::error::{IpcError, IpcResult};
use crate::vision_proxy::{self, VisionProxyConfig};

#[tauri::command]
pub async fn vision_proxy_get() -> IpcResult<VisionProxyConfig> {
    tokio::task::spawn_blocking(vision_proxy::load)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("vision_proxy_get join: {e}"),
        })
}

#[tauri::command]
pub async fn vision_proxy_set(config: VisionProxyConfig) -> IpcResult<()> {
    tokio::task::spawn_blocking(move || vision_proxy::save(&config))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("vision_proxy_set join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("vision_proxy save: {e}"),
        })
}

#[tauri::command]
pub async fn vision_proxy_clear_cache() -> IpcResult<u32> {
    tokio::task::spawn_blocking(|| -> std::io::Result<u32> {
        let dir = crate::paths::hermes_data_dir()?.join("vision_cache");
        if !dir.exists() {
            return Ok(0);
        }
        let mut count = 0u32;
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let _ = std::fs::remove_file(entry.path());
                count += 1;
            }
        }
        Ok(count)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("vision_proxy_clear_cache join: {e}"),
    })?
    .map_err(|e| IpcError::Internal {
        message: format!("vision_proxy_clear_cache: {e}"),
    })
}
