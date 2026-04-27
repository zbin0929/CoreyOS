//! Hermes binary discovery + `hermes gateway start/restart` shell-outs.
//! Split out of the parent module so config-file IO and process
//! management live in separate files.

use std::io;
use std::path::PathBuf;

/// First-run detection. Returns a structured view of whether Hermes is
/// reachable from Corey: binary on PATH / known fallback, its version
/// string (best effort), and the resolved full path.
///
/// The Home page wires this into the onboarding checklist — we render
/// a platform-specific install command + "Re-check" affordance when
/// `installed == false` so non-engineer users don't have to chase
/// docs to resolve the most common first-run blocker.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct HermesDetection {
    /// True if we found a `hermes` binary at one of the canonical paths.
    pub installed: bool,
    /// Absolute path to the resolved binary, when found.
    pub path: Option<String>,
    /// Best-effort `hermes --version` output. Absent when the version
    /// probe failed (binary exists but is broken / permissions wrong).
    pub version: Option<String>,
}

/// Locate the Hermes binary + probe its version. Never blocks the
/// caller longer than a single `hermes --version` invocation.
pub fn detect() -> HermesDetection {
    let Ok(path) = resolve_hermes_binary() else {
        return HermesDetection {
            installed: false,
            path: None,
            version: None,
        };
    };
    let version = std::process::Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
    HermesDetection {
        installed: true,
        path: Some(path.display().to_string()),
        version,
    }
}

/// Shell out to `hermes gateway start`. Same resolution / capture
/// semantics as [`gateway_restart`]; used by the Home page "Start
/// gateway" affordance when the binary is present but no process is
/// listening on 127.0.0.1:8642 yet.
pub fn gateway_start() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;
    let output = std::process::Command::new(&binary)
        .args(["gateway", "start"])
        .output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "hermes gateway start failed (status {:?}): {}{}",
            output.status.code(),
            stderr,
            stdout
        )));
    }
    Ok(if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    })
}

/// Shell out to `hermes gateway restart`. Tries `$PATH` first, then falls back
/// to `~/.local/bin/hermes` (where Hermes installs by default on macOS). The
/// command is synchronous — callers should run this off the Tokio runtime's
/// main thread (i.e. via `spawn_blocking` or in an async IPC handler).
pub fn gateway_restart() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;
    let output = std::process::Command::new(&binary)
        .args(["gateway", "restart"])
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(io::Error::other(format!(
            "hermes gateway restart failed (status {:?}): {}{}",
            output.status.code(),
            stderr,
            stdout
        )));
    }
    Ok(if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    })
}

/// Platform-specific filename for the Hermes binary. `.exe` on
/// Windows so `dir.join(BINARY_NAME).is_file()` matches what the
/// installer drops on disk.
#[cfg(target_os = "windows")]
const BINARY_NAME: &str = "hermes.exe";
#[cfg(not(target_os = "windows"))]
const BINARY_NAME: &str = "hermes";

pub fn resolve_hermes_binary() -> io::Result<PathBuf> {
    // 1) Bundled-with-Corey lookups. Distribution channels (the
    // Windows MSI, the macOS .app, future Linux AppImage) ship
    // hermes alongside the Corey executable so users don't have to
    // install it separately. Honoured BEFORE $PATH because a stale
    // system hermes from years ago shouldn't shadow the one that
    // matches the Corey version we're running.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // Tauri 2 `bundle.resources` on Windows lands at
            // `<install_dir>/resources/binaries/hermes.exe`. Try this
            // FIRST because it's the canonical location for bundled
            // CLIs in Corey installers.
            let res = exe_dir.join("resources").join("binaries").join(BINARY_NAME);
            if res.is_file() {
                return Ok(res);
            }
            // Direct sibling: `Corey.exe` next to `hermes.exe` (older
            // hand-rolled portable bundles, or maintainers running a
            // dev build with `--release`).
            let direct = exe_dir.join(BINARY_NAME);
            if direct.is_file() {
                return Ok(direct);
            }
            // Linux AppImage / portable bundle: `bin/hermes` next to
            // the launcher (kept for back-compat with the previous
            // resolver).
            let nested = exe_dir.join("bin").join(BINARY_NAME);
            if nested.is_file() {
                return Ok(nested);
            }
            // macOS .app bundle: exe lives at
            // `Corey.app/Contents/MacOS/Corey`; resources sit at
            // `Corey.app/Contents/Resources/`. Tauri's
            // `bundle.resources = ["binaries/*"]` maps to
            // `Resources/_up_/binaries/hermes` — paths starting one
            // level above `src-tauri` get the `_up_` prefix. We also
            // check the un-prefixed path for non-Tauri bundles.
            if let Some(contents) = exe_dir.parent() {
                let mac_tauri = contents
                    .join("Resources")
                    .join("_up_")
                    .join("binaries")
                    .join(BINARY_NAME);
                if mac_tauri.is_file() {
                    return Ok(mac_tauri);
                }
                let mac_plain = contents
                    .join("Resources")
                    .join("binaries")
                    .join(BINARY_NAME);
                if mac_plain.is_file() {
                    return Ok(mac_plain);
                }
                let mac_legacy = contents.join("Resources").join("bin").join(BINARY_NAME);
                if mac_legacy.is_file() {
                    return Ok(mac_legacy);
                }
            }
        }
    }

    // 2) $PATH lookup. `which` is portable but we avoid spawning; just walk.
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join(BINARY_NAME);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 3) Canonical install paths. macOS / Linux Hermes installer
    // drops the binary at `~/.local/bin/hermes`; the Windows MSI
    // (when used standalone) drops `hermes.exe` under
    // `%LOCALAPPDATA%\Programs\Hermes\`.
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join(".local/bin").join(BINARY_NAME);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local)
            .join("Programs")
            .join("Hermes")
            .join(BINARY_NAME);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "hermes CLI not found next to Corey, on $PATH, or at the canonical install path. Install Hermes or add it to PATH.",
    ))
}
