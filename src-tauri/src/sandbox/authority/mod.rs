//! `PathAuthority` — the runtime gate.
//!
//! Owns the in-memory state (scopes, session grants, mode), wires
//! through to [`super::persistence`] for `sandbox.json` reads/writes,
//! and exposes the `check`/`check_scoped` pair every IPC command and
//! adapter goes through before touching the filesystem.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::denylist::{check_denylist, dirs_home};
use super::persistence::{self, sandbox_config_path};
use super::types::{
    is_valid_scope_id, AccessMode, SandboxError, SandboxMode, SandboxResult, SandboxScope,
    WorkspaceRoot, DEFAULT_SCOPE_ID,
};
// `AccessOp` is referenced by `super::*` in tests.rs but no longer
// in mod.rs's own bodies — keep the binding under cfg(test).
#[cfg(test)]
use super::types::AccessOp;

pub struct PathAuthority {
    /// All scopes known to the process. The scope with id
    /// `DEFAULT_SCOPE_ID` is an invariant that's always present at
    /// position 0; `set_roots` and `add_root`/`remove_root` without a
    /// scope id operate on it.
    scopes: RwLock<Vec<SandboxScope>>,
    /// One-shot grants valid for this process only. Keyed by scope id,
    /// so a grant for scope `worker` does NOT grant access to the same
    /// path when checked against scope `default` — crucial for T6.5's
    /// security property.
    session_grants: RwLock<HashMap<String, HashSet<PathBuf>>>,
    /// Absolute path to `sandbox.json`. `None` in tests or before
    /// `init_from_disk` has run — in that case mutations are in-memory only.
    config_path: RwLock<Option<PathBuf>>,
    /// `DevAllow` on first launch (no config file seen yet); `Enforced`
    /// after the user has touched Settings > Workspace. Persisted as part
    /// of `sandbox.json`. Applies to every scope uniformly — per-scope
    /// modes would confuse users and don't align with any current
    /// threat model.
    mode: RwLock<SandboxMode>,
}

impl PathAuthority {
    pub fn new() -> Self {
        Self {
            scopes: RwLock::new(vec![SandboxScope::default_empty()]),
            session_grants: RwLock::new(HashMap::new()),
            config_path: RwLock::new(None),
            mode: RwLock::new(SandboxMode::DevAllow),
        }
    }

    /// Load the sandbox config from `<app_config_dir>/sandbox.json`. If the
    /// file is missing, seed a sensible default: `~/.hermes/` as a
    /// read-write root (when it exists) and stay in `DevAllow` until the
    /// user explicitly enforces. Returns the resolved config path so
    /// subsequent mutations persist to the same location.
    pub fn init_from_disk(&self, app_config_dir: &Path) {
        let cfg_path = sandbox_config_path(app_config_dir);
        *self.config_path.write().expect("poisoned") = Some(cfg_path.clone());

        match persistence::load(&cfg_path) {
            Ok(Some(cfg)) => {
                tracing::info!(
                    path = %cfg_path.display(),
                    scopes = cfg.scopes.len(),
                    mode = ?cfg.mode,
                    "sandbox: loaded config",
                );
                self.replace_scopes(cfg.scopes);
                *self.mode.write().expect("poisoned") = cfg.mode;
                // If the load path migrated v1 → v2, persist immediately
                // so subsequent launches skip the migration codepath.
                // `save` is idempotent w.r.t. already-v2 files.
                self.persist();
            }
            Ok(None) => {
                // First launch. Seed ~/.hermes/ as a default root so the app
                // works without any user action, but stay in DevAllow so
                // other paths aren't suddenly consent-required.
                let mut seeds = Vec::new();
                if let Some(home) = dirs_home() {
                    let hermes = home.join(".hermes");
                    if hermes.exists() {
                        seeds.push(WorkspaceRoot {
                            path: hermes,
                            label: "Hermes".into(),
                            mode: AccessMode::ReadWrite,
                        });
                    }
                }
                tracing::info!(
                    path = %cfg_path.display(),
                    seeded = seeds.len(),
                    "sandbox: no config file, seeding defaults (DevAllow)",
                );
                self.set_roots(seeds);
                // Intentionally no save here — DevAllow means "never written
                // to disk yet", and we want `init_from_disk` to be
                // idempotent / side-effect-free on unconfigured installs.
            }
            Err(e) => {
                tracing::error!(
                    path = %cfg_path.display(),
                    error = %e,
                    "sandbox: failed to load config; starting with empty roots",
                );
            }
        }
    }

