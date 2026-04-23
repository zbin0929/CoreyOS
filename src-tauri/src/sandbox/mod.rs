//! Path sandboxing — a TRAE-style workspace access control layer.
//!
//! # Responsibilities
//!
//! - Hold a list of user-approved `WorkspaceRoot`s.
//! - Normalize and canonicalize incoming paths.
//! - Reject hard-denied system paths unconditionally.
//! - Decide whether a given (path, op) combination is allowed, requires
//!   user consent, or is blocked.
//!
//! # Mode policy
//!
//! | Mode       | Roots empty | Roots non-empty |
//! |------------|-------------|-----------------|
//! | `DevAllow` | Allow (dev-only default for first-launch convenience) | Allow within roots, consent-required outside |
//! | `Enforced` | Deny everything except denylist + explicit grants | Allow within roots, consent-required outside |
//!
//! Fresh installs start in `DevAllow` so the app isn't crippled on first
//! launch. The moment the user visits Settings > Workspace and adds a root
//! (or explicitly toggles Enforce), the mode flips to `Enforced` and the
//! `sandbox.json` config file is written — from then on every launch loads
//! that file and stays `Enforced`.
//!
//! When `check()` returns `ConsentRequired`, the IPC fails with
//! `SandboxConsentRequired { path }`. The frontend's `ConsentModal` catches
//! this error, asks the user, and either calls `sandbox_grant_once(path)`
//! (one-shot, process-scoped) or `sandbox_add_root(path, mode)` (persisted),
//! then retries the original operation.
//!
//! # Goldens
//!
//! - Symlink escape is blocked by `canonicalize()` + prefix check.
//! - `..` traversal resolves via canonicalize before comparison.
//! - Denylist wins over roots (even if `~/.ssh` is *inside* a root).

pub mod fs;
pub mod persistence;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use persistence::{sandbox_config_path, SandboxConfig};

/// Stable id of the always-present "default" sandbox scope. Every legacy
/// adapter and every IPC command that doesn't know about scopes resolves
/// to this one; T6.5 per-agent scoping opts in by pointing a
/// `HermesInstance` at a different scope id.
pub const DEFAULT_SCOPE_ID: &str = "default";

// ───────────────────────── Types ─────────────────────────

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

// ───────────────────────── Denylist ─────────────────────────

