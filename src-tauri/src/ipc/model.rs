use tauri::State;

use crate::adapters::ModelInfo;
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[tauri::command]
pub async fn model_list(state: State<'_, AppState>) -> IpcResult<Vec<ModelInfo>> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;
    adapter.list_models().await.map_err(Into::into)
}