    // ───────────────────────── Scope-level API (T6.5) ─────────────────────

    /// Replace the entire scopes list. The `default` scope is re-inserted
    /// if missing so the "default always exists" invariant holds. Each
    /// root inside each scope is canonicalized; invalid roots are
    /// dropped silently with a warning (same policy as `set_roots`).
    pub fn replace_scopes(&self, scopes: Vec<SandboxScope>) {
        let mut canon: Vec<SandboxScope> = Vec::with_capacity(scopes.len());
        for mut s in scopes {
            s.roots = canonicalize_roots(s.roots);
            canon.push(s);
        }
        if !canon.iter().any(|s| s.id == DEFAULT_SCOPE_ID) {
            canon.insert(0, SandboxScope::default_empty());
        }
        *self.scopes.write().expect("poisoned") = canon;
    }

    /// Snapshot all scopes (cloned). Used by IPC for listing.
    pub fn scopes(&self) -> Vec<SandboxScope> {
        self.scopes.read().expect("poisoned").clone()
    }

    /// Upsert a scope by id. Id must be valid (`is_valid_scope_id`).
    /// Returns the stored scope. Persists on success.
    pub fn upsert_scope(&self, scope: SandboxScope) -> SandboxResult<SandboxScope> {
        if !is_valid_scope_id(&scope.id) {
            return Err(SandboxError::InvalidScope {
                reason: format!("bad id {:?}", scope.id),
            });
        }
        let stored = SandboxScope {
            id: scope.id,
            label: if scope.label.trim().is_empty() {
                "Untitled".into()
            } else {
                scope.label
            },
            roots: canonicalize_roots(scope.roots),
        };
        {
            let mut scopes = self.scopes.write().expect("poisoned");
            if let Some(existing) = scopes.iter_mut().find(|s| s.id == stored.id) {
                existing.label = stored.label.clone();
                existing.roots = stored.roots.clone();
            } else {
                scopes.push(stored.clone());
            }
        }
        self.persist();
        Ok(stored)
    }

    /// Delete a scope by id. The `default` scope is not deletable.
    pub fn delete_scope(&self, id: &str) -> SandboxResult<()> {
        if id == DEFAULT_SCOPE_ID {
            return Err(SandboxError::InvalidScope {
                reason: "cannot delete the default scope".into(),
            });
        }
        let removed = {
            let mut scopes = self.scopes.write().expect("poisoned");
            let before = scopes.len();
            scopes.retain(|s| s.id != id);
            before != scopes.len()
        };
        if removed {
            // Drop any session grants held under the removed scope so we
            // don't leak memory and so a later scope re-added with the
            // same id doesn't inherit stale grants.
            self.session_grants.write().expect("poisoned").remove(id);
            self.persist();
        }
        Ok(())
    }

    /// Lookup helper — returns `Err(UnknownScope)` if the id isn't
    /// present. Used by every scoped API below.
    fn with_scope<R>(
        &self,
        scope_id: &str,
        f: impl FnOnce(&SandboxScope) -> R,
    ) -> SandboxResult<R> {
        let scopes = self.scopes.read().expect("poisoned");
        let s =
            scopes
                .iter()
                .find(|s| s.id == scope_id)
                .ok_or_else(|| SandboxError::UnknownScope {
                    id: scope_id.to_string(),
                })?;
        Ok(f(s))
    }

    /// Snapshot the roots for the given scope id.
    pub fn roots_for(&self, scope_id: &str) -> SandboxResult<Vec<WorkspaceRoot>> {
        self.with_scope(scope_id, |s| s.roots.clone())
    }

