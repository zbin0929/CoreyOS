//! Centralised filesystem path resolution for the app's own data
//! directory (`~/.hermes` by default).
//!
//! Historically both `hermes_config::hermes_dir()` and
//! `skills::hermes_dir()` hand-rolled the same `$HOME || %USERPROFILE%`
//! lookup and hard-coded `.hermes/` as the suffix. That worked, but it
//! left users with no way to move the data off their system drive on
//! Windows, or off `~` on Unix. This module adds a single resolver
//! those two (and future) callers share, with three precedence layers:
//!
//! 1. `$COREY_HERMES_DIR` — hard override, honoured unconditionally.
//!    Useful for CI, tests, and power users who want to relocate data
//!    without touching the UI.
//! 2. A persisted override file at `<app_config_dir>/data_dir` (plain
//!    UTF-8, one path per line). Written by the Settings UI through
//!    `app_data_dir_set`. Read lazily once per process.
//! 3. A platform-appropriate default: `%LOCALAPPDATA%\Corey\hermes` on
//!    Windows (so fresh Windows installs don't dump `.hermes` into the
//!    root of the user profile), and `~/.hermes` everywhere else
//!    (matches what every existing install already has on disk — no
//!    migration needed).
//!
//! The Tauri app-config-dir is supplied at startup via
//! [`set_app_config_dir`]. Before that call (e.g. very early unit
//! tests) the resolver falls back to env + platform default, skipping
//! layer 2.
//!
//! The resolved path is NOT cached: the override file is tiny and
//! reading it once per call keeps Settings changes visible to already-
//! running subsystems without a process restart.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Suffix appended to `$HOME` / `%USERPROFILE%` on the default path
/// (and returned verbatim for users who haven't changed anything).
/// Kept public so tests and legacy call-sites can still spell it.
pub const HERMES_DIR: &str = ".hermes";

/// Set once during app startup (`lib.rs::setup`). `None` until then.
static APP_CONFIG_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Install the Tauri `app.path().app_config_dir()` location so the
/// persisted override file can be looked up. Calling this twice
/// replaces the previous value (handy for tests); the store only
/// reads it with a shared lock so callers never block meaningfully.
pub fn set_app_config_dir(dir: PathBuf) {
    if let Ok(mut guard) = APP_CONFIG_DIR.write() {
        *guard = Some(dir);
    }
}

fn app_config_dir() -> Option<PathBuf> {
    APP_CONFIG_DIR.read().ok().and_then(|g| g.clone())
}

fn override_file() -> Option<PathBuf> {
    app_config_dir().map(|d| d.join("data_dir"))
}

/// Read the current user-selected override, if any. Blank lines or a
/// missing file both mean "no override"; returning `None` lets the
/// caller fall through to the platform default.
fn read_override() -> Option<PathBuf> {
    let path = override_file()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// `true` when a non-empty override file currently exists. Env var
/// overrides are NOT reflected here — they're process-scoped and the
/// UI can't clear them. Used by the Settings page to decide whether
/// to show a "reset to default" affordance.
pub fn has_override() -> bool {
    read_override().is_some()
}

/// Persist (or clear when `dir` is `None`) the user-selected data
/// directory. Returns the path the override was written to — mostly
/// for logging / tests. The override file sits in the Tauri app
/// config dir so it survives reinstalls but stays out of the data dir
/// itself (circular lookup).
pub fn write_override(dir: Option<&Path>) -> io::Result<PathBuf> {
    let file = override_file().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "app_config_dir not initialised; cannot persist data_dir override",
        )
    })?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match dir {
        Some(d) => std::fs::write(&file, d.to_string_lossy().as_bytes())?,
        None => {
            // Clearing the override is "delete the file"; ignore NotFound
            // so the UI can idempotently reset back to default.
            if let Err(e) = std::fs::remove_file(&file) {
                if e.kind() != io::ErrorKind::NotFound {
                    return Err(e);
                }
            }
        }
    }
    Ok(file)
}

/// Default when no override is set. On Windows we prefer
/// `%LOCALAPPDATA%\Corey\hermes` so the data dir lives under the
/// canonical Windows app-data tree (not the user-profile root). On
/// macOS/Linux we keep `~/.hermes` — installed bases already have it,
/// and moving it would orphan every profile in the field.
///
/// **`HOME` overrides everything.** Many tests in this crate (skills,
/// hermes_config, …) point `HOME` at a `tempdir()` to isolate disk
/// state; treating `HOME` as authoritative when explicitly set keeps
/// that pattern working on Windows too. Windows itself does not set
/// `HOME` by default (it sets `USERPROFILE`), so production behaviour
/// on Windows is still "use `LOCALAPPDATA`" — only test code that
/// explicitly sets `HOME` deviates.
fn platform_default() -> io::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            if !home.is_empty() {
                return Ok(PathBuf::from(home).join(HERMES_DIR));
            }
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let data_dir = dir.join("data");
                if data_dir.exists() || dir.join("Corey.exe").exists() {
                    let _ = std::fs::create_dir_all(&data_dir);
                    return Ok(data_dir);
                }
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return Ok(PathBuf::from(local).join("Corey").join("hermes"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            if !home.is_empty() {
                return Ok(PathBuf::from(home).join(HERMES_DIR));
            }
        }
    }
    let home = std::env::var_os("USERPROFILE").ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "neither $HOME nor %USERPROFILE% set",
        )
    })?;
    Ok(PathBuf::from(home).join(HERMES_DIR))
}

/// Resolve the directory that holds `config.yaml`, `.env`, `skills/`,
/// and everything else the Hermes agent writes on behalf of the user.
///
/// See module docs for the three precedence layers.
pub fn hermes_data_dir() -> io::Result<PathBuf> {
    if let Some(env) = std::env::var_os("COREY_HERMES_DIR") {
        let p = PathBuf::from(env);
        if !p.as_os_str().is_empty() {
            return Ok(p);
        }
    }
    if let Some(p) = read_override() {
        return Ok(p);
    }
    platform_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Both tests mutate process-wide `std::env`, so cargo's default
    /// parallel harness races them. A mutex around each test keeps
    /// the env clean-up reliable without the `serial_test` crate.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Scratch dir for override-file tests. We swap in a per-test
    /// app_config_dir so parallel tests don't clobber each other.
    fn scratch() -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("corey-paths-{n}"));
        std::fs::create_dir_all(&p).expect("mkdir scratch");
        p
    }

    #[test]
    fn env_var_wins_over_override_and_default() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let dir = scratch();
        set_app_config_dir(dir.clone());
        // Pre-populate an override that we expect the env var to beat.
        write_override(Some(Path::new("/tmp/should-be-ignored"))).expect("write override");
        std::env::set_var("COREY_HERMES_DIR", "/tmp/env-wins");
        let resolved = hermes_data_dir().expect("resolve");
        std::env::remove_var("COREY_HERMES_DIR");
        assert_eq!(resolved, PathBuf::from("/tmp/env-wins"));
    }

    #[test]
    fn override_file_takes_effect_when_no_env() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let dir = scratch();
        set_app_config_dir(dir.clone());
        std::env::remove_var("COREY_HERMES_DIR");
        let target = std::env::temp_dir().join("corey-override-target");
        write_override(Some(&target)).expect("write override");
        let resolved = hermes_data_dir().expect("resolve");
        assert_eq!(resolved, target);
        // Clearing brings us back to platform default.
        write_override(None).expect("clear override");
        let resolved = hermes_data_dir().expect("resolve default");
        assert_ne!(resolved, target);
    }
}
