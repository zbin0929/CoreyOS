//! AI Browser (CDP) — Settings panel that lets non-technical customers
//! give the agent a real, login-persisting browser without ever
//! touching a terminal.
//!
//! ## The problem
//!
//! Hermes' built-in `browser_*` tools (used by `model="hermes-agent"`
//! chats) spawn an ephemeral headless Chromium per task. That means:
//!
//! 1. Every navigation starts from a logged-out state.
//! 2. Sites with a login wall return the login page, and the agent
//!    can't proceed.
//! 3. The customer's *own* Chrome (where they're already logged into
//!    their backends) is invisible to the agent — Chrome doesn't let
//!    two processes share a user-data-dir.
//!
//! ## What this module does
//!
//! Spawns a *dedicated* Chrome instance with:
//!
//! - `--remote-debugging-port=9222` so Hermes' CDP layer can attach
//! - `--user-data-dir=~/.hermes/chrome-debug` so the profile persists
//!   across launches (customer logs into each site **once**, ever)
//! - `--no-first-run --no-default-browser-check` to suppress Chrome's
//!   onboarding nag
//!
//! Then writes `BROWSER_CDP_URL=http://localhost:9222` into
//! `~/.hermes/.env` (the only non-API-key env var Corey owns at this
//! layer — see `hermes_config::env::is_allowed_env_key`) and restarts
//! the Hermes Gateway so its next agent loop picks up the CDP wiring.
//!
//! ## Why a dedicated profile (not the customer's main Chrome)
//!
//! Chrome refuses to open two processes against the same user-data-dir
//! (it'll silently focus the existing window or print
//! "Profile is already in use"). Asking the customer to quit their
//! main Chrome is a non-starter — they have 30 tabs open. So we run a
//! second Chrome with its own profile. The customer logs into each
//! backend **once** in that window, and from then on the agent has
//! permanent session cookies.
//!
//! ## Non-goals (for this MVP)
//!
//! - We don't read Chrome's Cookies sqlite to display "logged in to:
//!   amazon.com, sellercentral.amazon.com" — Chrome holds an exclusive
//!   lock on it while the process is alive, and reading via CDP
//!   requires an authenticated WebSocket. Add in v0.2.13 if customers
//!   ask "did my login take?".
//! - No on-update bootstrap. If a customer was on v0.2.10, upgraded to
//!   v0.2.11, and never visits Settings → AI Browser, the agent
//!   continues to use the headless default. That's intentional —
//!   activating CDP changes which Chrome the agent drives, and we
//!   shouldn't surprise users with a foreground Chrome window on
//!   first launch after upgrade.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::hermes_config;
use crate::state::AppState;

/// Port we always use. 9222 is the de-facto Chrome devtools default;
/// Hermes' own `/browser connect` slash command also defaults here, so
/// the two systems are wire-compatible without any extra config.
const CDP_PORT: u16 = 9222;

/// Snapshot returned to the Settings panel on load + after every
/// launch / stop action.
#[derive(Debug, Serialize, Clone)]
pub struct BrowserCdpStatus {
    /// Is **something** listening on 9222? True doesn't *prove* it's
    /// our Chrome (could be the customer's manually-launched one), but
    /// it means the agent can attach successfully.
    pub running: bool,
    /// Always 9222 today. Exposed so the UI can render
    /// "localhost:9222" verbatim.
    pub port: u16,
    /// `~/.hermes/chrome-debug` — shown to power users so they can
    /// back it up or wipe it. Empty string if Hermes home can't be
    /// resolved (extremely unusual).
    pub profile_dir: String,
    /// Detected Chrome executable, or `None` if we can't find one. The
    /// UI shows an actionable "install Chrome / point us at a Chrome
    /// binary" message in that case.
    pub chrome_path: Option<String>,
    /// `true` when `BROWSER_CDP_URL` is set in `~/.hermes/.env`. If the
    /// customer has Chrome listening but the env isn't written, the
    /// Hermes Gateway won't actually route to it — the UI uses this to
    /// nudge them to click "Launch" again.
    pub env_configured: bool,
}

#[derive(Debug, Serialize)]
pub struct BrowserCdpLaunchResult {
    pub status: BrowserCdpStatus,
    /// What happened. Useful for surfacing in the UI when launch
    /// partially succeeded (Chrome started, env written, but gateway
    /// restart failed).
    pub message: String,
}

fn profile_dir() -> IpcResult<PathBuf> {
    hermes_config::hermes_dir()
        .map(|d| d.join("chrome-debug"))
        .map_err(|e| IpcError::Internal {
            message: format!("hermes data dir: {e}"),
        })
}

