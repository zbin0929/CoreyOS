use tauri::State;

use crate::adapters::Health;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[tauri::command]
pub async fn health_check(state: State<'_, AppState>) -> IpcResult<Health> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;
    adapter.health().await.map_err(Into::into)
}
