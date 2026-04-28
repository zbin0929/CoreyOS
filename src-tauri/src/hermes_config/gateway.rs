//! Hermes binary discovery + `hermes gateway start/restart` shell-outs.
//! Split out of the parent module so config-file IO and process
//! management live in separate files.

use std::io;
use std::path::{Path, PathBuf};

/// Hermes version range Corey is built against. Bump these when
/// you've actually tested against a newer Hermes — the `untested`
/// banner protects users from silent OpenClaw-style breakage when
/// upstream schemas drift (e.g. Hermes renames `compression:` →
/// `context_compress:` and Corey's "save" button writes the old
/// shape Hermes can no longer parse).
///
/// Format: `(major, minor)` — patch is forward-compat by convention,
/// minor changes are the boundary.
///
/// 2026-04-28: bumped MAX_TESTED to 0.11 after verifying the v0.11
/// release (a 1556-commit "Interface release" — TUI rewrite,
/// transport ABC, native Bedrock, 5 new providers). Schema-side
/// the relevant Corey-touched yaml sections (`compression:`,
/// `approvals:`, `command_allowlist:`, `model:`) and the
/// `~/.hermes/logs/agent.log` "Context compression triggered" /
/// "Compressed: ... tokens saved" log lines are byte-identical
/// to v0.10. v0.11 also added startup auto-prune for
/// `~/.hermes/sessions/*.jsonl` + VACUUM on `state.db` — that's
/// strictly additive (Corey's session-cleanup panel still works,
/// just with smaller residue to clean).
const HERMES_MIN_SUPPORTED: (u32, u32) = (0, 10);
const HERMES_MAX_TESTED: (u32, u32) = (0, 11);

/// Compatibility verdict between the running Hermes binary and what
/// Corey was built/tested against. Drives the Home-page banner.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HermesCompatibility {
    /// Within the tested range — green light.
    Supported,
    /// Newer than what we tested. Most config writes will still
    /// work but schema drift CAN bite. Show a yellow banner.
    Untested,
    /// Older than the supported floor. Some Corey features (memory
    /// store, auto-compress, MCP server) require ≥ MIN. Show red.
    TooOld,
    /// Couldn't parse the version string at all (e.g. forked
    /// binary with custom version banner). Treat as untested but
    /// with a different banner copy.
    Unknown,
}

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
    /// Parsed semver tuple from `version`, when extractable.
    pub version_parsed: Option<(u32, u32, u32)>,
    /// Verdict against the (MIN, MAX) range Corey was built for.
    pub compatibility: HermesCompatibility,
    /// Diagnostic copy for the UI banner. Locale-neutral English;
    /// the frontend wraps it in a localized prefix.
    pub compatibility_detail: String,
}

/// Locate the Hermes binary + probe its version. Never blocks the
/// caller longer than a single `hermes --version` invocation.
pub fn detect() -> HermesDetection {
    let Ok(path) = resolve_hermes_binary() else {
        return HermesDetection {
            installed: false,
            path: None,
            version: None,
            version_parsed: None,
            compatibility: HermesCompatibility::Unknown,
            compatibility_detail: "Hermes not installed".into(),
        };
    };
    let version = run_hermes(&path, &["--version"])
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
    let version_parsed = version.as_deref().and_then(parse_hermes_version);
    let (compatibility, compatibility_detail) = match version_parsed {
        Some((maj, min, _patch)) => evaluate_compat(maj, min),
        None => (
            HermesCompatibility::Unknown,
            "Could not parse Hermes version string; assuming compatible.".into(),
        ),
    };
    HermesDetection {
        installed: true,
        path: Some(path.display().to_string()),
        version,
        version_parsed,
        compatibility,
        compatibility_detail,
    }
}