/// Platform-specific absolute path prefixes that are *never* accessible,
/// regardless of workspace roots. Checked AFTER canonicalization so symlinks
/// cannot escape via e.g. `~/link-to-ssh/`.
///
/// Entries ending in `/` match the directory and everything under it.
/// Entries without trailing `/` match exact paths only.
fn hard_denylist() -> &'static [(&'static str, &'static str)] {
    #[cfg(target_os = "macos")]
    {
        &[
            ("/etc/sudoers", "system credentials"),
            ("/etc/shadow", "system credentials"),
            ("/private/etc/sudoers", "system credentials"),
            ("/System/", "macOS system directory"),
            ("/private/var/db/sudo/", "sudo state"),
            ("/Library/Keychains/", "macOS keychain"),
            ("/private/var/root/", "root home"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        &[
            ("/etc/sudoers", "system credentials"),
            ("/etc/shadow", "system credentials"),
            ("/etc/gshadow", "system credentials"),
            ("/proc/", "kernel surface"),
            ("/sys/", "kernel surface"),
            ("/boot/", "boot partition"),
            ("/root/", "root home"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        &[
            ("C:\\Windows\\System32\\config\\", "Windows registry hives"),
            ("C:\\Windows\\System32\\", "Windows system"),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        &[]
    }
}

/// Paths relative to `$HOME` that are always denied.
/// These win over roots — even if the user adds `$HOME` as a root, these
/// nested paths stay blocked unless consent is requested per-file.
fn home_relative_denylist() -> &'static [(&'static str, &'static str)] {
    &[
        (".ssh/", "ssh keys"),
        (".aws/credentials", "aws credentials"),
        (".aws/config", "aws credentials"),
        (".kube/config", "cluster credentials"),
        (".gnupg/", "gpg keys"),
        (".docker/config.json", "docker credentials"),
        (".netrc", "legacy credentials"),
    ]
}

fn check_denylist(canonical: &Path) -> Option<&'static str> {
    let path_str = canonical.to_string_lossy();
    let path_ref: &str = path_str.as_ref();

    for (prefix, reason) in hard_denylist() {
        if prefix.ends_with('/') || prefix.ends_with('\\') {
            // Directory form: match the dir itself OR anything below it.
            let dir_no_sep = prefix.trim_end_matches(['/', '\\']);
            if path_ref == dir_no_sep || is_prefix_path(path_ref, prefix) {
                return Some(reason);
            }
        } else if path_ref == *prefix {
            return Some(reason);
        }
    }

    if let Some(home) = dirs_home() {
        for (rel, reason) in home_relative_denylist() {
            let is_dir = rel.ends_with('/');
            let rel_clean = rel.trim_end_matches('/');
            // PathBuf::join uses the platform-native separator, so this
            // produces `C:\Users\zbin\.ssh` on Windows and `/Users/zbin/.ssh`
            // on POSIX — instead of the previous mixed-separator string.
            let full = home.join(rel_clean);

            if is_dir {
                if canonical == full || canonical.starts_with(&full) {
                    return Some(reason);
                }
            } else if canonical == full {
                return Some(reason);
            }
        }
    }

    None
}

#[inline]
fn is_prefix_path(candidate: &str, prefix_with_sep: &str) -> bool {
    candidate.starts_with(prefix_with_sep)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

// ───────────────────────── Authority ─────────────────────────

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
            self.session_grants
                .write()
                .expect("poisoned")
                .remove(id);
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
        let s = scopes
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

    /// Default scope's roots. See also [`roots_for`] for a specific scope.
    pub fn roots(&self) -> Vec<WorkspaceRoot> {
        self.roots_for(DEFAULT_SCOPE_ID).unwrap_or_default()
    }

    pub fn mode(&self) -> SandboxMode {
        *self.mode.read().expect("poisoned")
    }

    /// Default scope's session grants. [`session_grants_in`] reads a
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
    pub fn add_root_to(
        &self,
        scope_id: &str,
        root: WorkspaceRoot,
    ) -> SandboxResult<WorkspaceRoot> {
        let canon =
            dunce::canonicalize(&root.path).map_err(|e| SandboxError::Canonicalize {
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

    /// Write the current state to `sandbox.json`. Called automatically on
    /// any mutation; safe to call when `config_path` is `None` (tests).
    fn persist(&self) {
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
    /// [`check_scoped`] for per-scope enforcement (T6.5).
    pub fn check(&self, path: &Path, op: AccessOp) -> SandboxResult<PathBuf> {
        self.check_scoped(DEFAULT_SCOPE_ID, path, op)
    }

    /// Per-scope gate. Returns the canonicalized path if access is
    /// allowed, `Err` otherwise. The scope id must be one of
    /// [`scopes`]; `UnknownScope` is returned otherwise so callers can
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
        let scope = scopes
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
        if scope.roots.is_empty()
            && *self.mode.read().expect("poisoned") == SandboxMode::DevAllow
        {
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

impl Default for PathAuthority {
    fn default() -> Self {
        Self::new()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    // ───────────────────── T6.5 scope tests ─────────────────────

    #[test]
    fn new_authority_has_only_default_scope() {
        let auth = PathAuthority::new();
        let scopes = auth.scopes();
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].id, DEFAULT_SCOPE_ID);
        assert!(scopes[0].roots.is_empty());
    }

    #[test]
    fn upsert_scope_rejects_invalid_ids() {
        let auth = PathAuthority::new();
        let bad_ids = ["", "With Spaces", "UPPER", "has.dot", "has/slash", &"x".repeat(33)];
        for id in bad_ids {
            let err = auth
                .upsert_scope(SandboxScope {
                    id: id.into(),
                    label: "lbl".into(),
                    roots: vec![],
                })
                .unwrap_err();
            assert!(
                matches!(err, SandboxError::InvalidScope { .. }),
                "id {id:?} should reject as InvalidScope, got {err:?}"
            );
        }
    }

    #[test]
    fn delete_default_scope_is_rejected() {
        let auth = PathAuthority::new();
        let err = auth.delete_scope(DEFAULT_SCOPE_ID).unwrap_err();
        assert!(matches!(err, SandboxError::InvalidScope { .. }));
        // Still present.
        assert!(auth.scopes().iter().any(|s| s.id == DEFAULT_SCOPE_ID));
    }

    #[test]
    fn check_scoped_respects_per_scope_roots() {
        // Build two scopes: `default` with /tmp, `worker` with no roots.
        // Reading /tmp under `default` allows; under `worker` (enforced)
        // denies.
        let auth = PathAuthority::new();
        let tmp = std::env::temp_dir();
        auth.set_roots(vec![WorkspaceRoot {
            path: tmp.clone(),
            label: "tmp".into(),
            mode: AccessMode::ReadWrite,
        }]);
        auth.upsert_scope(SandboxScope {
            id: "worker".into(),
            label: "Worker".into(),
            roots: vec![],
        })
        .unwrap();
        // Force enforced mode so `worker`'s empty-roots + enforced →
        // consent-required rather than dev-allow.
        auth.set_enforced();

        // default scope: ok.
        assert!(auth.check_scoped("default", &tmp, AccessOp::Read).is_ok());
        // worker scope: consent required (same path, different policy).
        let err = auth
            .check_scoped("worker", &tmp, AccessOp::Read)
            .unwrap_err();
        assert!(matches!(err, SandboxError::ConsentRequired { .. }));
    }

    #[test]
    fn grant_once_is_scope_local() {
        // A grant in `worker` must not satisfy a check against `default`.
        let auth = PathAuthority::new();
        auth.upsert_scope(SandboxScope {
            id: "worker".into(),
            label: "Worker".into(),
            roots: vec![],
        })
        .unwrap();
        auth.set_enforced();

        let tmp = std::env::temp_dir();
        auth.grant_once_in("worker", tmp.clone()).unwrap();

        // Worker can see it.
        assert!(auth.check_scoped("worker", &tmp, AccessOp::Read).is_ok());
        // Default scope cannot — grants don't cross scopes.
        let err = auth
            .check_scoped("default", &tmp, AccessOp::Read)
            .unwrap_err();
        assert!(matches!(err, SandboxError::ConsentRequired { .. }));
    }

    #[test]
    fn check_unknown_scope_errors_out() {
        let auth = PathAuthority::new();
        let err = auth
            .check_scoped("ghost", &std::env::temp_dir(), AccessOp::Read)
            .unwrap_err();
        assert!(matches!(err, SandboxError::UnknownScope { .. }));
    }

    #[test]
    fn denylist_still_wins_per_scope() {
        // Even a scope with ~ as a read-write root cannot punch
        // through ~/.ssh.
        let auth = PathAuthority::new();
        if let Some(home) = dirs_home() {
            auth.upsert_scope(SandboxScope {
                id: "wide".into(),
                label: "Wide".into(),
                roots: vec![WorkspaceRoot {
                    path: home.clone(),
                    label: "home".into(),
                    mode: AccessMode::ReadWrite,
                }],
            })
            .unwrap();
            let ssh = home.join(".ssh");
            if ssh.exists() {
                let err = auth
                    .check_scoped("wide", &ssh, AccessOp::Read)
                    .unwrap_err();
                assert!(matches!(err, SandboxError::Denied { .. }));
            }
        }
    }

    #[test]
    fn delete_scope_clears_its_session_grants() {
        let auth = PathAuthority::new();
        auth.upsert_scope(SandboxScope {
            id: "temp".into(),
            label: "Temp".into(),
            roots: vec![],
        })
        .unwrap();
        let tmp = std::env::temp_dir();
        auth.grant_once_in("temp", tmp.clone()).unwrap();
        assert_eq!(auth.session_grants_in("temp").len(), 1);

        auth.delete_scope("temp").unwrap();
        // Re-adding the scope gets a clean grant list.
        auth.upsert_scope(SandboxScope {
            id: "temp".into(),
            label: "Temp".into(),
            roots: vec![],
        })
        .unwrap();
        assert!(
            auth.session_grants_in("temp").is_empty(),
            "session grants should not leak across scope recreation"
        );
    }

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

    // ───────────────────── Pre-T6.5 behaviour preservation ─────────────────────
    //
    // These tests pre-date T6.5 and assert legacy default-scope
    // behaviour — they MUST keep passing so callers that never touch
    // the scope API see zero behaviour change.

    #[test]
    fn empty_roots_phase0_allows() {
        let auth = PathAuthority::new();
        let p = std::env::temp_dir();
        assert!(auth.check(&p, AccessOp::Read).is_ok());
    }

    #[test]
    fn denylist_wins_over_roots() {
        let auth = PathAuthority::new();
        if let Some(home) = dirs_home() {
            auth.set_roots(vec![WorkspaceRoot {
                path: home.clone(),
                label: "home".into(),
                mode: AccessMode::ReadWrite,
            }]);
            let ssh = home.join(".ssh");
            if ssh.exists() {
                let err = auth.check(&ssh, AccessOp::Read).unwrap_err();
                assert!(matches!(err, SandboxError::Denied { .. }));
            }
        }
    }

    #[test]
    fn outside_root_requires_consent() {
        let auth = PathAuthority::new();
        let tmp = std::env::temp_dir();
        auth.set_roots(vec![WorkspaceRoot {
            path: tmp.clone(),
            label: "tmp".into(),
            mode: AccessMode::ReadWrite,
        }]);
        // `/` is definitely outside `/tmp` on any system.
        let err = auth.check(Path::new("/"), AccessOp::Read).unwrap_err();
        assert!(matches!(err, SandboxError::ConsentRequired { .. }));
    }

    // ───────────────────────── Windows verbatim-prefix tests ─────────────────
    //
    // Phase 0's retro flagged a real bug: `std::fs::canonicalize` on Windows
    // returns `\\?\C:\…` verbatim paths, and our denylist does string-prefix
    // matching against `"C:\\Windows\\System32\\"` which then silently fails.
    // The fix was to route every canonicalization through `dunce::canonicalize`
    // — these tests lock that contract in so a future "simplify the sandbox"
    // refactor can't regress it without turning the Windows CI leg red.
    //
    // All three are `#[cfg(target_os = "windows")]` — on any other host the
    // `\\?\` prefix is Windows-specific and `hard_denylist()` is empty for
    // the non-matching OS anyway, so synthesising them elsewhere would only
    // test the mock.

    #[cfg(target_os = "windows")]
    #[test]
    fn canonicalize_or_parent_strips_verbatim_prefix() {
        // `C:\Windows` is guaranteed to exist on every Windows runner.
        let canonical = canonicalize_or_parent(Path::new("C:\\Windows"))
            .expect("C:\\Windows must canonicalize on Windows");
        let s = canonical.to_string_lossy();
        assert!(
            !s.starts_with("\\\\?\\"),
            "dunce should have stripped the verbatim prefix, got {s}"
        );
        // Be lenient on drive letter case (Windows is case-insensitive and
        // different APIs disagree on canonical capitalisation).
        assert!(
            s.eq_ignore_ascii_case("C:\\Windows"),
            "unexpected canonical form: {s}"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn hard_denylist_blocks_system32_even_with_verbatim_input() {
        let auth = PathAuthority::new();
        // Path intentionally lives under System32 so canonicalisation
        // resolves + the denylist can fire. `config\\SAM` exists on every
        // Windows install (the SAM registry hive file); if it's missing
        // for some reason the test degrades to passing via
        // canonicalize_or_parent's parent-fallback path.
        let victim = Path::new("C:\\Windows\\System32\\config\\SAM");
        let err = auth
            .check(victim, AccessOp::Read)
            .expect_err("System32 hive must be denied");
        assert!(
            matches!(err, SandboxError::Denied { .. }),
            "expected Denied, got {err:?}"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn home_relative_denylist_blocks_ssh_dir() {
        let Some(home) = dirs_home() else {
            return; // CI runner with no HOME — nothing to assert.
        };
        let auth = PathAuthority::new();
        // Generous root: user's entire home. Denylist must still win.
        auth.set_roots(vec![WorkspaceRoot {
            path: home.clone(),
            label: "home".into(),
            mode: AccessMode::ReadWrite,
        }]);

        let ssh = home.join(".ssh");
        // `.ssh/` might not exist on a clean CI runner; if so we can't
        // canonicalise and the test degrades to a no-op. Only assert
        // when we have a real directory to point at.
        if ssh.exists() {
            let err = auth
                .check(&ssh, AccessOp::Read)
                .expect_err("~/.ssh must be denied even when HOME is a root");
            assert!(matches!(err, SandboxError::Denied { .. }));
        }
    }
}
