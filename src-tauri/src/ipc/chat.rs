use crate::error::{IpcError, IpcResult};

/// Phase 0 stub. Real streaming implementation in Phase 1 via
/// `adapters::hermes::gateway::stream_chat`, emitting `chat:delta:{handle}`
/// events. See `docs/phases/phase-1-chat.md` §T1.3.
#[tauri::command]
pub async fn chat_send_stub(_session_id: String, _message: String) -> IpcResult<u64> {
    Err(IpcError::Unsupported {
        capability: "chat_send in Phase 0".into(),
    })
}
