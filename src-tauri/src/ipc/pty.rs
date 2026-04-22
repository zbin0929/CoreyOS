//! Phase 4 · T4.5 — PTY IPC.
//!
//! The frontend supplies a caller-generated id (uuid string) and we
//! maintain a registry of `Arc<Pty>` keyed on it. Output bytes are
//! relayed via `pty:data:<id>` Tauri events as base64 strings — base64
//! keeps the wire clean regardless of any non-UTF-8 escape sequences
//! the shell emits (xterm.js decodes happily).

use tauri::{AppHandle, Emitter, State};

use crate::error::{IpcError, IpcResult};
use crate::pty as pty_mod;
use crate::state::AppState;

fn map_anyhow(e: anyhow::Error) -> IpcError {
    IpcError::Internal {
        message: e.to_string(),
    }
}

/// Spawn a new pty-wrapped shell. Returns the id the caller passed in
/// (echoed for parity with `chat_stream_start`). Emits
/// `pty:data:<id>` events with base64-encoded chunks of stdout as the
/// shell produces them.
#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    rows: u16,
    cols: u16,
) -> IpcResult<String> {
    // Reject duplicate ids so stale tabs can't stomp on new ones.
    if state.ptys.lock().contains_key(&id) {
        return Err(IpcError::Internal {
            message: format!("pty id {id} already exists"),
        });
    }

    let event = format!("pty:data:{id}");
    let app_for_cb = app.clone();
    let pty = pty_mod::spawn(rows, cols, move |bytes| {
        // base64-encode so the event payload stays clean ASCII; a
        // terminal stream is a stream of opaque bytes.
        let b64 = base64_encode(&bytes);
        let _ = app_for_cb.emit(&event, b64);
    })
    .map_err(map_anyhow)?;

    state.ptys.lock().insert(id.clone(), pty);
    Ok(id)
}

#[tauri::command]
pub async fn pty_write(state: State<'_, AppState>, id: String, data: String) -> IpcResult<()> {
    // `data` is UTF-8 from the frontend (keystrokes). xterm's onData
    // emits proper UTF-8; we don't need base64 this direction.
    let pty = state
        .ptys
        .lock()
        .get(&id)
        .cloned()
        .ok_or_else(|| IpcError::Internal {
            message: format!("unknown pty {id}"),
        })?;
    pty.write(data.as_bytes()).map_err(|e| IpcError::Internal {
        message: format!("pty write: {e}"),
    })?;
    Ok(())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    rows: u16,
    cols: u16,
) -> IpcResult<()> {
    let pty = state
        .ptys
        .lock()
        .get(&id)
        .cloned()
        .ok_or_else(|| IpcError::Internal {
            message: format!("unknown pty {id}"),
        })?;
    pty.resize(rows, cols).map_err(map_anyhow)
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, AppState>, id: String) -> IpcResult<()> {
    let pty = state
        .ptys
        .lock()
        .remove(&id)
        .ok_or_else(|| IpcError::Internal {
            message: format!("unknown pty {id}"),
        })?;
    pty.kill().map_err(map_anyhow)
}

// ─── base64 encoder ────────────────────────────────────────────────────
// Avoids pulling in the `base64` crate for a single tiny helper. Byte
// table is the canonical RFC 4648 alphabet.
fn base64_encode(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        let b2 = bytes[i + 2];
        out.push(A[(b0 >> 2) as usize] as char);
        out.push(A[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(A[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        out.push(A[(b2 & 0x3f) as usize] as char);
        i += 3;
    }
    let remaining = bytes.len() - i;
    if remaining == 1 {
        let b0 = bytes[i];
        out.push(A[(b0 >> 2) as usize] as char);
        out.push(A[((b0 & 0x03) << 4) as usize] as char);
        out.push('=');
        out.push('=');
    } else if remaining == 2 {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        out.push(A[(b0 >> 2) as usize] as char);
        out.push(A[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(A[((b1 & 0x0f) << 2) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64_encode;

    #[test]
    fn base64_matches_rfc_examples() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
