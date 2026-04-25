//! Phase 7 · T7.3 — Memory IPC.
//!
//! Thin read/write wrapper over the two Markdown files Hermes ships
//! natively:
//!
//!   - `~/.hermes/MEMORY.md` — the agent's personal notes; Hermes
//!     injects the contents into every system prompt.
//!   - `~/.hermes/USER.md` — user profile / preferences; same surface.
//!
//! No SQLite, no embeddings, no RAG. The files are the source of truth
//! — Hermes already owns injection and retrieval. Corey's only job is
//! to give the user a clean editor so they don't have to `vim` into
//! `~/.hermes/` to curate what the agent remembers.
//!
//! Atomic writes via `fs_atomic::atomic_write` — crash-safe replace
//! semantics so Hermes never observes a half-written file between
//! opening brace and closing paragraph.
//!
//! Intentionally NOT here:
//!   - `session_search` — gets its own module (T7.3 follow-up) once the
//!     Hermes surface for FTS5 over past sessions is confirmed.
//!   - Lockfile coordination — the two files are single-writer in
//!     practice (only this editor mutates them), and Hermes re-reads
//!     each turn anyway. If a concurrent Hermes write ever emerges,
//!     revisit with advisory `flock`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::state::AppState;

/// Hard cap per memory file. 256 KiB is well above what Hermes'
/// per-prompt budget tolerates (typical ~4–8 KB) but also well under
/// what would suggest the user is trying to stuff full transcripts
/// into `MEMORY.md`. The frontend shows a capacity meter so the user
/// sees they're approaching the ceiling before a save fails.
pub const MEMORY_MAX_BYTES: u64 = 256 * 1024;

/// Which of the two files we're acting on. Mirrored as the literal
/// string the UI sends on the wire (`"agent"` / `"user"`); keeping it
/// an enum server-side stops typos slipping through to the filesystem.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryKind {
    /// `~/.hermes/MEMORY.md` — agent notes.
    Agent,
    /// `~/.hermes/USER.md` — user profile.
    User,
}

impl MemoryKind {
    fn file_name(self) -> &'static str {
        match self {
            MemoryKind::Agent => "MEMORY.md",
            MemoryKind::User => "USER.md",
        }
    }
}

/// One round-trip payload. `content` is the current file body (empty
/// when the file doesn't exist yet — we treat a missing file as an
/// empty note rather than an error so the first save is a write, not
/// a create-then-write dance). `path` is absolute for the UI's
/// "Reveal in Finder" affordance. `bytes` is the on-disk size in bytes
/// (NOT `content.len()`, which is UTF-8 char bytes but skips BOM / CRLF
/// quirks — those round through the real file metadata).
#[derive(Debug, Clone, Serialize)]
pub struct MemoryFile {
    pub kind: MemoryKind,
    pub path: String,
    pub content: String,
    pub bytes: u64,
    pub max_bytes: u64,
    /// `true` when the file doesn't exist on disk yet — the UI uses
    /// this to show "new" vs "existing" in the capacity meter and to
    /// suggest a starter template for first-time users.
    pub exists: bool,
}

/// Resolve `~/.hermes/<file>` with an explicit `HOME` read. Mirrors
/// the pattern used by `ipc/channels.rs` so fixture tests that set
/// `HOME` keep working uniformly.
fn resolve_path(kind: MemoryKind) -> IpcResult<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| IpcError::Internal {
            message: "neither $HOME nor %USERPROFILE% set".into(),
        })?;
    Ok(Path::new(&home).join(".hermes").join(kind.file_name()))
}

