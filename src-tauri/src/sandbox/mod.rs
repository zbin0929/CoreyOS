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

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use persistence::{sandbox_config_path, SandboxConfig};

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
    roots: RwLock<Vec<WorkspaceRoot>>,
    /// One-shot grants valid for this process only. Not persisted.
    session_grants: RwLock<HashSet<PathBuf>>,
    /// Absolute path to `sandbox.json`. `None` in tests or before
    /// `init_from_disk` has run — in that case mutations are in-memory only.
    config_path: RwLock<Option<PathBuf>>,
    /// `DevAllow` on first launch (no config file seen yet); `Enforced`
    /// after the user has touched Settings > Workspace. Persisted as part
    /// of `sandbox.json`.
    mode: RwLock<SandboxMode>,
}

impl PathAuthority {
    pub fn new() -> Self {
        Self {
            roots: RwLock::new(Vec::new()),
            session_grants: RwLock::new(HashSet::new()),
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
                    roots = cfg.roots.len(),
                    mode = ?cfg.mode,
                    "sandbox: loaded config",
                );
                self.set_roots(cfg.roots);
                *self.mode.write().expect("poisoned") = cfg.mode;
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

    /// Replaces the roots list. Each path is canonicalized; invalid roots are
    /// silently dropped with a tracing warning (caller-UI should prevalidate).
    pub fn set_roots(&self, roots: Vec<WorkspaceRoot>) {
        let mut canon = Vec::with_capacity(roots.len());
        for mut r in roots {
            match dunce::canonicalize(&r.path) {
                Ok(c) => {
                    r.path = c;
                    canon.push(r);
                }
                Err(e) => {
                    tracing::warn!(path = %r.path.display(), error = %e, "dropping invalid root")
                }
            }
        }
        *self.roots.write().expect("poisoned") = canon;
    }

    pub fn roots(&self) -> Vec<WorkspaceRoot> {
        self.roots.read().expect("poisoned").clone()
    }

    pub fn mode(&self) -> SandboxMode {
        *self.mode.read().expect("poisoned")
    }

    pub fn session_grants(&self) -> Vec<PathBuf> {
        self.session_grants
            .read()
            .expect("poisoned")
            .iter()
            .cloned()
            .collect()
    }

    /// Add a new workspace root. Canonicalizes, rejects bad paths with an
    /// error (unlike `set_roots` which drops silently), dedupes against
    /// existing roots, flips the mode to `Enforced`, and persists the new
    /// config. Returns the stored `WorkspaceRoot`.
    pub fn add_root(&self, root: WorkspaceRoot) -> SandboxResult<WorkspaceRoot> {
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
            let mut roots = self.roots.write().expect("poisoned");
            if let Some(existing) = roots.iter_mut().find(|r| r.path == stored.path) {
                existing.label = stored.label.clone();
                existing.mode = stored.mode;
            } else {
                roots.push(stored.clone());
            }
        }
        *self.mode.write().expect("poisoned") = SandboxMode::Enforced;
        self.persist();
        Ok(stored)
    }

    /// Remove a root by canonical path. No-op if not present. Persists on
    /// any mutation.
    pub fn remove_root(&self, path: &Path) -> SandboxResult<()> {
        let canon = dunce::canonicalize(path).map_err(|e| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source: e,
        })?;
        {
            let mut roots = self.roots.write().expect("poisoned");
            roots.retain(|r| r.path != canon);
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

    pub fn grant_once(&self, path: PathBuf) -> SandboxResult<PathBuf> {
        let canon = dunce::canonicalize(&path).map_err(|e| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source: e,
        })?;
        // Denylist still wins — grant_once cannot unlock ~/.ssh.
        if let Some(reason) = check_denylist(&canon) {
            return Err(SandboxError::Denied {
                path: canon.display().to_string(),
                reason,
            });
        }
        self.session_grants
            .write()
            .expect("poisoned")
            .insert(canon.clone());
        Ok(canon)
    }

    pub fn clear_session_grants(&self) {
        self.session_grants.write().expect("poisoned").clear();
    }

    /// Write the current state to `sandbox.json`. Called automatically on
    /// any mutation; safe to call when `config_path` is `None` (tests).
    fn persist(&self) {
        let Some(cfg_path) = self.config_path.read().expect("poisoned").clone() else {
            return;
        };
        let cfg = SandboxConfig {
            version: 1,
            mode: *self.mode.read().expect("poisoned"),
            roots: self.roots.read().expect("poisoned").clone(),
        };
        if let Err(e) = persistence::save(&cfg_path, &cfg) {
            tracing::error!(
                path = %cfg_path.display(),
                error = %e,
                "sandbox: failed to persist config",
            );
        }
    }

    /// Core gate. Returns the canonicalized path if access is allowed,
    /// `Err` otherwise. For Phase 0, "outside any root with no roots
    /// configured" yields `Allow` (dev-mode default); once roots are
    /// populated, outside paths require `ConsentRequired`.
    pub fn check(&self, path: &Path, op: AccessOp) -> SandboxResult<PathBuf> {
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

        // Denylist wins over roots and session grants.
        if let Some(reason) = check_denylist(&canonical) {
            return Err(SandboxError::Denied {
                path: canonical.display().to_string(),
                reason,
            });
        }

        // Session one-shot grant?
        if self
            .session_grants
            .read()
            .expect("poisoned")
            .contains(&canonical)
        {
            return Ok(canonical);
        }

        // Inside any root?
        let roots = self.roots.read().expect("poisoned");
        let mut matched_root: Option<&WorkspaceRoot> = None;
        for root in roots.iter() {
            if canonical.starts_with(&root.path) {
                matched_root = Some(root);
                break;
            }
        }

        if let Some(root) = matched_root {
            // Enforce read-only roots.
            if matches!(op, AccessOp::Write) && root.mode == AccessMode::Read {
                return Err(SandboxError::ReadOnlyRoot {
                    path: canonical.display().to_string(),
                });
            }
            return Ok(canonical);
        }

        // No roots configured AND mode is DevAllow (first-launch, no
        // sandbox.json ever written). Everything outside denylist is fine.
        if roots.is_empty() && *self.mode.read().expect("poisoned") == SandboxMode::DevAllow {
            tracing::debug!(
                path = %canonical.display(),
                op = ?op,
                "sandbox: dev-mode allow (no roots configured)",
            );
            return Ok(canonical);
        }

        Err(SandboxError::ConsentRequired {
            path: canonical.display().to_string(),
        })
    }
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
