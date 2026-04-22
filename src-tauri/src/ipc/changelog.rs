//! Changelog journal IPC.
//!
//! `changelog_list` reads the journal newest-first for display.
//!
//! `changelog_revert(id)` dispatches by the entry's `op` field back to the
//! adapter module that originally wrote. Each revert is itself journaled
//! (as a new entry with op `<orig>.revert`), so the history is append-only
//! forever — reverts can themselves be reverted.
//!
//! **Not everything is revertible.** `hermes.env.key` entries only record
//! presence (never the secret value), so undoing a key deletion is literally
//! impossible — we return a clear error rather than pretending.

use tauri::State;

use crate::changelog::{self, Entry};
use crate::error::{IpcError, IpcResult};
use crate::hermes_config::{self, HermesModelSection};
use crate::state::AppState;

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

#[tauri::command]
pub async fn changelog_list(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> IpcResult<Vec<Entry>> {
    let lim = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let path = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || changelog::tail(&path, lim))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("changelog join: {e}"),
        })?
        .map_err(|e| IpcError::Internal {
            message: format!("read changelog: {e}"),
        })
}

/// Returned so the UI can immediately refresh its list without a separate
/// `changelog_list` round-trip.
#[derive(Debug, serde::Serialize)]
pub struct RevertReport {
    /// The fresh entry we just appended describing the revert itself.
    pub revert_entry: Entry,
}

#[tauri::command]
pub async fn changelog_revert(
    entry_id: String,
    state: State<'_, AppState>,
) -> IpcResult<RevertReport> {
    let path = state.changelog_path.clone();

    // Blocking I/O + potentially a YAML write — off the async executor.
    tokio::task::spawn_blocking(move || -> IpcResult<RevertReport> {
        let entry = changelog::find(&path, &entry_id)
            .map_err(|e| IpcError::Internal {
                message: format!("lookup entry: {e}"),
            })?
            .ok_or_else(|| IpcError::NotConfigured {
                hint: format!("changelog entry not found: {entry_id}"),
            })?;

        match entry.op.as_str() {
            "hermes.config.model" => {
                // Restore `before` into hermes config.yaml. When `before` is
                // absent (creation entry), an empty model section is the
                // right inverse.
                let before_model: HermesModelSection = match entry.before {
                    Some(v) => serde_json::from_value(v).map_err(|e| IpcError::Protocol {
                        detail: format!("malformed before-state: {e}"),
                    })?,
                    None => HermesModelSection::default(),
                };
                hermes_config::write_model(&before_model, Some(&path)).map_err(|e| {
                    IpcError::Internal {
                        message: format!("revert write_model: {e}"),
                    }
                })?;
                // Latest entry on disk is the revert we just appended.
                let latest = changelog::tail(&path, 1)
                    .map_err(|e| IpcError::Internal {
                        message: format!("read back revert: {e}"),
                    })?
                    .into_iter()
                    .next()
                    .ok_or_else(|| IpcError::Internal {
                        message: "revert appended but journal empty".into(),
                    })?;
                Ok(RevertReport {
                    revert_entry: latest,
                })
            }
            "hermes.env.key" => Err(IpcError::Unsupported {
                capability: "env key revert (secret not retained)".into(),
            }),
            other => Err(IpcError::Unsupported {
                capability: format!("revert for op: {other}"),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("revert join: {e}"),
    })?
}
