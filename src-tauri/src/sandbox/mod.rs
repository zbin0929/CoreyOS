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
//! # Phase policy
//!
//! | Phase | Roots empty | Roots non-empty |
//! |-------|-------------|-----------------|
//! | 0     | Allow (dev) | Allow within roots, **consent placeholder = deny** outside |
//! | 2     | Deny everything except denylist-gated consent | same |
//!
//! During Phase 0 we ship the *plumbing* without interactive consent UI:
//! any IPC path that is outside configured roots fails with
//! `SandboxError::ConsentRequired`, which the frontend surfaces as a
//! recoverable error. Once the Settings > Workspace UI and the consent
//! dialog land in Phase 2, `request_consent()` below will await a user
//! decision instead of short-circuiting with `ConsentRequired`.
//!
//! # Goldens
//!
//! - Symlink escape is blocked by `canonicalize()` + prefix check.
//! - `..` traversal resolves via canonicalize before comparison.
//! - Denylist wins over roots (even if `~/.ssh` is *inside* a root).

pub mod fs;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceRoot {
    /// Canonical absolute path. Always stored canonicalized.
    pub path: PathBuf,
    /// Human label used in UI.
    pub label: String,
    pub mode: AccessMode,
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
}

impl PathAuthority {
    pub fn new() -> Self {
        Self {
            roots: RwLock::new(Vec::new()),
            session_grants: RwLock::new(HashSet::new()),
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

    pub fn grant_once(&self, path: PathBuf) {
        if let Ok(canon) = dunce::canonicalize(&path) {
            self.session_grants.write().expect("poisoned").insert(canon);
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

        // No roots configured? Dev-mode allow during Phase 0.
        if roots.is_empty() {
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
