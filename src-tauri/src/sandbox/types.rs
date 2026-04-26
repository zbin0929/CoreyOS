//! Data shapes for the sandbox layer — access modes, ops, roots,
//! scopes, the unified error enum, and the always-present default
//! scope id.
//!
//! This module is pure data + small validators; no I/O, no state.
//! The runtime gate lives in [`super::authority`].

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Stable id of the always-present "default" sandbox scope. Every legacy
/// adapter and every IPC command that doesn't know about scopes resolves
/// to this one; T6.5 per-agent scoping opts in by pointing a
/// `HermesInstance` at a different scope id.
pub const DEFAULT_SCOPE_ID: &str = "default";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessMode {
    Read,
    ReadWrite,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessOp {
    Read,
    Write,
    List,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceRoot {
    /// Canonical absolute path. Always stored canonicalized.
    pub path: PathBuf,
    /// Human label used in UI.
    pub label: String,
    pub mode: AccessMode,
}

/// T6.5 — a named collection of `WorkspaceRoot`s. Each Hermes instance
/// (and any other adapter that grows a scope affinity later) can be
/// pinned to a single scope via its `sandbox_scope_id` config field; all
/// filesystem operations for that adapter then gate through the scope's
/// roots instead of a process-wide shared list.
///
/// The scope named `DEFAULT_SCOPE_ID` is always present; legacy callers
/// that pre-date T6.5 resolve to it automatically.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SandboxScope {
    /// URL-safe slug: 1..32 chars of `[a-z0-9_-]`. Used as both the
    /// foreign key from `HermesInstance` and the stable identifier
    /// across renames. `"default"` is reserved for the always-present
    /// scope.
    pub id: String,
    /// Human-friendly label shown in the scope dropdown. Defaults to
    /// the id at creation time; can be renamed without breaking
    /// references.
    pub label: String,
    /// Roots visible to any adapter pinned to this scope. Same
    /// `WorkspaceRoot` shape used by the legacy single-scope
    /// architecture, so existing per-root semantics (read/read-write,
    /// canonicalisation) carry over unchanged.
    #[serde(default)]
    pub roots: Vec<WorkspaceRoot>,
}

impl SandboxScope {
    /// Convenience constructor for the mandatory `"default"` scope with
    /// an empty roots list. Used by tests and by the first-launch
    /// bootstrap in `PathAuthority::init_from_disk`.
    pub fn default_empty() -> Self {
        Self {
            id: DEFAULT_SCOPE_ID.into(),
            label: "Default".into(),
            roots: Vec::new(),
        }
    }
}

/// Runtime sandbox mode. `DevAllow` is a first-launch convenience; as soon
/// as the user interacts with Settings > Workspace the mode flips to
/// `Enforced` and never goes back (within that install).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxMode {
    DevAllow,
    Enforced,
}

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("path is in the hard denylist ({reason}): {path}")]
    Denied { path: String, reason: &'static str },

    #[error("path is outside any workspace root and requires user consent: {path}")]
    ConsentRequired { path: String },

    #[error("write attempted on read-only root: {path}")]
    ReadOnlyRoot { path: String },

    #[error("path canonicalization failed for {path}: {source}")]
    Canonicalize {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid path (empty or relative after normalization): {path}")]
    Invalid { path: String },

    /// T6.5 — a caller asked for a scope id that isn't in the
    /// `sandbox.json` scopes list. Frontends generally treat this as a
    /// stale cache / race condition and refresh.
    #[error("unknown sandbox scope id: {id}")]
    UnknownScope { id: String },

    /// T6.5 — the caller tried to mutate a scope in a way that's not
    /// allowed (deleting the `default` scope, upserting with an invalid
    /// id, etc.).
    #[error("invalid scope operation: {reason}")]
    InvalidScope { reason: String },
}

pub type SandboxResult<T> = Result<T, SandboxError>;

/// Validate a scope id: URL-safe, 1..=32 chars of `[a-z0-9_-]`. Reject
/// uppercase + dots + slashes so the id is safe as both a JSON key
/// and a filename-ish identifier.
pub fn is_valid_scope_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 32 {
        return false;
    }
    id.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_scope_id_allows_slugs_rejects_junk() {
        assert!(is_valid_scope_id("default"));
        assert!(is_valid_scope_id("worker-1"));
        assert!(is_valid_scope_id("a_b_c"));
        assert!(is_valid_scope_id("a"));
        assert!(!is_valid_scope_id(""));
        assert!(!is_valid_scope_id("With Spaces"));
        assert!(!is_valid_scope_id("UPPER"));
        assert!(!is_valid_scope_id("has.dot"));
        assert!(!is_valid_scope_id(&"x".repeat(33)));
    }
}