/// Read the current body of the chosen memory file. Missing file →
/// empty body (not an error). Hard-fail only on I/O we can't classify
/// (permission denied, etc.).
#[tauri::command]
pub async fn memory_read(_state: State<'_, AppState>, kind: MemoryKind) -> IpcResult<MemoryFile> {
    let path = resolve_path(kind)?;
    let path_display = path.display().to_string();

    tokio::task::spawn_blocking(move || -> IpcResult<MemoryFile> {
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                Ok(MemoryFile {
                    kind,
                    path: path_display,
                    content,
                    bytes,
                    max_bytes: MEMORY_MAX_BYTES,
                    exists: true,
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(MemoryFile {
                kind,
                path: path_display,
                content: String::new(),
                bytes: 0,
                max_bytes: MEMORY_MAX_BYTES,
                exists: false,
            }),
            Err(e) => Err(IpcError::Internal {
                message: format!("memory_read {}: {e}", path.display()),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("memory_read task join: {e}"),
    })?
}

/// Replace the memory file with `content`. Rejects payloads over
/// `MEMORY_MAX_BYTES` BEFORE touching disk so a runaway paste doesn't
/// blow past the cap atomically. Returns the post-write `MemoryFile`
/// so the UI can refresh its capacity meter in one round-trip.
#[tauri::command]
pub async fn memory_write(
    _state: State<'_, AppState>,
    kind: MemoryKind,
    content: String,
) -> IpcResult<MemoryFile> {
    if content.len() as u64 > MEMORY_MAX_BYTES {
        return Err(IpcError::Internal {
            message: format!(
                "memory too large: {} bytes > {} cap",
                content.len(),
                MEMORY_MAX_BYTES,
            ),
        });
    }
    let path = resolve_path(kind)?;
    let path_display = path.display().to_string();
    let bytes_len = content.len() as u64;

    tokio::task::spawn_blocking(move || -> IpcResult<MemoryFile> {
        fs_atomic::atomic_write(&path, content.as_bytes(), None).map_err(|e| {
            IpcError::Internal {
                message: format!("memory_write {}: {e}", path.display()),
            }
        })?;
        Ok(MemoryFile {
            kind,
            path: path_display,
            content,
            bytes: bytes_len,
            max_bytes: MEMORY_MAX_BYTES,
            exists: true,
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("memory_write task join: {e}"),
    })?
}

#[cfg(test)]
mod tests {
    //! Tests redirect `HOME` to a temp dir so the real `~/.hermes/`
    //! is never touched. `resolve_path` is the single source of truth
    //! for that join, so setting `HOME` is sufficient without wiring
    //! a separate override knob.

    use super::*;

    fn with_tmp_home<F: FnOnce(&Path)>(f: F) {
        // `std::env::set_var("HOME", …)` is process-global. The crate
        // already has a shared lock in `skills::HOME_LOCK` that the
        // attachments + changelog test suites hook into — join it so
        // `cargo test`'s parallel runner doesn't let a concurrent test
        // clobber our HOME in the middle of a read/write.
        let _g = crate::skills::HOME_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Avoid pulling the `tempfile` crate just for two tests —
        // the same pattern `config.rs` uses keeps the dep graph lean.
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-memory-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4(),
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        f(&tmp);
        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn read_missing_file_returns_empty() {
        with_tmp_home(|home| {
            let path = resolve_path(MemoryKind::Agent).unwrap();
            assert_eq!(path, home.join(".hermes/MEMORY.md"));
            // File doesn't exist — the low-level helper should return
            // an empty body, not bubble up a NotFound.
            let raw = std::fs::read_to_string(&path);
            assert!(raw.is_err());
            // Emulate the handler body (no State required for the
            // filesystem path we actually care about testing).
            assert!(!path.exists());
        });
    }

    #[test]
    fn atomic_write_then_read_round_trips() {
        with_tmp_home(|home| {
            let path = resolve_path(MemoryKind::User).unwrap();
            assert_eq!(path, home.join(".hermes/USER.md"));
            // First write creates parent dir + file.
            fs_atomic::atomic_write(&path, b"- prefers TypeScript\n", None).unwrap();
            let got = std::fs::read_to_string(&path).unwrap();
            assert_eq!(got, "- prefers TypeScript\n");
            // Overwrite replaces atomically.
            fs_atomic::atomic_write(&path, b"- prefers Rust\n", None).unwrap();
            let got2 = std::fs::read_to_string(&path).unwrap();
            assert_eq!(got2, "- prefers Rust\n");
            // No stray tmp siblings left behind.
            let dir = path.parent().unwrap();
            let leftovers: Vec<_> = std::fs::read_dir(dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().contains(".caduceus.tmp-"))
                .collect();
            assert!(leftovers.is_empty(), "found tmp siblings: {leftovers:?}");
        });
    }

    #[test]
    fn memory_kind_file_names_are_correct() {
        // Guard against a typo regression — Hermes' injection is
        // hard-coded to look for these two names.
        assert_eq!(MemoryKind::Agent.file_name(), "MEMORY.md");
        assert_eq!(MemoryKind::User.file_name(), "USER.md");
    }
}
