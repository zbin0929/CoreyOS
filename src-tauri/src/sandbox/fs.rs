//! Sandbox-gated filesystem helpers.
//!
//! **All IPC commands touching disk must import from this module instead of
//! `std::fs` / `tokio::fs`.** A CI grep check enforces this (see
//! `scripts/check-sandbox-fs.mjs`).
//!
//! Both async (tokio) and blocking (std) variants are provided. Blocking
//! variants exist for IPC handlers that already run inside
//! `tokio::task::spawn_blocking` and would otherwise need to be rewritten
//! to be fully async (eg. YAML/ENV parsing pipelines).

use std::io;
use std::path::Path;

use super::{AccessOp, PathAuthority, SandboxResult};

/// Read a file into a String, gated by the sandbox.
///
/// Kept as part of the sandbox-FS API surface even though no
/// production caller uses it today (most IPC handlers run inside
/// `spawn_blocking` and prefer `read_to_string_blocking`). Deleting
/// it would force future async callers back to raw `tokio::fs`,
/// which the CI grep check would then flag. `allow(dead_code)` is
/// cheaper than that round-trip.
#[allow(dead_code)]
pub async fn read_to_string(authority: &PathAuthority, path: &Path) -> SandboxResult<String> {
    let canonical = authority.check(path, AccessOp::Read)?;
    tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| super::SandboxError::Canonicalize {
            path: canonical.display().to_string(),
            source: e,
        })
}

/// List directory entries, gated by the sandbox.
pub async fn read_dir_count(authority: &PathAuthority, path: &Path) -> SandboxResult<usize> {
    let canonical = authority.check(path, AccessOp::List)?;
    let mut rd =
        tokio::fs::read_dir(&canonical)
            .await
            .map_err(|e| super::SandboxError::Canonicalize {
                path: canonical.display().to_string(),
                source: e,
            })?;
    let mut count = 0usize;
    while rd
        .next_entry()
        .await
        .map_err(|e| super::SandboxError::Canonicalize {
            path: canonical.display().to_string(),
            source: e,
        })?
        .is_some()
    {
        count += 1;
    }
    Ok(count)
}

/// Write bytes to a file, gated by the sandbox.
/// Part of the sandbox-FS API surface; see `read_to_string` above.
#[allow(dead_code)]
pub async fn write(authority: &PathAuthority, path: &Path, bytes: &[u8]) -> SandboxResult<()> {
    let canonical = authority.check(path, AccessOp::Write)?;
    tokio::fs::write(&canonical, bytes)
        .await
        .map_err(|e| super::SandboxError::Canonicalize {
            path: canonical.display().to_string(),
            source: e,
        })
}

// ─────────────────── Blocking (std::fs) variants ───────────────────
//
// For callers running inside `tokio::task::spawn_blocking`. Returns
// `io::Result` instead of `SandboxResult` so existing error-handling
// pipelines (e.g. "NotFound → Ok(empty)") don't need rewriting. A
// sandbox denial surfaces as `io::ErrorKind::PermissionDenied`.

fn sandbox_err_to_io(e: super::SandboxError) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, e.to_string())
}

/// Blocking read of a file as a String, gated by the sandbox.
///
/// Missing files surface as `io::ErrorKind::NotFound` (unchanged from
/// `std::fs::read_to_string`). Sandbox denials surface as
/// `io::ErrorKind::PermissionDenied`.
pub fn read_to_string_blocking(authority: &PathAuthority, path: &Path) -> io::Result<String> {
    let canonical = authority.check(path, AccessOp::Read).map_err(sandbox_err_to_io)?;
    std::fs::read_to_string(&canonical)
}

/// Blocking write, gated by the sandbox.
/// Part of the sandbox-FS API surface; see `read_to_string` above.
/// Callers today route writes through `fs_atomic::atomic_write`
/// (which is rename-safe), but this helper remains the canonical
/// gateway for any non-atomic write that may land later.
#[allow(dead_code)]
pub fn write_blocking(authority: &PathAuthority, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let canonical = authority.check(path, AccessOp::Write).map_err(sandbox_err_to_io)?;
    std::fs::write(&canonical, bytes)
}