    // ───────────────────────── Legacy (default scope) API ─────────────────
    //
    // Everything below is a thin wrapper that targets `DEFAULT_SCOPE_ID`.
    // Pre-T6.5 callers (IPC, adapters) keep working unchanged; new
    // per-scope behaviour is opt-in by calling the `*_scoped` / `*_in`
    // variants directly.

    /// Replaces the **default scope's** roots list. Each path is
    /// canonicalized; invalid roots are silently dropped with a
    /// tracing warning (caller-UI should prevalidate).
    pub fn set_roots(&self, roots: Vec<WorkspaceRoot>) {
        let canon = canonicalize_roots(roots);
        let mut scopes = self.scopes.write().expect("poisoned");
        if let Some(def) = scopes.iter_mut().find(|s| s.id == DEFAULT_SCOPE_ID) {
            def.roots = canon;
        } else {
            scopes.insert(
                0,
                SandboxScope {
                    id: DEFAULT_SCOPE_ID.into(),
                    label: "Default".into(),
                    roots: canon,
                },
            );
        }
    }

    /// Default scope's roots. See also [`Self::roots_for`] for a specific scope.
    pub fn roots(&self) -> Vec<WorkspaceRoot> {
        self.roots_for(DEFAULT_SCOPE_ID).unwrap_or_default()
    }

    pub fn mode(&self) -> SandboxMode {
        *self.mode.read().expect("poisoned")
    }

    /// Default scope's session grants. [`Self::session_grants_in`] reads a
    /// specific scope.
    pub fn session_grants(&self) -> Vec<PathBuf> {
        self.session_grants_in(DEFAULT_SCOPE_ID)
    }

    /// Snapshot session grants for a specific scope. Empty list if the
    /// scope has no grants (or doesn't exist — callers treat "no grants"
    /// and "missing scope" identically for listing purposes).
    pub fn session_grants_in(&self, scope_id: &str) -> Vec<PathBuf> {
        self.session_grants
            .read()
            .expect("poisoned")
            .get(scope_id)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Add a new workspace root to the **default scope**. Canonicalizes,
    /// rejects bad paths with an error (unlike `set_roots` which drops
    /// silently), dedupes against existing roots, flips the mode to
    /// `Enforced`, and persists the new config. Returns the stored
    /// `WorkspaceRoot`.
    pub fn add_root(&self, root: WorkspaceRoot) -> SandboxResult<WorkspaceRoot> {
        self.add_root_to(DEFAULT_SCOPE_ID, root)
    }

    /// Add a root to the given scope. Flips the mode to `Enforced` and
    /// persists. Errors with `UnknownScope` if the scope id is missing.
    pub fn add_root_to(&self, scope_id: &str, root: WorkspaceRoot) -> SandboxResult<WorkspaceRoot> {
        let canon = dunce::canonicalize(&root.path).map_err(|e| SandboxError::Canonicalize {
            path: root.path.display().to_string(),
            source: e,
        })?;
        let stored = WorkspaceRoot {
            path: canon,
            label: root.label,
            mode: root.mode,
        };
        {
            let mut scopes = self.scopes.write().expect("poisoned");
            let s = scopes
                .iter_mut()
                .find(|s| s.id == scope_id)
                .ok_or_else(|| SandboxError::UnknownScope {
                    id: scope_id.to_string(),
                })?;
            if let Some(existing) = s.roots.iter_mut().find(|r| r.path == stored.path) {
                existing.label = stored.label.clone();
                existing.mode = stored.mode;
            } else {
                s.roots.push(stored.clone());
            }
        }
        *self.mode.write().expect("poisoned") = SandboxMode::Enforced;
        self.persist();
        Ok(stored)
    }

    /// Remove a root by canonical path from the **default scope**. No-op
    /// if not present. Persists on any mutation.
    pub fn remove_root(&self, path: &Path) -> SandboxResult<()> {
        self.remove_root_from(DEFAULT_SCOPE_ID, path)
    }

    /// Remove a root from the given scope. No-op if the root isn't in
    /// that scope. Errors with `UnknownScope` if the scope id is missing.
    pub fn remove_root_from(&self, scope_id: &str, path: &Path) -> SandboxResult<()> {
        let canon = dunce::canonicalize(path).map_err(|e| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source: e,
        })?;
        {
            let mut scopes = self.scopes.write().expect("poisoned");
            let s = scopes
                .iter_mut()
                .find(|s| s.id == scope_id)
                .ok_or_else(|| SandboxError::UnknownScope {
                    id: scope_id.to_string(),
                })?;
            s.roots.retain(|r| r.path != canon);
        }
        self.persist();
        Ok(())
    }

