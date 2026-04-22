//! WeChat QR IPC (Phase 3 · T3.3).
//!
//! Three thin commands wire the frontend polling loop to the
//! `QrProvider` trait held in `AppState`:
//!
//!   - `wechat_qr_start` — mint a new session, return the SVG the UI
//!     paints inline + the opaque session id.
//!   - `wechat_qr_poll` — advance / read the state machine. Called
//!     on a 2s frontend timer; cheap to call (provider-local state).
//!   - `wechat_qr_cancel` — explicit user cancel. Idempotent.
//!
//! No other command should touch the provider directly — the tight
//! surface means the real iLink implementation is a drop-in behind
//! the trait without UI-side changes.

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::state::AppState;
use crate::wechat::{QrError, QrPollResponse, QrStartResponse};

/// Start a fresh QR session. The UI throws away the previous id (if
/// any) — we don't GC expired sessions eagerly; stale ones just
/// linger in-memory until the next restart. Fine for a 5-min TTL.
#[tauri::command]
pub async fn wechat_qr_start(state: State<'_, AppState>) -> IpcResult<QrStartResponse> {
    let provider = state.wechat.provider();
    provider.start().await.map_err(qr_err_to_ipc)
}

/// Read / advance session state. The stub advances on each call; a
/// real iLink impl will forward to Tencent here. Either way the UI
/// treats `status.is_terminal()` as "stop polling".
#[tauri::command]
pub async fn wechat_qr_poll(
    qr_id: String,
    state: State<'_, AppState>,
) -> IpcResult<QrPollResponse> {
    let provider = state.wechat.provider();
    provider.poll(&qr_id).await.map_err(qr_err_to_ipc)
}

/// User-initiated cancel. Idempotent — calling twice returns Ok.
#[tauri::command]
pub async fn wechat_qr_cancel(qr_id: String, state: State<'_, AppState>) -> IpcResult<()> {
    let provider = state.wechat.provider();
    provider.cancel(&qr_id).await.map_err(qr_err_to_ipc)
}

/// Map the provider's error taxonomy onto the frontend envelope.
/// `NotFound` is a real user-path event (e.g. backend restarted
/// mid-poll) so we surface it as `Internal` with a stable message
/// the UI can match on if it ever wants bespoke copy.
fn qr_err_to_ipc(e: QrError) -> IpcError {
    match e {
        QrError::NotFound { qr_id } => IpcError::Internal {
            message: format!("qr session expired: {qr_id}"),
        },
        QrError::Backend(msg) => IpcError::Internal { message: msg },
        QrError::Io(e) => IpcError::Internal {
            message: format!("io: {e}"),
        },
    }
}
