//! Hermes profile management. Each profile is a directory under
//! `~/.hermes/profiles/<name>/`, with its own `config.yaml`, `.env`,
//! skills, etc. Caduceus treats the filesystem as the source of truth:
//! we don't parse Hermes's CLI output (which varies between versions);
//! we just scan the directory.
//!
//! Operations exposed here (backing the T2.7 IPC surface):
//!   - `list_profiles` — directory scan, skip non-dirs and hidden files.
//!   - `create_profile(name)` — `mkdir` + seed an empty `config.yaml`
//!     so the directory actually looks like a profile to Hermes.
//!   - `rename_profile(from, to)` — `rename` with collision guards.
//!   - `delete_profile(name)` — `remove_dir_all`; refuses the currently
//!     active one (caller must switch first).
//!   - `clone_profile(src, dst)` — recursive copy.
//!
//! "Active profile" is determined by reading a symlink / pointer file
//! (`~/.hermes/active_profile`); if absent we fall back to whichever
//! profile exists first alphabetically. This file is managed by Hermes
//! itself — we read it but don't write it in T2.7 (switching is a
//! Phase 3 concern alongside gateway-per-profile control).
//!
//! Safety:
//! - Names are validated (no path separators, no `..`, no control
//!   chars) to rule out traversal shenanigans before we touch disk.
//! - All write ops append a `hermes.profile.*` entry to the changelog
//!   journal for the T2.8 revert UI.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::changelog;
use crate::fs_atomic;

/// Read-only view of a profile directory. `updated_at` is the mtime of
/// the directory entry itself (matches the "Last used" column in list
/// views reasonably well for most install patterns).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileInfo {
    pub name: String,
    pub path: String,
    /// `true` if this is the profile Hermes currently uses.
    pub is_active: bool,
    /// Unix-ms mtime of the directory entry, or 0 if unavailable.
    pub updated_at: i64,
}

/// Returned by `list_profiles` so the UI can show an empty state with
/// the expected path when Hermes isn't installed at all.
#[derive(Debug, Clone, Serialize)]
pub struct ProfilesView {
    pub root: String,
    /// `true` if `<home>/.hermes/profiles` doesn't exist yet.
    pub missing_root: bool,
    pub profiles: Vec<ProfileInfo>,
    pub active: Option<String>,
}

// ──────────────────────────── helpers ────────────────────────────