    /// Flip to `Enforced` explicitly (without adding a root). Useful for the
    /// Settings UI's "enforce without roots" toggle.
    pub fn set_enforced(&self) {
        *self.mode.write().expect("poisoned") = SandboxMode::Enforced;
        self.persist();
    }

    /// Grant one-shot access to the **default scope**.
    pub fn grant_once(&self, path: PathBuf) -> SandboxResult<PathBuf> {
        self.grant_once_in(DEFAULT_SCOPE_ID, path)
    }

    /// Grant one-shot access to a specific scope. Denylist still wins —
    /// `grant_once_in` cannot unlock `~/.ssh` under any scope.
    pub fn grant_once_in(&self, scope_id: &str, path: PathBuf) -> SandboxResult<PathBuf> {
        // Enforce the scope exists BEFORE touching the grant map so we
        // don't create phantom entries for typos.
        self.with_scope(scope_id, |_| ())?;
        let canon = dunce::canonicalize(&path).map_err(|e| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source: e,
        })?;
        if let Some(reason) = check_denylist(&canon) {
            return Err(SandboxError::Denied {
                path: canon.display().to_string(),
                reason,
            });
        }
        self.session_grants
            .write()
            .expect("poisoned")
            .entry(scope_id.to_string())
            .or_default()
            .insert(canon.clone());
        Ok(canon)
    }

    /// Clear session grants for the **default scope** only.
    pub fn clear_session_grants(&self) {
        self.clear_session_grants_in(DEFAULT_SCOPE_ID);
    }

    /// Clear session grants for a specific scope. Other scopes' grants
    /// are untouched.
    pub fn clear_session_grants_in(&self, scope_id: &str) {
        self.session_grants
            .write()
            .expect("poisoned")
            .remove(scope_id);
    }
}

impl Default for PathAuthority {
    fn default() -> Self {
        Self::new()
    }
}

/// Canonicalize each root in the list; silently drop unreachable paths
/// with a warning so a broken user config doesn't prevent startup.
fn canonicalize_roots(roots: Vec<WorkspaceRoot>) -> Vec<WorkspaceRoot> {
    let mut out = Vec::with_capacity(roots.len());
    for mut r in roots {
        match dunce::canonicalize(&r.path) {
            Ok(c) => {
                r.path = c;
                out.push(r);
            }
            Err(e) => {
                tracing::warn!(path = %r.path.display(), error = %e, "dropping invalid root");
            }
        }
    }
    out
}

/// Canonicalize `path` if it exists; otherwise canonicalize its parent and
/// append the file name, which allows gating writes of not-yet-existing files.
fn canonicalize_or_parent(path: &Path) -> std::io::Result<PathBuf> {
    // `dunce::canonicalize` is a drop-in for `std::fs::canonicalize` that
    // strips Windows `\\?\` verbatim prefixes so denylist string-matching
    // works. On Unix it delegates straight to std, so it's a no-op cost.
    match dunce::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(_) => {
            let parent = path.parent().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory")
            })?;
            let file_name = path.file_name().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "no file component")
            })?;
            let parent_canon = dunce::canonicalize(parent)?;
            Ok(parent_canon.join(file_name))
        }
    }
}

mod access;

// Tests live in the sibling `tests.rs` file so the implementation file
// stays under the project's size guideline.
#[cfg(test)]
mod tests;
