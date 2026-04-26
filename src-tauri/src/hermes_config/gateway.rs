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

fn resolve_hermes_binary() -> io::Result<PathBuf> {
    // 1) $PATH lookup. `which` is portable but we avoid spawning; just walk.
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join("hermes");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 2) Fallback to the canonical install path.
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join(".local/bin/hermes");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "hermes CLI not found in $PATH or ~/.local/bin/. Install Hermes or add it to PATH.",
    ))
}
