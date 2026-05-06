//! IPC commands for the B-10.7 webhook trigger.
//!
//! `webhook_token_get` surfaces the auto-generated bearer token to
//! the Settings page so users can copy it into cron / IFTTT / IM
//! bot configurations. The token is generated lazily; if Settings
//! is opened before the MCP server's first start, we generate it
//! on demand here so the user doesn't have to wait for the
//! background bind to win the race.

use crate::error::{IpcError, IpcResult};
use crate::mcp_server::webhook;

/// Read or lazily generate the webhook bearer token. Errors only
/// when `~/.hermes` is unreachable (corrupt user dirs); in that
/// case the Settings UI surfaces "webhook unavailable" with the
/// underlying message.
#[tauri::command]
pub async fn webhook_token_get() -> IpcResult<String> {
    tokio::task::spawn_blocking(webhook::ensure_token)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("webhook_token_get join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("webhook token: {e}"),
        })
}

/// Resolve the bound port of the local MCP / webhook listener. Used
/// by Settings → Advanced → Webhook to print the full curl example.
/// Returns `None` if the listener hasn't finished binding yet
/// (cold-boot race) — the UI re-polls until it's `Some`.
#[tauri::command]
pub async fn webhook_listener_port() -> IpcResult<Option<u16>> {
    Ok(crate::mcp_server::bound_port())
}

/// Rotate the webhook token. Overwrites the file with a fresh UUID
/// and returns the new value. Triggered from Settings →
/// Advanced → Webhook → Rotate token. Anyone holding the old
/// token loses access on the next request.
#[tauri::command]
pub async fn webhook_token_rotate() -> IpcResult<String> {
    tokio::task::spawn_blocking(webhook::rotate_token)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("webhook_token_rotate join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("webhook token rotate: {e}"),
        })
}
