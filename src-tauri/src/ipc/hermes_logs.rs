//! IPC for tailing Hermes's rolling log files (`~/.hermes/logs/*.log`).
//! See `crate::hermes_logs` for the core read logic; this file is just a
//! Tauri-compatible wrapper that validates inputs and caps work units.

use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_logs::{tail_log, LogKind, LogTail};
use crate::state::AppState;

/// Hard cap on `max_lines` so a rogue UI can't ask for millions of lines.
/// 5k is plenty for debugging; the default is 500.
const MAX_LINES_CEILING: usize = 5_000;
const DEFAULT_MAX_LINES: usize = 500;

/// Tail the requested Hermes log file. `kind` is `"agent" | "gateway" | "error"`
/// (deserialized lower-case). `max_lines` is optional — when absent we
/// return the last 500 lines, and any value above 5000 is silently clamped.
#[tauri::command]
pub async fn hermes_log_tail(
    _state: State<'_, AppState>,
    kind: LogKind,
    max_lines: Option<usize>,
) -> IpcResult<LogTail> {
    let n = max_lines
        .unwrap_or(DEFAULT_MAX_LINES)
        .clamp(1, MAX_LINES_CEILING);

    // `tail_log` does blocking file I/O. Log files are tiny so this is
    // cheap, but still hop off the Tokio worker to keep the UI's IPC
    // loop snappy under load.
    tokio::task::spawn_blocking(move || tail_log(kind, n))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("log tail task join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("read log: {e}"),
        })
}
