//! Sandbox-gated filesystem helpers.
//!
//! **All IPC commands touching disk must import from this module instead of
//! `std::fs` / `tokio::fs`.** A CI grep check will enforce this once the
//! lint story lands; for now it is enforced by code review.

use std::path::Path;

use super::{AccessOp, PathAuthority, SandboxResult};

/// Read a file into a String, gated by the sandbox.
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
    let mut rd = tokio::fs::read_dir(&canonical)
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
pub async fn write(authority: &PathAuthority, path: &Path, bytes: &[u8]) -> SandboxResult<()> {
    let canonical = authority.check(path, AccessOp::Write)?;
    tokio::fs::write(&canonical, bytes)
        .await
        .map_err(|e| super::SandboxError::Canonicalize {
            path: canonical.display().to_string(),
            source: e,
        })
}