/// Probe localhost:9222 to see if a Chrome process is already
/// listening. We use a short TCP connect (200 ms) instead of an HTTP
/// fetch because Chrome may briefly accept the TCP connection before
/// the JSON API is ready; the cheap TCP probe is good enough for "is
/// something there?".
fn port_is_listening(port: u16) -> bool {
    // Constructing the address by hand avoids the `parse().unwrap()`
    // antipattern (clippy::unwrap_used gate) — and is arguably clearer:
    // we know exactly which loopback we want.
    let addr = SocketAddr::from((std::net::Ipv4Addr::new(127, 0, 0, 1), port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Find a usable Chrome / Chromium executable. Returns `None` when
/// nothing's installed — the UI surfaces an "Install Chrome" link in
/// that case. Order: stable Chrome first (most customers have it),
/// then Chromium / Canary as fallbacks.
fn detect_chrome_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        for p in &[
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ] {
            let path = Path::new(p);
            if path.exists() {
                return Some(path.to_path_buf());
            }
        }
        None
    }
    #[cfg(target_os = "windows")]
    {
        let candidates: Vec<PathBuf> = vec![
            PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        ];
        for p in candidates {
            if p.exists() {
                return Some(p);
            }
        }
        // LocalAppData install (Chrome per-user installer). We read
        // %LOCALAPPDATA% directly to avoid pulling in the `dirs`
        // crate just for this one path. Tauri's Tauri-Windows env
        // always has this set; the unwrap_or fallback keeps the cfg
        // block well-formed if someone strips it.
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for tail in &[
                r"Google\Chrome\Application\chrome.exe",
                r"Chromium\Application\chrome.exe",
            ] {
                let candidate = local.join(tail);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
        None
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for name in &[
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
        ] {
            if let Ok(out) = Command::new("which").arg(name).output() {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Some(PathBuf::from(s));
                    }
                }
            }
        }
        None
    }
}

fn env_configured() -> bool {
    matches!(
        hermes_config::read_env_value("BROWSER_CDP_URL"),
        Ok(Some(v)) if !v.trim().is_empty()
    )
}

fn build_status() -> BrowserCdpStatus {
    BrowserCdpStatus {
        running: port_is_listening(CDP_PORT),
        port: CDP_PORT,
        profile_dir: profile_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        chrome_path: detect_chrome_path().map(|p| p.to_string_lossy().to_string()),
        env_configured: env_configured(),
    }
}

/// What the Settings panel renders on mount. Cheap (TCP probe + 2 fs
/// stats) so it's fine to call on every focus.
#[tauri::command]
pub async fn browser_cdp_status() -> IpcResult<BrowserCdpStatus> {
    tokio::task::spawn_blocking(build_status)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("status join: {e}"),
        })
}

/// Spawn Chrome with remote debugging, persist `BROWSER_CDP_URL` to
/// `~/.hermes/.env`, and bounce Hermes Gateway so the next agent call
/// uses CDP. Idempotent: if Chrome is already listening on 9222, we
/// only (re)write the env var + restart gateway.
#[tauri::command]
pub async fn browser_cdp_launch(state: State<'_, AppState>) -> IpcResult<BrowserCdpLaunchResult> {
    let journal = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || launch_sync(&journal))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("launch join: {e}"),
        })?
}

fn launch_sync(journal: &Path) -> IpcResult<BrowserCdpLaunchResult> {
    let dir = profile_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| IpcError::Internal {
        message: format!("create profile dir {}: {e}", dir.display()),
    })?;

    let mut message = String::new();

    if port_is_listening(CDP_PORT) {
        message.push_str("Chrome was already listening on port 9222 — reusing it. ");
    } else {
        let chrome = detect_chrome_path().ok_or_else(|| IpcError::Internal {
            message:
                "No Chrome / Chromium / Edge installation detected. Please install Chrome first."
                    .to_string(),
        })?;
        spawn_chrome(&chrome, &dir)?;
        // Wait up to 8 seconds for the debug port to come up. Cold
        // Chrome on macOS typically takes 1-3 seconds; first-ever
        // launch with the new profile can hit 5-6.
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if port_is_listening(CDP_PORT) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !port_is_listening(CDP_PORT) {
            return Err(IpcError::Internal {
                message: format!(
                    "Chrome was spawned ({}) but didn't open port {CDP_PORT} within 8 seconds. Try again in a moment, or check that no firewall is blocking localhost.",
                    chrome.display()
                ),
            });
        }
        message.push_str("Chrome launched. ");
    }

    let cdp_url = format!("http://localhost:{CDP_PORT}");
    hermes_config::write_env_key("BROWSER_CDP_URL", Some(&cdp_url), Some(journal)).map_err(
        |e| IpcError::Internal {
            message: format!("write BROWSER_CDP_URL: {e}"),
        },
    )?;
    message.push_str("BROWSER_CDP_URL written. ");

    match hermes_config::gateway_restart() {
        Ok(_) => message.push_str("Hermes Gateway restarted."),
        Err(e) => {
            // Don't fail the whole IPC — Chrome is up + env is
            // written, the customer just needs to bounce gateway
            // manually (or it'll pick up on next natural restart).
            tracing::warn!("gateway restart after CDP launch failed: {e}");
            message.push_str(
                "Hermes Gateway restart skipped (will pick up the change on next launch).",
            );
        }
    }

    Ok(BrowserCdpLaunchResult {
        status: build_status(),
        message,
    })
}

