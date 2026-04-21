use tauri::State;

use crate::adapters::{Session, SessionId, SessionQuery};
use crate::error::{IpcError, IpcResult};
use crate::state::AppState;

#[tauri::command]
pub async fn session_list(
    state: State<'_, AppState>,
    query: Option<SessionQuery>,
) -> IpcResult<Vec<Session>> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;
    adapter
        .list_sessions(query.unwrap_or_default())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn session_get(state: State<'_, AppState>, id: SessionId) -> IpcResult<Session> {
    let adapter = state
        .adapters
        .default_adapter()
        .ok_or_else(|| IpcError::NotConfigured {
            hint: "no default adapter registered".into(),
        })?;
    adapter.get_session(&id).await.map_err(Into::into)
}
