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
pub fn activate_profile(
    name: &str,
    changelog_path: Option<&Path>,
) -> io::Result<ProfileInfo> {
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
mod tests {
    use super::*;
    use std::io::Write;

    /// Cheap tempdir helper (consistent with other modules in this crate).
    /// Uses nanos + a per-process counter so parallel tests don't clash —
    /// ms resolution wasn't enough when cargo test runs them all at once.
    struct TempHome(PathBuf);
    impl TempHome {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let base = std::env::temp_dir().join(format!(
                "caduceus-profiles-{}-{}-{}",
                std::process::id(),
                nanos,
                seq,
            ));
            fs::create_dir_all(base.join(".hermes/profiles")).unwrap();
            Self(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn seed(&self, name: &str) {
            fs::create_dir_all(self.0.join(".hermes/profiles").join(name)).unwrap();
        }
        fn seed_active(&self, name: &str) {
            let mut f = fs::File::create(self.0.join(".hermes/active_profile")).unwrap();
            f.write_all(name.as_bytes()).unwrap();
        }
    }
    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn list_profiles_surfaces_dirs_and_flags_active() {
        let h = TempHome::new();
        h.seed("prod");
        h.seed("dev");
        h.seed_active("dev");
        // Hidden dir — must be skipped.
        fs::create_dir_all(h.path().join(".hermes/profiles/.cache")).unwrap();
        // Stray file — must be skipped.
        fs::write(h.path().join(".hermes/profiles/README.md"), "hi").unwrap();

        let view = list_profiles_at(h.path()).unwrap();
        assert!(!view.missing_root);
        assert_eq!(view.active.as_deref(), Some("dev"));
        assert_eq!(view.profiles.len(), 2);
        // Active sorts first; then alphabetical.
        assert_eq!(view.profiles[0].name, "dev");
        assert!(view.profiles[0].is_active);
        assert_eq!(view.profiles[1].name, "prod");
        assert!(!view.profiles[1].is_active);
    }

    #[test]
    fn list_profiles_missing_root_is_not_an_error() {
        // Fresh tempdir with no .hermes at all.
        let base = std::env::temp_dir().join(format!("caduceus-noprofiles-{}", now_ms()));
        fs::create_dir_all(&base).unwrap();
        let view = list_profiles_at(&base).unwrap();
        assert!(view.missing_root);
        assert!(view.profiles.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn create_profile_roundtrips_and_seeds_config() {
        let h = TempHome::new();
        let info = create_profile_at(h.path(), "alpha", None).unwrap();
        assert_eq!(info.name, "alpha");

        let cfg = h.path().join(".hermes/profiles/alpha/config.yaml");
        assert!(cfg.is_file(), "seed config.yaml should exist");
    }

    #[test]
    fn create_profile_rejects_duplicate() {
        let h = TempHome::new();
        h.seed("dup");
        let err = create_profile_at(h.path(), "dup", None).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn create_profile_validates_name() {
        let h = TempHome::new();
        assert!(create_profile_at(h.path(), "", None).is_err());
        assert!(create_profile_at(h.path(), "..", None).is_err());
        assert!(create_profile_at(h.path(), "a/b", None).is_err());
        assert!(create_profile_at(h.path(), ".hidden", None).is_err());
        // Control char (NUL) — assemble explicitly.
        let bad = String::from_utf8(vec![b'a', 0, b'b']).unwrap();
        assert!(create_profile_at(h.path(), &bad, None).is_err());
    }

    #[test]
    fn rename_profile_moves_directory_and_is_no_op_when_same() {
        let h = TempHome::new();
        h.seed("old");
        rename_profile_at(h.path(), "old", "new", None).unwrap();
        assert!(!h.path().join(".hermes/profiles/old").exists());
        assert!(h.path().join(".hermes/profiles/new").is_dir());

        // Same name is a no-op (no error, no filesystem churn).
        rename_profile_at(h.path(), "new", "new", None).unwrap();
    }

    #[test]
    fn rename_profile_refuses_to_clobber() {
        let h = TempHome::new();
        h.seed("a");
        h.seed("b");
        let err = rename_profile_at(h.path(), "a", "b", None).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn delete_profile_refuses_active() {
        let h = TempHome::new();
        h.seed("live");
        h.seed_active("live");
        let err = delete_profile_at(h.path(), "live", None).unwrap_err();
        assert!(err.to_string().contains("refusing to delete active"));
    }

    #[test]
    fn delete_profile_removes_non_active() {
        let h = TempHome::new();
        h.seed("keep");
        h.seed("gone");
        h.seed_active("keep");
        delete_profile_at(h.path(), "gone", None).unwrap();
        assert!(!h.path().join(".hermes/profiles/gone").exists());
        assert!(h.path().join(".hermes/profiles/keep").exists());
    }

    #[test]
    fn clone_profile_copies_contents_recursively() {
        let h = TempHome::new();
        h.seed("src");
        fs::write(
            h.path().join(".hermes/profiles/src/config.yaml"),
            "model: x\n",
        )
        .unwrap();
        fs::create_dir_all(h.path().join(".hermes/profiles/src/skills")).unwrap();
        fs::write(
            h.path().join(".hermes/profiles/src/skills/hello.md"),
            "howdy",
        )
        .unwrap();

        clone_profile_at(h.path(), "src", "dst", None).unwrap();

        let cloned_cfg =
            fs::read_to_string(h.path().join(".hermes/profiles/dst/config.yaml")).unwrap();
        assert_eq!(cloned_cfg, "model: x\n");
        let cloned_skill =
            fs::read_to_string(h.path().join(".hermes/profiles/dst/skills/hello.md")).unwrap();
        assert_eq!(cloned_skill, "howdy");
    }

    #[test]
    fn clone_profile_refuses_existing_dst() {
        let h = TempHome::new();
        h.seed("a");
        h.seed("b");
        let err = clone_profile_at(h.path(), "a", "b", None).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn validate_name_matrix() {
        assert!(validate_name("prod").is_ok());
        assert!(validate_name("my-agent_01").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name(&"x".repeat(65)).is_err());
    }

    #[test]
    fn activate_writes_pointer_and_marks_active() {
        let h = TempHome::new();
        h.seed("dev");
        h.seed("prod");
        h.seed_active("dev");

        let info = activate_profile_at(h.path(), "prod", None).unwrap();
        assert!(info.is_active);
        assert_eq!(info.name, "prod");

        // Pointer file now reads "prod\n".
        let pointer = h.path().join(".hermes/active_profile");
        let raw = fs::read_to_string(&pointer).unwrap();
        assert_eq!(raw.trim(), "prod");

        // Next list() reflects the flip.
        let view = list_profiles_at(h.path()).unwrap();
        assert_eq!(view.active.as_deref(), Some("prod"));
        let prod = view.profiles.iter().find(|p| p.name == "prod").unwrap();
        assert!(prod.is_active);
    }

    #[test]
    fn activate_refuses_nonexistent_profile() {
        let h = TempHome::new();
        h.seed("dev");
        let err = activate_profile_at(h.path(), "ghost", None).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        // Pointer file was never written.
        assert!(!h.path().join(".hermes/active_profile").exists());
    }

    #[test]
    fn activate_is_idempotent_when_already_active() {
        let h = TempHome::new();
        h.seed("dev");
        h.seed_active("dev");

        // Sanity: starting state.
        assert_eq!(read_active(h.path()).as_deref(), Some("dev"));

        // Activating again succeeds without throwing — the no-op path
        // avoids clutter in the changelog journal.
        let info = activate_profile_at(h.path(), "dev", None).unwrap();
        assert!(info.is_active);
    }
}