/// Pull the first `vX.Y.Z` triple from a `hermes --version` line.
/// Hermes's banner is `Hermes Agent v0.10.0 (2026.4.16)` — we just
/// scan for the first digit-dot-digit-dot-digit run after a `v`.
fn parse_hermes_version(banner: &str) -> Option<(u32, u32, u32)> {
    let bytes = banner.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Locate `v` followed by a digit (avoids false positive on
        // `version` literal etc.).
        if (bytes[i] == b'v' || bytes[i] == b'V')
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            let rest = &banner[i + 1..];
            // Take digits + dots only, then split.
            let token: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            let parts: Vec<&str> = token.split('.').collect();
            if parts.len() >= 3 {
                let maj = parts[0].parse::<u32>().ok()?;
                let min = parts[1].parse::<u32>().ok()?;
                let patch = parts[2].parse::<u32>().ok()?;
                return Some((maj, min, patch));
            }
        }
        i += 1;
    }
    None
}

// ───────────────────────── Install pre-flight ─────────────────────────
//
// Hermes is `pip install hermes-agent` on Python 3.11+. The number-one
// "I followed the docs and it still doesn't work" cause is `pip install`
// failing because:
//   1. user has only Python 2 / 3.9 / 3.10 (Hermes hard-requires 3.11+)
//   2. `pip` isn't on PATH (Linux distros split `python` and `python3-pip`)
//   3. `python --version` exists but `python3 --version` doesn't (or vice
//      versa) — pip command varies per platform
//
// This IPC checks all three before the user runs the install command,
// so the Home-page "not installed" card can replace the generic
// suggestion with a precise "you're missing X" callout. A genuine
// "install for me" button isn't here — running pip with sudo from a GUI
// is a security can of worms, and most users want to see what's
// happening anyway.

#[derive(Debug, serde::Serialize)]
pub struct HermesInstallPreflight {
    /// Resolved Python interpreter path (`python3` or `python` on PATH),
    /// or null if neither is callable.
    pub python_path: Option<String>,
    /// Trimmed `--version` line as Python printed it.
    pub python_version: Option<String>,
    /// Parsed `(major, minor)` for the recommendation logic.
    pub python_version_parsed: Option<(u32, u32)>,
    /// Whether the resolved Python is ≥ 3.11 (Hermes' floor).
    pub python_ok: bool,
    /// Whether `pip --version` returned 0 from the resolved
    /// interpreter (`<python> -m pip --version`).
    pub pip_ok: bool,
    /// One-line summary the UI can show as a status pill.
    pub summary: String,
}