fn home_dir(home_override: Option<&Path>) -> PathBuf {
    home_override.map(Path::to_path_buf).unwrap_or_else(|| {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

fn profiles_root(home: &Path) -> PathBuf {
    home.join(".hermes/profiles")
}

fn active_pointer(home: &Path) -> PathBuf {
    // Hermes's own file; we only read it. If Hermes changes the name
    // we'll surface the fallback (first profile) and log-forget.
    home.join(".hermes/active_profile")
}

/// Resolve the currently-active profile name, if any.
/// - Reads `~/.hermes/active_profile` (plain text, first line).
/// - Falls back to `None` if the file is missing or empty.
pub fn read_active(home: &Path) -> Option<String> {
    let raw = fs::read_to_string(active_pointer(home)).ok()?;
    let first = raw.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

/// Name validation. Keeps the filesystem sane and blocks `..`, `/`, and
/// control chars. Hermes itself may have stricter rules — we enforce a
/// reasonable common subset so we don't create profiles the CLI refuses
/// to load.
pub fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("profile name is empty".into());
    }
    if name.len() > 64 {
        return Err("profile name too long (max 64 chars)".into());
    }
    if name == "." || name == ".." {
        return Err("profile name reserved".into());
    }
    for ch in name.chars() {
        if ch == '/' || ch == '\\' || ch.is_control() {
            return Err(format!("profile name contains invalid char '{}'", ch));
        }
    }
    // Leading dot would create a hidden directory which our scanner
    // skips — reject it explicitly so the user isn't puzzled.
    if name.starts_with('.') {
        return Err("profile name cannot start with '.'".into());
    }
    Ok(())
}

// ──────────────────────────── operations ────────────────────────────

/// Scan `<home>/.hermes/profiles/` and return one ProfileInfo per
/// directory entry (skipping files, hidden entries, and symlinks).
/// Missing root is surfaced as `missing_root: true` with no error —
/// that's how we want to render the "Hermes not installed" empty state.
pub fn list_profiles_at(home: &Path) -> io::Result<ProfilesView> {
    let root = profiles_root(home);
    let root_str = root.display().to_string();
    let active = read_active(home);

    let read = match fs::read_dir(&root) {
        Ok(r) => r,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Ok(ProfilesView {
                root: root_str,
                missing_root: true,
                profiles: Vec::new(),
                active,
            });
        }
        Err(e) => return Err(e),
    };

    let mut out = Vec::new();
    for entry in read {
        let entry = entry?;
        let meta = entry.metadata()?;
        // Skip non-dirs, symlinks (avoid following arbitrary FS edges),
        // and hidden entries (e.g. a stray `.DS_Store`).
        if !meta.is_dir() || meta.file_type().is_symlink() {
            continue;
        }
        let name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue, // non-UTF-8 names: skip silently
        };
        if name.starts_with('.') {
            continue;
        }

        let updated_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        out.push(ProfileInfo {
            is_active: active.as_deref() == Some(name.as_str()),
            name,
            path: entry.path().display().to_string(),
            updated_at,
        });
    }
    // Deterministic: active first, then alphabetical. The UI doesn't
    // want to re-sort on render if we already handed back a good order.
    out.sort_by(|a, b| {
        b.is_active
            .cmp(&a.is_active)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(ProfilesView {
        root: root_str,
        missing_root: false,
        profiles: out,
        active,
    })
}

/// Create `<home>/.hermes/profiles/<name>/` with a minimal seed
/// `config.yaml`. The seed is a valid-but-empty doc so Hermes's parser
/// doesn't choke on its first load.
pub fn create_profile_at(
    home: &Path,
    name: &str,
    changelog_path: Option<&Path>,
) -> io::Result<ProfileInfo> {
    validate_name(name).map_err(io::Error::other)?;
    let dir = profiles_root(home).join(name);
    if dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("profile '{name}' already exists"),
        ));
    }
    fs::create_dir_all(&dir)?;
    // Seed config.yaml. An empty file would work for Hermes (parsers
    // tolerate empties) but writing the `{}` sentinel makes the intent
    // visible to anyone `cat`ing the file.
    fs::write(
        dir.join("config.yaml"),
        "# Hermes profile · managed by Corey\n{}\n",
    )?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.create",
            None,
            Some(json!({ "name": name })),
            format!("Created profile '{name}'"),
        );
    }

    Ok(ProfileInfo {
        name: name.to_string(),
        path: dir.display().to_string(),
        is_active: read_active(home).as_deref() == Some(name),
        updated_at: now_ms(),
    })
}

/// Rename a profile directory. Refuses to clobber an existing target.
pub fn rename_profile_at(
    home: &Path,
    from: &str,
    to: &str,
    changelog_path: Option<&Path>,
) -> io::Result<()> {
    validate_name(from).map_err(io::Error::other)?;
    validate_name(to).map_err(io::Error::other)?;
    if from == to {
        return Ok(());
    }
    let root = profiles_root(home);
    let src = root.join(from);
    let dst = root.join(to);
    if !src.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("profile '{from}' not found"),
        ));
    }
    if dst.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("profile '{to}' already exists"),
        ));
    }
    fs::rename(&src, &dst)?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.rename",
            Some(json!({ "name": from })),
            Some(json!({ "name": to })),
            format!("Renamed profile '{from}' → '{to}'"),
        );
    }
    Ok(())
}

/// Delete a profile directory. Refuses the active profile — the user
/// must switch first (a safety rail; Hermes itself would complain too).
pub fn delete_profile_at(home: &Path, name: &str, changelog_path: Option<&Path>) -> io::Result<()> {
    validate_name(name).map_err(io::Error::other)?;
    if read_active(home).as_deref() == Some(name) {
        return Err(io::Error::other(format!(
            "refusing to delete active profile '{name}'"
        )));
    }
    let dir = profiles_root(home).join(name);
    if !dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("profile '{name}' not found"),
        ));
    }
    fs::remove_dir_all(&dir)?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.delete",
            Some(json!({ "name": name })),
            None,
            format!("Deleted profile '{name}'"),
        );
    }
    Ok(())
}

