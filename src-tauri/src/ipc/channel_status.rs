//! IPC for Phase 3 · T3.4 live channel status.
//!
//! Single command, cache-backed. `force=true` bypasses the 30s TTL
//! for the user's Refresh button. Heavy lifting happens in
//! `channel_status::ChannelStatusCache`; this wrapper just hops the
//! work off the Tokio worker so the IPC loop stays responsive.

use tauri::State;

use crate::channel_status::ChannelLiveStatus;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[tauri::command]
pub async fn hermes_channel_status_list(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> IpcResult<Vec<ChannelLiveStatus>> {
    let cache = state.channel_status.clone();
    let force = force.unwrap_or(false);
    tokio::task::spawn_blocking(move || cache.snapshot(force))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("channel status probe join: {e}"),
        })
}
