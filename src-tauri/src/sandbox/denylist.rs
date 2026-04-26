//! Hard denylist — paths that are *never* accessible regardless of
//! workspace roots, session grants, or DevAllow mode.
//!
//! Two flavours:
//! - [`hard_denylist`] — absolute platform paths (e.g. `/etc/sudoers`,
//!   `/System/`, `C:\Windows\System32\`). Checked AFTER canonicalization
//!   so symlink escapes via e.g. `~/link-to-ssh/` don't bypass us.
//! - [`home_relative_denylist`] — paths under `$HOME` (e.g. `.ssh/`,
//!   `.aws/credentials`). Win over user-added roots — even if the user
//!   adds `$HOME` as a root, these nested paths stay blocked unless
//!   `grant_once` is used per-file.
//!
//! Module also exports [`dirs_home`] since the Authority layer needs it
//! for default-root seeding (`~/.hermes/`) on first launch.

use std::path::{Path, PathBuf};

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

/// Returns the deny reason if `canonical` matches any entry in either
/// the absolute or home-relative denylist; otherwise `None`. Caller
/// must pass an already-canonicalized path so symlinks can't slip past.
pub(super) fn check_denylist(canonical: &Path) -> Option<&'static str> {
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

/// Resolve `$HOME` (POSIX) or `%USERPROFILE%` (Windows). Returned as
/// a `PathBuf` so callers can `join` arbitrary subpaths. `None` when
/// neither env var is set — the denylist gracefully degrades to its
/// absolute-path entries only in that case.
pub(super) fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