/// Stop the dedicated Chrome and clear `BROWSER_CDP_URL`. We
/// intentionally don't `kill -9` Chrome by PID: the customer might
/// have opened tabs in it we don't want to lose (this is, after all,
/// their AI browser). Instead, we just remove the env var + restart
/// gateway. The Chrome process can be quit manually via Cmd-Q / Alt-F4
/// when the customer's ready.
#[tauri::command]
pub async fn browser_cdp_stop(state: State<'_, AppState>) -> IpcResult<BrowserCdpStatus> {
    let journal = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || stop_sync(&journal))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("stop join: {e}"),
        })?
}

fn stop_sync(journal: &Path) -> IpcResult<BrowserCdpStatus> {
    hermes_config::write_env_key("BROWSER_CDP_URL", None, Some(journal)).map_err(|e| {
        IpcError::Internal {
            message: format!("clear BROWSER_CDP_URL: {e}"),
        }
    })?;
    if let Err(e) = hermes_config::gateway_restart() {
        tracing::warn!("gateway restart after CDP stop failed: {e}");
    }
    Ok(build_status())
}

/// Wipe the dedicated Chrome profile (cookies, history, the lot). For
/// when the customer wants the AI Browser to "forget" what it's logged
/// into — typically before handing the laptop off to someone else.
/// Refuses to run while Chrome is still alive because deleting a
/// running profile is undefined behaviour on Windows.
#[tauri::command]
pub async fn browser_cdp_clear_cookies() -> IpcResult<BrowserCdpStatus> {
    tokio::task::spawn_blocking(clear_cookies_sync)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("clear join: {e}"),
        })?
}

fn clear_cookies_sync() -> IpcResult<BrowserCdpStatus> {
    if port_is_listening(CDP_PORT) {
        return Err(IpcError::Internal {
            message: "Please quit the AI Browser window first (Chrome must be closed before its profile can be wiped).".to_string(),
        });
    }
    let dir = profile_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| IpcError::Internal {
            message: format!("remove profile dir {}: {e}", dir.display()),
        })?;
    }
    Ok(build_status())
}

/// OS-specific Chrome spawn. The key invariants — same across all
/// three platforms — are:
///
/// - The process is **detached**: Corey shouldn't keep Chrome alive
///   when Corey quits, and Chrome shouldn't have its stdio plumbed to
///   Corey (we'd accumulate file handles).
/// - On Windows we add `CREATE_NO_WINDOW` so a stray console doesn't
///   pop up next to Chrome.
fn spawn_chrome(chrome: &Path, profile: &Path) -> IpcResult<()> {
    let port_arg = format!("--remote-debugging-port={CDP_PORT}");
    let profile_arg = format!("--user-data-dir={}", profile.display());
    let args = [
        port_arg.as_str(),
        profile_arg.as_str(),
        "--no-first-run",
        "--no-default-browser-check",
        // Suppress the "Restore session?" prompt — annoying for an
        // automation-facing profile.
        "--hide-crash-restore-bubble",
    ];

    let mut cmd = Command::new(chrome);
    cmd.args(args);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000 (no console pop-up); Chrome
        // still draws its own window, this only hides the parent
        // shell that Rust would otherwise spawn.
        cmd.creation_flags(0x08000000);
    }

    #[cfg(unix)]
    {
        use std::process::Stdio;
        // Detach stdio so Corey quitting doesn't take Chrome with it.
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
    }

    cmd.spawn().map_err(|e| IpcError::Internal {
        message: format!("spawn chrome at {}: {e}", chrome.display()),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdp_port_is_9222() {
        // Don't change this constant casually — Hermes' /browser
        // connect default is also 9222, and they need to match for
        // the wire to work.
        assert_eq!(CDP_PORT, 9222);
    }

    #[test]
    fn detect_chrome_smoke_test() {
        // We don't assert success because CI machines may not have
        // Chrome installed. We only assert the function doesn't
        // panic for ASCII paths on any platform.
        let _ = detect_chrome_path();
    }

    #[test]
    fn port_probe_returns_false_on_random_high_port() {
        // 1 is privileged and never listens; if it does, something
        // is fundamentally broken on this machine.
        assert!(!port_is_listening(1));
    }
}