/// Probe Python + pip availability. Cheap (two short subprocess
/// invocations); safe to call from a Home-page card on every
/// re-check click.
pub fn install_preflight() -> HermesInstallPreflight {
    // Try `python3` first (Hermes docs use it; macOS / most Linuxes
    // expect it). Fall back to `python` for Windows / older mac
    // which alias differently.
    let (python_path, version_str) = ["python3", "python"]
        .iter()
        .find_map(|cmd| {
            let out = std::process::Command::new(cmd)
                .arg("--version")
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // Some pythons print version to stderr.
            let v = if v.is_empty() {
                String::from_utf8_lossy(&out.stderr).trim().to_string()
            } else {
                v
            };
            Some((cmd.to_string(), v))
        })
        .map(|(p, v)| (Some(p), Some(v)))
        .unwrap_or((None, None));

    let python_version_parsed = version_str.as_deref().and_then(parse_python_version);
    let python_ok = matches!(python_version_parsed, Some((maj, min)) if maj >= 3 && min >= 11);

    // pip check via `<python> -m pip --version` (avoids pip-vs-pip3 PATH
    // games). Skip if Python itself was missing.
    let pip_ok = python_path
        .as_deref()
        .map(|cmd| {
            std::process::Command::new(cmd)
                .args(["-m", "pip", "--version"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let summary = match (python_ok, pip_ok) {
        (true, true) => format!(
            "Ready to install. Detected {} with pip available.",
            version_str.as_deref().unwrap_or("Python 3.11+")
        ),
        (true, false) => "Python OK, but pip is missing. Install pip first (e.g. `python3 -m ensurepip --upgrade`) before running the install command above.".into(),
        (false, _) if python_path.is_none() => {
            "Python is not installed (or not on PATH). Install Python 3.11+ from https://python.org first.".into()
        }
        (false, _) => format!(
            "Detected {}, but Hermes requires Python 3.11+. Upgrade Python before running pip install.",
            version_str.as_deref().unwrap_or("an older Python")
        ),
    };

    HermesInstallPreflight {
        python_path,
        python_version: version_str,
        python_version_parsed,
        python_ok,
        pip_ok,
        summary,
    }
}

/// Pull `(major, minor)` from `Python 3.11.15` / `Python 3.12.0a1` /
/// similar. Returns None when Python's `--version` shape changed
/// out from under us (very rare).
fn parse_python_version(banner: &str) -> Option<(u32, u32)> {
    // `Python 3.11.15` → take the first three digit-dot run.
    let body = banner.strip_prefix("Python ").unwrap_or(banner).trim();
    let token: String = body
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let maj = parts[0].parse::<u32>().ok()?;
    let min = parts[1].parse::<u32>().ok()?;
    Some((maj, min))
}

#[cfg(test)]
mod preflight_tests {
    use super::*;

    #[test]
    fn parses_canonical_python_banner() {
        assert_eq!(parse_python_version("Python 3.11.15"), Some((3, 11)));
        assert_eq!(parse_python_version("Python 3.12.0a1"), Some((3, 12)));
        assert_eq!(parse_python_version("Python 2.7.18"), Some((2, 7)));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_python_version("nothing here"), None);
        assert_eq!(parse_python_version(""), None);
    }
}

/// Compare a parsed `(major, minor)` against the Corey-tested range.
/// Patch versions are treated as forward-compat (Hermes promises
/// not to break schema in patch releases).
fn evaluate_compat(maj: u32, min: u32) -> (HermesCompatibility, String) {
    let cur = (maj, min);
    if cur < HERMES_MIN_SUPPORTED {
        (
            HermesCompatibility::TooOld,
            format!(
                "Detected Hermes v{}.{}.x; Corey requires ≥ v{}.{}. Please upgrade Hermes (`hermes self-update` or reinstall) — the memory store and auto-compress features need the newer agent.",
                maj, min, HERMES_MIN_SUPPORTED.0, HERMES_MIN_SUPPORTED.1
            ),
        )
    } else if cur > HERMES_MAX_TESTED {
        (
            HermesCompatibility::Untested,
            format!(
                "Detected Hermes v{}.{}.x; Corey was tested against v{}.{}.x. Most things should still work, but config-yaml writes may hit unknown schema fields. If something breaks, fall back to v{}.{} or update Corey.",
                maj, min, HERMES_MAX_TESTED.0, HERMES_MAX_TESTED.1, HERMES_MAX_TESTED.0, HERMES_MAX_TESTED.1
            ),
        )
    } else {
        (
            HermesCompatibility::Supported,
            format!("Hermes v{}.{}.x — supported.", maj, min),
        )
    }
}

#[cfg(test)]
mod compat_tests {
    use super::*;

    #[test]
    fn parses_canonical_banner() {
        assert_eq!(
            parse_hermes_version("Hermes Agent v0.10.0 (2026.4.16)"),
            Some((0, 10, 0))
        );
    }

    #[test]
    fn parses_double_digit_minor() {
        assert_eq!(parse_hermes_version("v1.23.456"), Some((1, 23, 456)));
    }

    #[test]
    fn rejects_no_v_prefix() {
        assert_eq!(parse_hermes_version("0.10.0"), None);
    }

    #[test]
    fn rejects_two_segment() {
        assert_eq!(parse_hermes_version("v0.10"), None);
    }

    #[test]
    fn supported_when_in_range() {
        let (c, _) = evaluate_compat(0, 10);
        assert_eq!(c, HermesCompatibility::Supported);
    }

    #[test]
    fn too_old_when_below_floor() {
        let (c, _) = evaluate_compat(0, 9);
        assert_eq!(c, HermesCompatibility::TooOld);
    }

    #[test]
    fn untested_when_above_ceiling() {
        // Anything >= MAX_TESTED+1 should land in the untested
        // bucket. We use a comfortably future minor here so the
        // test doesn't have to be re-edited every time we bump
        // MAX_TESTED to track an upstream release.
        let (c, _) = evaluate_compat(0, 99);
        assert_eq!(c, HermesCompatibility::Untested);
    }
}

/// Shell out to `hermes gateway start`. Same resolution / capture
/// semantics as [`gateway_restart`]; used by the Home page "Start
/// gateway" affordance when the binary is present but no process is
/// listening on 127.0.0.1:8642 yet.
pub fn gateway_start() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;
    let output = run_hermes(&binary, &["gateway", "start"])?;
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
    let output = run_hermes(&binary, &["gateway", "restart"])?;

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

/// Inject `HERMES_HOME` into the child process environment so Hermes
/// reads/writes the same data directory Corey resolved (which may differ
/// from the platform default when the user moved it via Settings).
/// Hermes natively honours `HERMES_HOME`; without this the gateway
/// would still use `~/.hermes` even after the user relocated data.
fn inject_hermes_home(cmd: &mut std::process::Command) {
    if let Ok(dir) = crate::paths::hermes_data_dir() {
        cmd.env("HERMES_HOME", dir);
    }
}

fn run_hermes(binary: &Path, args: &[&str]) -> io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        // Hermes is officially WSL2-only on Windows. Bridge every gateway
        // command through `wsl -e bash -lc ...` so Corey can manage Hermes
        // from the native Windows app process.
        let mut cmd = std::process::Command::new(binary);
        let mut script = String::new();
        if let Ok(dir) = crate::paths::hermes_data_dir() {
            if let Some(wsl_dir) = windows_to_wsl_path(&dir) {
                script.push_str("HERMES_HOME='");
                script.push_str(&wsl_dir.replace('"', "\\\""));
                script.push_str("' ");
            }
        }
        script.push_str("hermes");
        for a in args {
            script.push(' ');
            script.push_str(a);
        }
        cmd.args(["-e", "bash", "-lc", &script]);
        cmd.output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new(binary);
        cmd.args(args);
        inject_hermes_home(&mut cmd);
        cmd.output()
    }
}

#[cfg(target_os = "windows")]
fn windows_to_wsl_path(path: &Path) -> Option<String> {
    let raw = path.to_string_lossy();
    let mut chars = raw.chars();
    let drive = chars.next()?;
    let colon = chars.next()?;
    if !drive.is_ascii_alphabetic() || colon != ':' {
        return None;
    }
    let rest: String = chars.collect();
    let rest = rest
        .trim_start_matches('\\')
        .trim_start_matches('/')
        .replace('\\', "/");
    if rest.is_empty() {
        return Some(format!("/mnt/{}", drive.to_ascii_lowercase()));
    }
    Some(format!("/mnt/{}/{}", drive.to_ascii_lowercase(), rest))
}

/// Platform-specific filename for the Hermes binary. `.exe` on
/// Windows so `dir.join(BINARY_NAME).is_file()` matches what the
/// installer drops on disk.
#[cfg(target_os = "windows")]
const BINARY_NAME: &str = "hermes.exe";
#[cfg(not(target_os = "windows"))]
const BINARY_NAME: &str = "hermes";

fn resolve_hermes_binary() -> io::Result<PathBuf> {
    // Hermes is a Python package (`pip install hermes-agent`) and
    // upstream releases ship source-only — no precompiled binary
    // we could realistically ship inside the Corey installer.
    // Earlier drafts of this resolver had a "bundled-with-Corey"
    // tier that walked `<install_dir>/resources/binaries/`; it
    // was always a no-op because `src-tauri/binaries/` is empty
    // and `fetch-hermes-binary.mjs` couldn't find anything to
    // download. We deleted those branches to stop pretending the
    // user might have a bundled binary — Hermes onboarding now
    // routes through Settings → Home install card + the
    // `hermes_install_preflight` IPC.
    //
    // 1) $PATH lookup. `which` is portable but we avoid spawning; just walk.
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join(BINARY_NAME);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 2) Canonical install paths. macOS / Linux Hermes installer
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
    {
        // Official Hermes support on Windows is WSL2-only. If WSL is present
        // and can resolve `hermes`, route through `wsl`.
        if let Ok(out) = std::process::Command::new("wsl")
            .args(["-e", "bash", "-lc", "command -v hermes >/dev/null 2>&1"])
            .output()
        {
            if out.status.success() {
                return Ok(PathBuf::from("wsl"));
            }
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