/// Clone a profile directory recursively. Useful when a user wants to
/// fork a known-good config and diverge without touching the original.
pub fn clone_profile_at(
    home: &Path,
    src: &str,
    dst: &str,
    changelog_path: Option<&Path>,
) -> io::Result<ProfileInfo> {
    validate_name(src).map_err(io::Error::other)?;
    validate_name(dst).map_err(io::Error::other)?;
    let root = profiles_root(home);
    let src_dir = root.join(src);
    let dst_dir = root.join(dst);
    if !src_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("profile '{src}' not found"),
        ));
    }
    if dst_dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("profile '{dst}' already exists"),
        ));
    }
    copy_dir_recursive(&src_dir, &dst_dir)?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.clone",
            Some(json!({ "name": src })),
            Some(json!({ "name": dst })),
            format!("Cloned profile '{src}' → '{dst}'"),
        );
    }

    Ok(ProfileInfo {
        name: dst.to_string(),
        path: dst_dir.display().to_string(),
        is_active: false,
        updated_at: now_ms(),
    })
}

/// Flip the active-profile pointer so Hermes's next gateway start
/// picks up the named profile. This doesn't bounce the gateway —
/// callers who want that immediate effect (`hermes gateway restart`)
/// should chain it after the successful write.
///
/// Safety model:
/// - Name validation up-front so a traversal attempt dies before we
///   touch disk.
/// - Refuse when the profile directory doesn't exist; silently
///   activating a phantom profile would leave the gateway wedged on
///   the next restart.
/// - Atomic write via `fs_atomic::atomic_write` — the pointer file
///   never exists in a partially-written state, so a crash mid-op
///   doesn't leave `active_profile` empty (which `read_active` would
///   then surface as "no active profile").
/// - Journalled with the `from`/`to` shape the changelog revert UI
///   already understands.
pub fn activate_profile_at(
    home: &Path,
    name: &str,
    changelog_path: Option<&Path>,
) -> io::Result<ProfileInfo> {
    validate_name(name).map_err(io::Error::other)?;
    let dir = profiles_root(home).join(name);
    if !dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("profile '{name}' not found"),
        ));
    }

    let previous = read_active(home);
    // No-op when already active — saves a disk write + a no-op
    // journal entry that would clutter the changelog tab.
    if previous.as_deref() == Some(name) {
        return Ok(ProfileInfo {
            name: name.to_string(),
            path: dir.display().to_string(),
            is_active: true,
            updated_at: now_ms(),
        });
    }

    let pointer = active_pointer(home);
    if let Some(parent) = pointer.parent() {
        fs::create_dir_all(parent)?;
    }
    // Trailing newline so `cat` reads cleanly and matches Hermes's own
    // writes (verified against the reference `hermes init` output).
    let contents = format!("{name}\n");
    fs_atomic::atomic_write(&pointer, contents.as_bytes(), None)?;

    if let Some(p) = changelog_path {
        let _ = changelog::append(
            p,
            "hermes.profile.activate",
            previous.as_ref().map(|n| json!({ "name": n })),
            Some(json!({ "name": name })),
            match &previous {
                Some(prev) => format!("Activated profile '{name}' (was '{prev}')"),
                None => format!("Activated profile '{name}'"),
            },
        );
    }

    Ok(ProfileInfo {
        name: name.to_string(),
        path: dir.display().to_string(),
        is_active: true,
        updated_at: now_ms(),
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        // Skip symlinks — Hermes profile dirs shouldn't contain any,
        // and following them can lead to cycles or write outside `dst`.
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// ──────────────────────────── public wrappers (HOME-resolved) ────────────────────────────

pub fn list_profiles() -> io::Result<ProfilesView> {
    list_profiles_at(&home_dir(None))
}
pub fn create_profile(name: &str, changelog_path: Option<&Path>) -> io::Result<ProfileInfo> {
    create_profile_at(&home_dir(None), name, changelog_path)
}
pub fn rename_profile(from: &str, to: &str, changelog_path: Option<&Path>) -> io::Result<()> {
    rename_profile_at(&home_dir(None), from, to, changelog_path)
}
pub fn delete_profile(name: &str, changelog_path: Option<&Path>) -> io::Result<()> {
    delete_profile_at(&home_dir(None), name, changelog_path)
}
pub fn clone_profile(
    src: &str,
    dst: &str,
    changelog_path: Option<&Path>,
) -> io::Result<ProfileInfo> {
    clone_profile_at(&home_dir(None), src, dst, changelog_path)
}
pub fn activate_profile(name: &str, changelog_path: Option<&Path>) -> io::Result<ProfileInfo> {
    activate_profile_at(&home_dir(None), name, changelog_path)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ──────────────────────────── tests ────────────────────────────


#[cfg(test)]
mod tests;
