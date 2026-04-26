//! `PathAuthority` access-check + persistence methods, split out of
//! the main impl so the per-scope CRUD half stays readable. Same
//! struct, just different file — Rust permits multiple `impl` blocks
//! across modules as long as they all live in the same crate.

use std::path::{Path, PathBuf};

use super::super::denylist::check_denylist;
use super::super::persistence::{self, SandboxConfig};
use super::super::types::{
    AccessMode, AccessOp, SandboxError, SandboxMode, SandboxResult, DEFAULT_SCOPE_ID,
};
use super::canonicalize_or_parent;
use super::PathAuthority;

impl PathAuthority {
    /// Write the current state to `sandbox.json`. Called automatically on
    /// any mutation; safe to call when `config_path` is `None` (tests).
    pub(super) fn persist(&self) {
        let Some(cfg_path) = self.config_path.read().expect("poisoned").clone() else {
            return;
        };
        let cfg = SandboxConfig {
            version: 2,
            mode: *self.mode.read().expect("poisoned"),
            scopes: self.scopes.read().expect("poisoned").clone(),
        };
        if let Err(e) = persistence::save(&cfg_path, &cfg) {
            tracing::error!(
                path = %cfg_path.display(),
                error = %e,
                "sandbox: failed to persist config",
            );
        }
    }

    /// Core gate — checks a path against the **default scope**. See
    /// [`Self::check_scoped`] for per-scope enforcement (T6.5).
    pub fn check(&self, path: &Path, op: AccessOp) -> SandboxResult<PathBuf> {
        self.check_scoped(DEFAULT_SCOPE_ID, path, op)
    }

    /// Per-scope gate. Returns the canonicalized path if access is
    /// allowed, `Err` otherwise. The scope id must be one of
    /// [`Self::scopes`]; `UnknownScope` is returned otherwise so callers can
    /// distinguish "this path is denied" from "you passed a stale scope
    /// id".
    ///
    /// Enforcement order (each short-circuits on match):
    /// 1. Empty path → `Invalid`.
    /// 2. Canonicalize (including parent-only canonicalisation for
    ///    not-yet-existing write targets).
    /// 3. Denylist match → `Denied`. **Global; never gated by scope**.
    /// 4. Session grant recorded for THIS scope id → allow.
    /// 5. Path under one of the scope's roots → allow (or
    ///    `ReadOnlyRoot` for writes on a read-only root).
    /// 6. DevAllow + scope has no roots → allow (first-launch only).
    /// 7. Otherwise → `ConsentRequired`.
    pub fn check_scoped(
        &self,
        scope_id: &str,
        path: &Path,
        op: AccessOp,
    ) -> SandboxResult<PathBuf> {
        if path.as_os_str().is_empty() {
            return Err(SandboxError::Invalid {
                path: path.display().to_string(),
            });
        }

        // Canonicalize. For not-yet-existing paths (writes to new files),
        // canonicalize the parent directory and join the file name.
        let canonical = canonicalize_or_parent(path).map_err(|e| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source: e,
        })?;

        // Denylist wins over roots and session grants — and is scope-
        // agnostic by design: no scope can grant access to ~/.ssh.
        if let Some(reason) = check_denylist(&canonical) {
            return Err(SandboxError::Denied {
                path: canonical.display().to_string(),
                reason,
            });
        }

        // Session one-shot grant in THIS scope? A grant in `worker` does
        // NOT satisfy a check against `default` — that's the whole point
        // of per-agent scoping.
        if self
            .session_grants
            .read()
            .expect("poisoned")
            .get(scope_id)
            .is_some_and(|set| set.contains(&canonical))
        {
            return Ok(canonical);
        }

        // Load the scope. If missing, `UnknownScope`.
        let scopes = self.scopes.read().expect("poisoned");
        let scope =
            scopes
                .iter()
                .find(|s| s.id == scope_id)
                .ok_or_else(|| SandboxError::UnknownScope {
                    id: scope_id.to_string(),
                })?;

        // Inside any root of this scope?
        let matched_root = scope
            .roots
            .iter()
            .find(|root| canonical.starts_with(&root.path));

        if let Some(root) = matched_root {
            if matches!(op, AccessOp::Write) && root.mode == AccessMode::Read {
                return Err(SandboxError::ReadOnlyRoot {
                    path: canonical.display().to_string(),
                });
            }
            return Ok(canonical);
        }

        // No roots configured in this scope AND mode is DevAllow
        // (first-launch, no sandbox.json ever written). Everything
        // outside denylist is fine.
        if scope.roots.is_empty() && *self.mode.read().expect("poisoned") == SandboxMode::DevAllow {
            tracing::debug!(
                scope = scope_id,
                path = %canonical.display(),
                op = ?op,
                "sandbox: dev-mode allow (scope has no roots)",
            );
            return Ok(canonical);
        }

        Err(SandboxError::ConsentRequired {
            path: canonical.display().to_string(),
        })
    }
}
