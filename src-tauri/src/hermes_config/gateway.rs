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
    /// True if the binary exists but `hermes --version` fails (broken install).
    pub broken: bool,
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
            broken: false,
            path: None,
            version: None,
            version_parsed: None,
            compatibility: HermesCompatibility::Unknown,
            compatibility_detail: "Hermes not installed".into(),
        };
    };

    let version_output = run_hermes(&path, &["--version"]).ok();
    let raw_success = version_output.as_ref().is_some_and(|o| o.status.success());

    let version = if raw_success {
        version_output.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        try_python_module_fallback(&["--version"]).ok()
    };

    let broken = !raw_success && version.is_none();

    let version_parsed = version.as_deref().and_then(parse_hermes_version);
    let (compatibility, compatibility_detail) = match version_parsed {
        Some((maj, min, _patch)) => evaluate_compat(maj, min),
        None => (
            HermesCompatibility::Unknown,
            if broken {
                "Hermes binary found but broken — reinstall with: pip install --upgrade hermes-agent".into()
            } else {
                "Could not parse Hermes version string; assuming compatible.".into()
            },
        ),
    };
    HermesDetection {
        installed: true,
        broken,
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
            let mut c = std::process::Command::new(cmd);
            c.arg("--version");
            suppress_window(&mut c);
            let out = c.output().ok()?;
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
            let mut c = std::process::Command::new(cmd);
            c.args(["-m", "pip", "--version"]);
            suppress_window(&mut c);
            c.output().map(|o| o.status.success()).unwrap_or(false)
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

/// Idempotent patch that injects approval SSE support into Hermes'
/// `gateway/platforms/api_server.py`. Hermes v0.11 (and likely several
/// versions after) does NOT register `register_gateway_notify` for the
/// api_server platform, so dangerous-command approval events never reach
/// SSE consumers (Corey). This patch:
///   1. Registers a `_on_approval` callback that pushes `("__approval__", data)`
///      into the stream queue.
///   2. Extends `_emit` to forward `__approval__` tuples as
///      `event: hermes.approval` SSE events.
///
/// The patch is a pure string replacement (no regex, no AST). It is
/// idempotent: if either replacement pattern is already absent (i.e. the
/// patch was applied or Hermes upstream fixed the gap), it becomes a no-op.
pub fn patch_approval_sse() {
    let hermes_dir = match crate::paths::hermes_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let candidate = hermes_dir
        .join("hermes-agent")
        .join("gateway")
        .join("platforms")
        .join("api_server.py");

    let mut content = match std::fs::read_to_string(&candidate) {
        Ok(c) => c,
        Err(_) => return,
    };

    if content.contains("__approval__") {
        tracing::debug!("patch_approval_sse: already patched, skipping");
        return;
    }

    let p1_needle = r#"                    )
                else:
                    content_chunk = {"#;
    let p1_replacement = r#"                    )
                elif isinstance(item, tuple) and len(item) == 2 and item[0] == "__approval__":
                    event_data = json.dumps(item[1])
                    await response.write(
                        f"event: hermes.approval\ndata: {event_data}\n\n".encode()
                    )
                else:
                    content_chunk = {"#;

    let mut patched = false;
    if content.contains(p1_needle) {
        content = content.replacen(p1_needle, p1_replacement, 1);
        patched = true;
    }

    let p2_needle = r#"            agent_ref = [None]
            agent_task = asyncio.ensure_future(self._run_agent("#;
    let p2_replacement = r#"            def _on_approval(ad):
                ad["_session_id"] = session_id or ""
                _stream_q.put(("__approval__", ad))
            os.environ["HERMES_EXEC_ASK"] = "1"
            os.environ["HERMES_SESSION_KEY"] = session_id or ""
            try:
                from tools.approval import register_gateway_notify as _ra
                _ra(session_id or "", _on_approval)
            except Exception:
                pass

            agent_ref = [None]
            agent_task = asyncio.ensure_future(self._run_agent("#;

    if content.contains(p2_needle) {
        content = content.replacen(p2_needle, p2_replacement, 1);
        patched = true;
    }

    if patched {
        match std::fs::write(&candidate, &content) {
            Ok(()) => tracing::info!("patch_approval_sse: applied successfully"),
            Err(e) => tracing::warn!(error = %e, "patch_approval_sse: write failed"),
        }
    } else {
        tracing::warn!("patch_approval_sse: no matching patterns found — Hermes may have changed");
    }

    let p3_needle =
        r#"            self._app.router.add_post("/api/jobs", self._handle_create_job)"#;
    let p3_replacement = r#"            self._app.router.add_post("/api/jobs", self._handle_create_job)
            self._app.router.add_post("/api/approval/respond", self._handle_approval_respond)
            self._app.router.add_post("/api/approval/pending", self._handle_approval_pending)"#;

    if content.contains(p3_needle) && !content.contains("_handle_approval_respond") {
        content = content.replacen(p3_needle, p3_replacement, 1);
        let handler_code = r#"
    async def _handle_approval_respond(self, request: "web.Request") -> "web.Response":
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        session_id = body.get("session_id", "")
        choice = body.get("choice", "deny")
        approval_id = body.get("approval_id", "")
        if choice not in ("once", "session", "always", "deny"):
            return web.json_response({"error": f"Invalid choice: {choice}"}, status=400)
        try:
            from tools.approval import (
                resolve_gateway_approval,
                approve_session,
                approve_permanent,
                save_permanent_allowlist,
                _pending,
                _lock,
            )
            pending = None
            with _lock:
                queue = _pending.get(session_id)
                if isinstance(queue, list):
                    if approval_id:
                        for i, entry in enumerate(queue):
                            if entry.get("approval_id") == approval_id:
                                pending = queue.pop(i)
                                break
                        else:
                            pending = queue.pop(0) if queue else None
                    else:
                        pending = queue.pop(0) if queue else None
                    if not queue:
                        _pending.pop(session_id, None)
                elif queue:
                    pending = _pending.pop(session_id, None)
            if pending:
                keys = pending.get("pattern_keys") or [pending.get("pattern_key", "")]
                if choice in ("once", "session"):
                    for k in keys:
                        approve_session(session_id, k)
                elif choice == "always":
                    for k in keys:
                        approve_session(session_id, k)
                        approve_permanent(k)
                    save_permanent_allowlist(_permanent_approved)
            resolve_gateway_approval(session_id, choice, resolve_all=False)
            return web.json_response({"ok": True, "choice": choice})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_approval_pending(self, request: "web.Request") -> "web.Response":
        session_id = request.query.get("session_id", "")
        try:
            from tools.approval import _pending, _lock
            with _lock:
                p = _pending.get(session_id)
                if isinstance(p, list):
                    if p:
                        return web.json_response({"pending": p[0], "pending_count": len(p)})
                    return web.json_response({"pending": None})
                elif p:
                    return web.json_response({"pending": p})
                return web.json_response({"pending": None})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
"#;
        content = content.replace(
            "    async def _handle_health(self",
            &format!("{handler_code}\n    async def _handle_health(self"),
        );
        match std::fs::write(&candidate, &content) {
            Ok(()) => tracing::info!("patch_approval_sse: added /api/approval/respond endpoint"),
            Err(e) => tracing::warn!(error = %e, "patch_approval_sse: write failed for p3"),
        }
    }
}

pub fn patch_dangerous_patterns() {
    let hermes_dir = match crate::paths::hermes_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let candidate = hermes_dir
        .join("hermes-agent")
        .join("tools")
        .join("approval.py");

    let mut content = match std::fs::read_to_string(&candidate) {
        Ok(c) => c,
        Err(_) => return,
    };

    if content.contains("corey_rm_any_file") {
        tracing::debug!("patch_dangerous_patterns: already patched, skipping");
        return;
    }

    let needle =
        r#"    (r'\bgit\s+push\b.*-f\b', "git force push short flag (rewrites remote history)"),"#;
    let extra = r#"
    # --- Corey additions: require approval for any rm / file write ---
    (r'\brm\s+(?!(-h$|--help\b))\S', "corey_rm_any_file"),
    (r'\bmv\s+\S+\s+\S+', "corey_mv_file"),
    (r'\bcp\s+\S+\s+\S+', "corey_cp_overwrite"),
    (r'\bsed\s+-[^\s]*i', "corey_sed_inplace"),
"#;

    if content.contains(needle) {
        content = content.replace(needle, &format!("{needle}{extra}"));
        match std::fs::write(&candidate, content) {
            Ok(()) => tracing::info!("patch_dangerous_patterns: applied"),
            Err(e) => tracing::warn!(error = %e, "patch_dangerous_patterns: write failed"),
        }
    } else {
        tracing::warn!("patch_dangerous_patterns: anchor pattern not found");
    }
}

/// Shell out to `hermes gateway start`. Same resolution / capture
/// semantics as [`gateway_restart`]; used by the Home page "Start
/// gateway" affordance when the binary is present but no process is
/// listening on 127.0.0.1:8642 yet.
pub fn gateway_start() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;

    if cfg!(target_os = "windows") {
        return windows_gateway_spawn(&binary);
    }

    let output = run_hermes(&binary, &["gateway", "start"])?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        let combined = format!("{stderr}{stdout}");
        if combined.contains("ModuleNotFoundError") || combined.contains("No module named") {
            if let Ok(fallback) = try_python_module_fallback(&["gateway", "start"]) {
                return Ok(fallback);
            }
        }
        return Err(io::Error::other(format!(
            "hermes gateway start failed (status {:?}): {}{}",
            output.status.code(),
            stderr,
            stdout
        )));
    }
    let result = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    patch_approval_sse();
    patch_dangerous_patterns();
    Ok(result)
}

/// Shell out to `hermes gateway restart`. Tries `$PATH` first, then falls back
/// to `~/.local/bin/hermes` (where Hermes installs by default on macOS). The
/// command is synchronous — callers should run this off the Tokio runtime's
/// main thread (i.e. via `spawn_blocking` or in an async IPC handler).
pub fn gateway_restart() -> io::Result<String> {
    let binary = resolve_hermes_binary()?;

    if cfg!(target_os = "windows") {
        return windows_gateway_spawn(&binary);
    }

    let output = run_hermes(&binary, &["gateway", "restart"])?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let combined = format!("{stderr}{stdout}");
        if combined.contains("ModuleNotFoundError") || combined.contains("No module named") {
            if let Ok(fallback) = try_python_module_fallback(&["gateway", "restart"]) {
                return Ok(fallback);
            }
        }
        return Err(io::Error::other(format!(
            "hermes gateway restart failed (status {:?}): {}{}",
            output.status.code(),
            stderr,
            stdout
        )));
    }
    let result = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    patch_approval_sse();
    patch_dangerous_patterns();
    Ok(result)
}

/// Resolve the bundled bootstrap script path for the current platform.
fn resolve_bootstrap_script(resource_dir: &Path) -> io::Result<PathBuf> {
    let script_name = if cfg!(target_os = "windows") {
        "assets/scripts/bootstrap-windows.ps1"
    } else {
        "assets/scripts/bootstrap-macos.sh"
    };
    let path = resource_dir.join(script_name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(io::Error::other(format!(
            "bootstrap script not found at {}",
            path.display()
        )))
    }
}

/// Run the platform-specific bootstrap script to install Hermes.
/// This is a fire-and-forget operation — the script may require
/// elevation and runs interactively. The script logs to
/// `%LOCALAPPDATA%\Corey\logs\bootstrap-<platform>.log` on Windows
/// and `~/.corey/logs/bootstrap-<platform>.log` on macOS/Linux.
pub fn run_bootstrap_script(resource_dir: &Path) -> io::Result<String> {
    let script_path = resolve_bootstrap_script(resource_dir)?;
    let data_dir = crate::paths::hermes_data_dir().unwrap_or_else(|_| PathBuf::from("."));

    #[cfg(target_os = "windows")]
    let corey_install_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| resource_dir.to_path_buf());

    #[cfg(target_os = "windows")]
    {
        let log_dir = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|p| p.join("Corey").join("logs"))
            .unwrap_or_else(|| data_dir.join("logs"));
        let _ = std::fs::create_dir_all(&log_dir);
        let log_file = log_dir.join("bootstrap-windows.log");
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args([
            "-ExecutionPolicy",
            "Bypass",
            "-NoProfile",
            "-File",
            script_path.to_str().unwrap_or_default(),
        ]);
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("HERMES_HOME", &data_dir);
        cmd.env("COREY_INSTALL_DIR", &corey_install_dir);
        tracing::info!(
            "bootstrap env: COREY_INSTALL_DIR={}, HERMES_HOME={}",
            corey_install_dir.display(),
            data_dir.display()
        );
        cmd.stdout(std::process::Stdio::inherit());
        cmd.stderr(std::process::Stdio::inherit());
        let mut child = cmd.spawn()?;
        let status = child.wait()?;
        let _ = std::fs::write(
            &log_file,
            format!("exit_code: {}\n", status.code().unwrap_or(-1)),
        );
        if status.success() {
            Ok(format!(
                "Installation completed successfully. Log: {}",
                log_file.display()
            ))
        } else {
            let code = status.code().unwrap_or(-1);
            Err(io::Error::other(format!(
                "Bootstrap failed (exit code {code}). Log: {}",
                log_file.display()
            )))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::io::Read;
        let log_dir = data_dir.join("logs");
        let _ = std::fs::create_dir_all(&log_dir);
        let log_file = log_dir.join("bootstrap-macos.log");
        let mut cmd = std::process::Command::new("bash");
        cmd.arg(&script_path);
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("HERMES_HOME", &data_dir);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn()?;
        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut out) = child.stdout.take() {
            let _ = out.read_to_string(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut stderr);
        }
        let status = child.wait()?;
        let _ = std::fs::write(&log_file, format!("{}\n{}", stdout, stderr));
        if status.success() {
            Ok(format!(
                "Installation completed successfully. Log: {}",
                log_file.display()
            ))
        } else {
            let code = status.code().unwrap_or(-1);
            Err(io::Error::other(format!(
                "Bootstrap failed (exit code {code}). Log: {}",
                log_file.display()
            )))
        }
    }
}

/// Inject `HERMES_HOME` into the child process environment so Hermes
/// reads/writes the same data directory Corey resolved (which may differ
/// from the platform default when the user moved it via Settings).
/// Hermes natively honours `HERMES_HOME`; without this the gateway
/// would still use `~/.hermes` even after the user relocated data.
pub fn inject_hermes_home(cmd: &mut std::process::Command) {
    if let Ok(dir) = crate::paths::hermes_data_dir() {
        cmd.env("HERMES_HOME", dir);
    }
}

#[cfg(target_os = "windows")]
pub fn suppress_window(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn suppress_window(_cmd: &mut std::process::Command) {}

fn run_hermes(binary: &PathBuf, args: &[&str]) -> io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new(binary);
    cmd.args(args);
    inject_hermes_home(&mut cmd);
    suppress_window(&mut cmd);
    cmd.output()
}

#[cfg(target_os = "windows")]
fn windows_gateway_spawn(binary: &PathBuf) -> io::Result<String> {
    use std::process::Stdio;

    let log_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("Corey").join("logs"))
        .unwrap_or_else(|| {
            crate::paths::hermes_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("logs")
        });
    let _ = std::fs::create_dir_all(&log_dir);
    let gw_log = log_dir.join("gateway-start.log");

    let hermes_dir = binary
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let mut start_cmd = std::process::Command::new(binary);
    start_cmd
        .args(["gateway", "start"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref dir) = &hermes_dir {
        start_cmd.current_dir(dir);
    }
    inject_hermes_home(&mut start_cmd);
    suppress_window(&mut start_cmd);

    if let Ok(output) = start_cmd.output() {
        if output.status.success() {
            let _ = std::fs::write(
                &gw_log,
                format!(
                    "gateway start succeeded\nstdout: {}\nstderr: {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr),
                ),
            );
            patch_approval_sse();
            patch_dangerous_patterns();
            return Ok("gateway started via 'gateway start'".into());
        }
        let _ = std::fs::write(
            &gw_log,
            format!(
                "gateway start failed (exit {:?}), falling back to gateway run\nstdout: {}\nstderr: {}",
                output.status.code(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            ),
        );
    }

    let mut run_cmd = std::process::Command::new(binary);
    run_cmd.args(["gateway", "run"]).stdin(Stdio::null());

    let _ = std::fs::write(&gw_log, "falling back to 'gateway run' (foreground)\n");

    if let Ok(stdout_log) = std::fs::File::create(&gw_log) {
        run_cmd.stdout(stdout_log);
    }
    if let Ok(stderr_log) = std::fs::OpenOptions::new().append(true).open(&gw_log) {
        run_cmd.stderr(stderr_log);
    }

    if let Some(ref dir) = &hermes_dir {
        run_cmd.current_dir(dir);
    }
    inject_hermes_home(&mut run_cmd);
    suppress_window(&mut run_cmd);

    let child = run_cmd.spawn()?;
    let pid = child.id();

    std::thread::sleep(std::time::Duration::from_secs(5));

    patch_approval_sse();
    patch_dangerous_patterns();
    Ok(format!(
        "gateway started (pid {pid}, fallback 'gateway run'), log: {}",
        gw_log.display()
    ))
}

#[cfg(not(target_os = "windows"))]
fn windows_gateway_spawn(_binary: &PathBuf) -> io::Result<String> {
    unreachable!()
}

fn try_python_module_fallback(args: &[&str]) -> io::Result<String> {
    let python = if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    };
    let mut full_args = vec!["-m", "hermes_cli"];
    full_args.extend(args);

    let mut cmd = std::process::Command::new(python);
    cmd.args(&full_args);
    inject_hermes_home(&mut cmd);
    suppress_window(&mut cmd);
    let output = cmd.output()?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(io::Error::other(format!(
            "python -m hermes_cli fallback failed (status {:?}): {}{}",
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
    // drops the binary at `~/.local/bin/hermes`; the Windows
    // installer (install.ps1) drops `hermes.exe` under
    // `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\`.
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join(".local/bin").join(BINARY_NAME);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local)
            .join("hermes")
            .join("hermes-agent")
            .join("venv")
            .join("Scripts")
            .join(BINARY_NAME);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    // 2b) HERMES_HOME env var. Bootstrap script installs to
    //     $HERMES_HOME/hermes-agent/venv/Scripts/ when the env var is set.
    #[cfg(target_os = "windows")]
    if let Some(home) = std::env::var_os("HERMES_HOME") {
        let candidate = PathBuf::from(home)
            .join("hermes-agent")
            .join("venv")
            .join("Scripts")
            .join(BINARY_NAME);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    // 3) Corey install dir. The bootstrap script installs hermes-agent
    //    into <corey_install_dir>/hermes-agent/venv/Scripts/ on Windows
    //    (e.g. E:\Program Files\Corey\hermes-agent\venv\Scripts\).
    #[cfg(target_os = "windows")]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(install_dir) = exe.parent() {
            let candidate = install_dir
                .join("hermes-agent")
                .join("venv")
                .join("Scripts")
                .join(BINARY_NAME);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "hermes CLI not found next to Corey, on $PATH, or at the canonical install path. Install Hermes or add it to PATH.",
    ))
}
