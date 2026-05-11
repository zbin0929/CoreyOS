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
    /// Domains that have at least one persistent cookie in the
    /// dedicated Chrome profile — i.e. the sites the agent is "logged
    /// into". Read directly from the Chrome `Cookies` sqlite when the
    /// browser is **not** running (Chrome holds an exclusive lock
    /// while alive). Empty list when Chrome is running or the profile
    /// hasn't been initialized yet.
    ///
    /// Exposing this in the Settings panel solves the recurring
    /// customer question "did the agent actually keep my login?" —
    /// they see e.g. "amazon.com, sellercentral.amazon.com" and know
    /// the answer is yes.
    pub logged_in_domains: Vec<String>,
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

pub(crate) fn build_status() -> BrowserCdpStatus {
    let running = port_is_listening(CDP_PORT);
    BrowserCdpStatus {
        running,
        port: CDP_PORT,
        profile_dir: profile_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        chrome_path: detect_chrome_path().map(|p| p.to_string_lossy().to_string()),
        env_configured: env_configured(),
        // Cookies sqlite is locked while Chrome is alive — only read
        // when stopped. The UI handles the empty case gracefully
        // ("Chrome is running — site list visible after stopping").
        logged_in_domains: if running {
            Vec::new()
        } else {
            list_logged_in_domains()
        },
    }
}

/// Boot-time auto-launch hook. Spawns the dedicated Chrome silently
/// when, **and only when**, the customer has previously opted in (env
/// var present in `~/.hermes/.env`) AND nothing is currently listening
/// on the CDP port. This is the answer to "I shouldn't have to click
/// 'Open AI Browser' every time I start Corey": once the customer has
/// signed in once via Settings, the dedicated Chrome quietly comes up
/// on every subsequent launch.
///
/// **Why we DON'T auto-launch when env is missing**: that would mean a
/// foreground Chrome window appears the first time someone opens Corey
/// after install, which is jarring (the panel hasn't had a chance to
/// explain what's happening). The Settings panel is the explicit
/// opt-in; this hook is the implicit reactivation.
///
/// **Cheap side-effects only**: no env writes, no gateway restart,
/// no `IpcResult` plumbing. Returns `Ok(true)` on a successful spawn,
/// `Ok(false)` for "intentionally skipped" (env not configured or port
/// already taken), `Err(...)` for a real failure (Chrome detected but
/// spawn refused, etc.) so the caller can log a `warn!` without
/// crashing app boot.
pub(crate) fn auto_start_if_configured() -> Result<bool, String> {
    if !env_configured() {
        return Ok(false);
    }
    if port_is_listening(CDP_PORT) {
        // A Chrome is already on 9222. If it's the one we spawned in a
        // previous Corey session (pid file present + process alive),
        // we still need to re-apply `Browser.setDownloadBehavior` —
        // download routing is per-process state, NOT persisted across
        // Chrome restarts via Preferences. Skipping this means the
        // FIRST download of every new Corey boot lands in the system
        // Downloads folder, exactly the v0.2.12 demo-day bug.
        //
        // For foreign Chromes (someone else's debug session on 9222)
        // we don't touch — they might have their own download routing
        // and we'd surprise the user.
        if pid_file().exists() {
            if let Err(e) = apply_cdp_download_behavior() {
                tracing::warn!(
                    "auto_start: re-applying setDownloadBehavior to existing AI Browser failed: {e}"
                );
            }
        }
        return Ok(false);
    }
    let Some(chrome) = detect_chrome_path() else {
        return Err("BROWSER_CDP_URL configured but Chrome not detected".into());
    };
    let dir = profile_dir().map_err(|e| format!("profile dir: {e:?}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create profile dir: {e}"))?;
    // Auto-start is always headless — the customer never sees a
    // Chrome window pop up when Corey boots. They click "Open for
    // Sign-in" from Settings the rare times they need a visible
    // window (and that path kills this one first).
    spawn_chrome(&chrome, &dir, true).map_err(|e| format!("spawn chrome: {e:?}"))?;
    // Mirror the post-launch wait + CDP download-routing the explicit
    // `launch_sync` path does. Without this, headless boot-launched
    // Chromes never get `Browser.setDownloadBehavior`, defaulting all
    // downloads back to `~/Downloads` (system default) — which is
    // exactly the v0.2.12 demo-day bug we're fixing.
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if port_is_listening(CDP_PORT) {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    if port_is_listening(CDP_PORT) {
        if let Err(e) = apply_cdp_download_behavior() {
            tracing::warn!(
                "auto_start: apply_cdp_download_behavior failed (will fall back to system Downloads): {e}"
            );
        }
    }
    Ok(true)
}

/// Read the dedicated profile's `Cookies` sqlite and return the set
/// of distinct host keys with persistent cookies. Returns an empty
/// vec on any failure (no profile yet, sqlite locked, schema
/// mismatch on a future Chrome version) — the UI treats that as "no
/// data" rather than an error, which is the right call for a
/// non-essential informational column.
fn list_logged_in_domains() -> Vec<String> {
    let Ok(dir) = profile_dir() else {
        return Vec::new();
    };
    // The default profile's cookie store. Chrome supports multiple
    // profiles ("Profile 1", "Profile 2", ...) but we never create
    // them — the dedicated AI Browser only ever has Default.
    let cookies_db = dir.join("Default").join("Cookies");
    if !cookies_db.exists() {
        return Vec::new();
    }
    use rusqlite::{Connection, OpenFlags};
    let Ok(conn) = Connection::open_with_flags(
        &cookies_db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    // Filter `host_key != ''` to drop blank rows; we don't filter on
    // `expires_utc` because session cookies (expires=0) still imply
    // the user has visited and Chrome remembers state. Cap at 200
    // raw rows so the dedupe + sort cost stays bounded if a power
    // user has been browsing for years.
    let Ok(mut stmt) =
        conn.prepare("SELECT DISTINCT host_key FROM cookies WHERE host_key != '' LIMIT 200")
    else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    let mut domains: Vec<String> = rows
        .filter_map(Result::ok)
        // Chrome sometimes prefixes with '.' for cross-subdomain
        // cookies (".example.com"). Normalize so example.com and
        // .example.com aren't shown as two entries.
        .map(|d| d.trim_start_matches('.').to_string())
        .filter(|d| !d.is_empty())
        .collect();
    domains.sort();
    domains.dedup();
    // 50 is plenty for a panel — power users with hundreds of sites
    // can still see everything by inspecting the profile path
    // directly via the "Technical details" disclosure.
    domains.truncate(50);
    domains
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
    tokio::task::spawn_blocking(move || launch_sync(&journal, true))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("launch join: {e}"),
        })?
}

/// `restart_gateway=false` is used by the MCP tool wrapper — restarting
/// Hermes Gateway from inside an in-flight agent tool call kills the
/// SSE stream the user is reading from. The MCP path emits a frontend
/// event instead and lets the GUI prompt for a restart after the chat
/// turn closes. Direct IPC calls (Settings panel button) are safe to
/// pass `restart_gateway=true`: they're not running inside the
/// agent loop.
pub(crate) fn launch_sync(
    journal: &Path,
    restart_gateway: bool,
) -> IpcResult<BrowserCdpLaunchResult> {
    let dir = profile_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| IpcError::Internal {
        message: format!("create profile dir {}: {e}", dir.display()),
    })?;

    let mut message = String::new();

    // Manual launch from Settings = the customer wants a VISIBLE
    // window (to sign into a new system). If a headless one is
    // running (the auto-start happy path), kill it first so we can
    // hand the profile over to a headed Chrome. Chrome refuses
    // two-processes-same-profile.
    let killed_previous = if port_is_listening(CDP_PORT) {
        match kill_previous_chrome() {
            Ok(true) => {
                message.push_str("Closed background AI Browser so a visible window can open. ");
                true
            }
            // PID file was missing — either a real human-launched
            // Chrome is on 9222 (which we shouldn't kill), or our
            // tracking got out of sync. In the human-launched case
            // we just reuse what's already there; the user already
            // has a window they can sign in via.
            Ok(false) => {
                message.push_str("Chrome was already listening on port 9222 — reusing it. ");
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "kill previous chrome failed");
                false
            }
        }
    } else {
        false
    };

    if !port_is_listening(CDP_PORT) {
        let chrome = detect_chrome_path().ok_or_else(|| IpcError::Internal {
            message:
                "No Chrome / Chromium / Edge installation detected. Please install Chrome first."
                    .to_string(),
        })?;
        spawn_chrome(&chrome, &dir, false)?;
        if !killed_previous {
            message.push_str("Chrome window opened. ");
        }
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
    }

    // Route downloads to `~/.hermes/downloads/` via CDP. This is the
    // authoritative path (vs the Preferences-file seed in `spawn_chrome`,
    // which Chromium frequently ignores due to its signed-MAC scheme).
    // Best-effort: a failure here doesn't fail launch — the user can
    // still browse, they just lose the auto-pick-up-downloads UX.
    if let Err(e) = apply_cdp_download_behavior() {
        tracing::warn!(
            "apply_cdp_download_behavior failed (downloads will land in default location): {e}"
        );
        message.push_str(
            "(note: couldn't auto-route downloads — files will land in your system Downloads folder.) ",
        );
    } else {
        message.push_str("Downloads will land in ~/.hermes/downloads/. ");
    }

    let cdp_url = format!("http://localhost:{CDP_PORT}");
    hermes_config::write_env_key("BROWSER_CDP_URL", Some(&cdp_url), Some(journal)).map_err(
        |e| IpcError::Internal {
            message: format!("write BROWSER_CDP_URL: {e}"),
        },
    )?;
    message.push_str("BROWSER_CDP_URL written. ");

    if restart_gateway {
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
    } else {
        message.push_str(
            "Hermes Gateway will pick up BROWSER_CDP_URL on its next restart \
             (the GUI will prompt after this chat turn finishes).",
        );
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
    tokio::task::spawn_blocking(move || stop_sync(&journal, true))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("stop join: {e}"),
        })?
}

pub(crate) fn stop_sync(journal: &Path, restart_gateway: bool) -> IpcResult<BrowserCdpStatus> {
    hermes_config::write_env_key("BROWSER_CDP_URL", None, Some(journal)).map_err(|e| {
        IpcError::Internal {
            message: format!("clear BROWSER_CDP_URL: {e}"),
        }
    })?;
    // If we spawned the running Chrome (PID file exists), kill it.
    // For a headless background Chrome that's the only way to make
    // it actually go away — there's no window for the user to close.
    // We DON'T touch a Chrome whose PID we don't own (no pid file =
    // user-launched, leave their tabs alone).
    if let Err(e) = kill_previous_chrome() {
        tracing::warn!(error = %e, "kill previous chrome during stop failed");
    }
    if restart_gateway {
        if let Err(e) = hermes_config::gateway_restart() {
            tracing::warn!("gateway restart after CDP stop failed: {e}");
        }
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

/// Wipe cookies for a single domain only. The Settings UI surfaces
/// this as a "✕" next to each chip in the "Sites the AI remembers"
/// list — useful when a customer's session for one backend has
/// expired or they want to re-authenticate as a different user
/// without nuking every other login. Refuses to run while Chrome is
/// alive (sqlite is locked exclusively, same as the full clear).
///
/// Match logic mirrors what `list_logged_in_domains` does on read:
/// we strip a leading dot, then match exact or `.<domain>`. So
/// passing `"amazon.com"` clears both `amazon.com` and
/// `.amazon.com` rows but NOT `sellercentral.amazon.com`. That's
/// deliberate — subdomains often carry separate session cookies and
/// the user should clear them independently if they want to.
#[tauri::command]
pub async fn browser_cdp_clear_domain(domain: String) -> IpcResult<BrowserCdpStatus> {
    tokio::task::spawn_blocking(move || clear_domain_sync(&domain))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("clear_domain join: {e}"),
        })?
}

pub(crate) fn clear_domain_sync(domain: &str) -> IpcResult<BrowserCdpStatus> {
    if port_is_listening(CDP_PORT) {
        return Err(IpcError::Internal {
            message: "Please quit the AI Browser window first (Chrome locks the cookies database \
                      while running)."
                .to_string(),
        });
    }
    let target = domain.trim().trim_start_matches('.').to_string();
    if target.is_empty() {
        return Err(IpcError::Internal {
            message: "domain is empty".to_string(),
        });
    }
    let dir = profile_dir()?;
    let cookies_db = dir.join("Default").join("Cookies");
    if !cookies_db.exists() {
        // Nothing to clear; return current snapshot rather than a
        // confusing "no profile" error.
        return Ok(build_status());
    }
    use rusqlite::{params, Connection};
    let conn = Connection::open(&cookies_db).map_err(|e| IpcError::Internal {
        message: format!("open cookies db: {e}"),
    })?;
    let dotted = format!(".{target}");
    let affected = conn
        .execute(
            "DELETE FROM cookies WHERE host_key = ?1 OR host_key = ?2",
            params![target, dotted],
        )
        .map_err(|e| IpcError::Internal {
            message: format!("delete cookies for {target}: {e}"),
        })?;
    tracing::info!(domain = %target, rows = affected, "cleared per-domain cookies");
    Ok(build_status())
}

pub(crate) fn clear_cookies_sync() -> IpcResult<BrowserCdpStatus> {
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

/// Resolve the directory where AI-Browser downloads (Export-to-Excel,
/// "Download CSV", invoice PDFs, etc.) land. Co-located under
/// `~/.hermes/downloads/` so the agent can `save_artifact(source_path=...)`
/// from a stable, well-known location regardless of the user's
/// system download folder. Created lazily by callers that actually
/// touch downloads (`apply_cdp_download_behavior` /
/// `seed_chrome_download_prefs`); pure resolution here never hits disk.
pub(crate) fn downloads_dir() -> IpcResult<PathBuf> {
    crate::paths::hermes_data_dir()
        .map(|d| d.join("downloads"))
        .map_err(|e| IpcError::Internal {
            message: format!("downloads dir: {e}"),
        })
}

/// Seed Chrome's per-profile `Preferences` JSON with a sane download
/// configuration (default location = `~/.hermes/downloads/`, no
/// "Save As" prompt, auto-upgrade legacy path values). Acts as
/// **fallback** for the canonical CDP-based path
/// (`apply_cdp_download_behavior`) — Chromium signs its own Preferences
/// file with a per-install MAC, so a manually-written prefs file is
/// frequently silently dropped or rewritten on next launch. We still
/// seed it because (a) Chromium honors unsigned `download.*` keys on
/// the very first launch (before the MAC scheme kicks in) and (b) it
/// gives users a sensible default if the runtime CDP call fails.
///
/// Idempotent and conservative: if `Preferences` already exists we
/// leave it alone. The runtime CDP path is the authoritative source
/// of truth.
fn seed_chrome_download_prefs(profile: &Path) {
    let default_dir = profile.join("Default");
    if let Err(e) = std::fs::create_dir_all(&default_dir) {
        tracing::warn!(error = %e, "seed_chrome_download_prefs: create Default/ failed");
        return;
    }
    let prefs_path = default_dir.join("Preferences");
    if prefs_path.exists() {
        return;
    }
    let dl_dir = match downloads_dir() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = ?e, "seed_chrome_download_prefs: downloads_dir resolve failed");
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dl_dir) {
        tracing::warn!(error = %e, "seed_chrome_download_prefs: create downloads dir failed");
        return;
    }
    let prefs = serde_json::json!({
        "download": {
            "default_directory": dl_dir.to_string_lossy().to_string(),
            "directory_upgrade": true,
            "prompt_for_download": false,
        },
        "profile": {
            "default_content_setting_values": {
                "automatic_downloads": 1,
            },
        },
    });
    let body = match serde_json::to_string(&prefs) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "seed_chrome_download_prefs: serialize failed");
            return;
        }
    };
    if let Err(e) = std::fs::write(&prefs_path, body) {
        tracing::warn!(error = %e, path = %prefs_path.display(), "seed_chrome_download_prefs: write failed");
    } else {
        tracing::info!(
            "seeded Chrome download prefs at {} -> {}",
            prefs_path.display(),
            dl_dir.display()
        );
    }
}

/// Tell Chrome via CDP to (a) accept downloads silently, (b) auto-name
/// them on filename collision, and (c) drop every file into our
/// well-known `~/.hermes/downloads/` so `save_artifact(source_path=...)`
/// can pick them up.
///
/// **This is the authoritative download-routing path** — see the doc
/// on `seed_chrome_download_prefs` for why writing the Preferences JSON
/// alone is unreliable on Chromium. Concretely we open a one-shot
/// WebSocket to the Chrome browser-level CDP endpoint and send
/// `Browser.setDownloadBehavior` (Chromium ≥ 73; the previous
/// `Page.setDownloadBehavior` was per-target which doesn't help when
/// the agent navigates across tabs).
///
/// Three failure modes worth understanding:
///
/// 1. We're called BEFORE Chrome has finished writing its
///    `DevToolsActivePort` — `/json/version` returns 404 or empties.
///    The caller (`launch_sync`) already waits for the port to LISTEN
///    via `port_is_listening`; that's typically enough but we add a
///    short retry loop here as belt-and-braces.
/// 2. WebSocket handshake succeeds but `Browser.setDownloadBehavior`
///    returns an `error` (e.g. on an older Chromium that doesn't have
///    it yet). We log + return Ok — the Preferences-file fallback will
///    keep the default user-friendly even if the dynamic write fails.
/// 3. Chrome dies mid-call. The WS read times out at 2 s, we log warn,
///    return Ok. Same fallback applies.
///
/// Best-effort by design: a download-routing failure should NEVER
/// block AI Browser launch. The customer can still navigate / click /
/// snapshot — they just lose the auto-pull-into-artifact convenience.
pub(crate) fn apply_cdp_download_behavior() -> Result<(), String> {
    let dl_dir = downloads_dir().map_err(|e| format!("resolve downloads dir: {e:?}"))?;
    std::fs::create_dir_all(&dl_dir).map_err(|e| format!("create downloads dir: {e}"))?;

    // Build a tiny current-thread tokio runtime so we don't touch
    // (or require) an ambient runtime. `apply_cdp_download_behavior`
    // is called from `spawn_blocking` contexts where there's no
    // surrounding runtime handle to inherit.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => return Err(format!("build runtime: {e}")),
    };

    rt.block_on(async move {
        // (1) Resolve the browser-level WS URL via the JSON HTTP API.
        //     Chrome exposes `/json/version` once `DevToolsActivePort`
        //     has been written; the TCP listen probe in `launch_sync`
        //     doesn't guarantee that, so retry briefly here.
        let mut ws_url: Option<String> = None;
        let deadline = Instant::now() + Duration::from_secs(3);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
            .map_err(|e| format!("build http client: {e}"))?;
        while Instant::now() < deadline {
            match client
                .get(format!("http://localhost:{CDP_PORT}/json/version"))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(v) = resp.json::<serde_json::Value>().await {
                        if let Some(s) = v
                            .get("webSocketDebuggerUrl")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string())
                        {
                            ws_url = Some(s);
                            break;
                        }
                    }
                }
                _ => {}
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        let ws_url = ws_url.ok_or_else(|| {
            "Chrome /json/version never returned a webSocketDebuggerUrl".to_string()
        })?;

        // (2) Open the WS and send setDownloadBehavior. We do NOT
        //     `eventsEnabled=true` because Corey doesn't subscribe to
        //     download progress events (the agent polls the filesystem
        //     via bash). Enabling them would just churn CDP messages.
        use futures::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let (mut ws, _resp) = tokio_tungstenite::connect_async(&ws_url)
            .await
            .map_err(|e| format!("cdp ws connect {ws_url}: {e}"))?;

        let payload = serde_json::json!({
            "id": 1,
            "method": "Browser.setDownloadBehavior",
            "params": {
                "behavior": "allowAndName",
                "downloadPath": dl_dir.to_string_lossy(),
                "eventsEnabled": false,
            }
        });
        ws.send(Message::Text(payload.to_string()))
            .await
            .map_err(|e| format!("cdp ws send: {e}"))?;

        // (3) Wait for the matching response or 2 s timeout, whichever
        //     comes first. Chrome can interleave events on the
        //     browser-level WS, so we read until we see `"id":1` or
        //     hit timeout. Errors get logged but not propagated.
        let read_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if Instant::now() > read_deadline {
                return Err("cdp ws response timeout".to_string());
            }
            let next = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
            let Ok(Some(msg)) = next else {
                continue;
            };
            let msg = match msg {
                Ok(m) => m,
                Err(e) => return Err(format!("cdp ws recv: {e}")),
            };
            let Message::Text(text) = msg else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            if v.get("id").and_then(|x| x.as_u64()) == Some(1) {
                if let Some(err) = v.get("error") {
                    return Err(format!("Browser.setDownloadBehavior error: {err}"));
                }
                break;
            }
        }

        let _ = ws.close(None).await;
        tracing::info!(
            "CDP Browser.setDownloadBehavior applied: downloadPath={}",
            dl_dir.display()
        );
        Ok::<(), String>(())
    })
}

/// OS-specific Chrome spawn. The key invariants — same across all
/// three platforms — are:
///
/// - The process is **detached**: Corey shouldn't keep Chrome alive
///   when Corey quits, and Chrome shouldn't have its stdio plumbed to
///   Corey (we'd accumulate file handles).
/// - On Windows we add `CREATE_NO_WINDOW` so a stray console doesn't
///   pop up next to Chrome.
///
/// `background=true` is what the boot-time auto-start uses: Chrome is
/// launched **headed** (the only way to defeat Akamai/DataDome TLS
/// fingerprinting — see the inline comment in `spawn_chrome`) but the
/// window is positioned far off-screen so the customer doesn't see it
/// pop up. The agent navigates / clicks / types in CDP without the
/// customer ever knowing a Chrome process is running.
///
/// We deliberately do NOT use `--headless=new`. Headless Chrome's
/// ClientHello differs subtly from real Chrome in the JA3/JA4 hash,
/// and enterprise WAFs (UPS / FedEx / Amazon Seller Central) reject
/// it at the TLS layer with `ERR_HTTP2_PROTOCOL_ERROR` before any JS
/// runs. Free open-source stealth flags (`AutomationControlled` etc.)
/// can't fix this — the only fix is using a real GPU/window context.
///
/// `background=false` is what the Settings panel calls when the user
/// explicitly wants a visible window — typically to sign into a new
/// system. Same profile dir, so cookies set in the visible window
/// survive the next background boot.
///
/// One profile = one Chrome process. If a Chrome is already listening
/// on 9222, the caller must `kill_chrome_by_port` first before
/// spawning a different mode — Chrome refuses to open a second
/// process against a locked user-data-dir.
fn spawn_chrome(chrome: &Path, profile: &Path, background: bool) -> IpcResult<()> {
    seed_chrome_download_prefs(profile);
    let port_arg = format!("--remote-debugging-port={CDP_PORT}");
    let profile_arg = format!("--user-data-dir={}", profile.display());
    let mut args = vec![
        port_arg.as_str(),
        profile_arg.as_str(),
        "--no-first-run",
        "--no-default-browser-check",
        // Suppress the "Restore session?" prompt — annoying for an
        // automation-facing profile.
        "--hide-crash-restore-bubble",
        // === Anti-detection flags (free / open-source standard set) ===
        //
        // Why we DON'T use `--headless=new`:
        //   Akamai / DataDome / PerimeterX detect headless Chrome at
        //   the TLS / HTTP-2 layer (ClientHello fingerprint differs
        //   subtly from headed Chrome) and reject the connection
        //   before our JS even runs. We measured this against
        //   ups.com — headless got `ERR_HTTP2_PROTOCOL_ERROR`,
        //   the same Chrome binary in headed mode loaded the page
        //   normally. Cost of going headed: a real GPU/window
        //   context (we hide the window off-screen, see below).
        //
        // The flag below removes the `navigator.webdriver=true`
        // signal that's set whenever `--remote-debugging-port` is
        // present. This single flag passes ~80% of low-effort bot
        // detectors (basic Cloudflare, npm package detection tests).
        "--disable-blink-features=AutomationControlled",
        // Drop the "Chrome is being controlled by automated test
        // software" infobar AND the corresponding `webdriver`
        // capability advertisement.
        "--exclude-switches=enable-automation",
        // Akamai sometimes inspects the `sec-ch-ua` Client Hints
        // for headless quirks. Disabling Client Hints forces the
        // request to the classic `User-Agent`-only path which our
        // override below sets to a real Chrome string.
        "--disable-features=UserAgentClientHint,IsolateOrigins,site-per-process",
    ];

    let position_arg;
    let size_arg;
    if background {
        // "Background mode" = headed Chrome with the window dragged
        // off-screen. Customer never sees the window pop up at boot
        // (preserves the original UX intent), but Chrome runs with a
        // real GPU/JS rendering context — TLS fingerprint matches a
        // real user's Chrome, so Akamai-class WAFs let us through.
        //
        // -2400,-2400 is well outside any conceivable monitor layout
        // (even a 4K external on the left of a MacBook tops out
        // around -3840 width-wise; vertically nothing goes that far
        // negative). 1280×800 is large enough that responsive sites
        // serve their desktop layout, not the mobile one — UPS /
        // FedEx / Amazon Seller Central all gate "the real UI"
        // behind a desktop viewport check.
        position_arg = "--window-position=-2400,-2400".to_string();
        size_arg = "--window-size=1280,800".to_string();
        args.push(&position_arg);
        args.push(&size_arg);
        // `--silent-launch` keeps Chrome from focus-stealing or
        // bouncing in the macOS Dock when we spawn it at boot.
        args.push("--silent-launch");
    } else {
        // Visible mode (Settings → "Open AI Browser for sign-in"):
        // size the window slightly smaller than full-screen so the
        // user can see Corey's main window behind it.
        position_arg = "--window-position=120,80".to_string();
        size_arg = "--window-size=1280,820".to_string();
        args.push(&position_arg);
        args.push(&size_arg);
    }

    let mut cmd = Command::new(chrome);
    cmd.args(&args);

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

    let child = cmd.spawn().map_err(|e| IpcError::Internal {
        message: format!("spawn chrome at {}: {e}", chrome.display()),
    })?;
    let chrome_pid = child.id();
    // Persist PID so we can kill this specific Chrome later when
    // switching background<->headed. `lsof -i:9222` would also work
    // on Unix but we'd need a Windows equivalent; a PID file is
    // boring and cross-platform.
    let pid_path = pid_file();
    if let Some(parent) = pid_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&pid_path, chrome_pid.to_string()) {
        tracing::warn!(error = %e, path = %pid_path.display(), "write chrome.pid failed");
    }

    // === Hide the window in background mode ===
    //
    // `--window-position=-2400,-2400` *should* keep the window
    // off-screen, but macOS' WindowServer is allowed to override that
    // and yank the window back onto the main monitor (a usability
    // safeguard against apps "losing" their window). On real machines
    // we observed the Chrome window briefly flash on screen at boot.
    //
    // The cross-platform fix below uses each OS's native "hide
    // application" primitive scoped to the SPECIFIC Chrome PID we
    // just spawned — never the user's daily-driver Chrome:
    //
    //   - macOS: AppleScript via `osascript`, targeting `unix id`
    //   - Linux: nothing extra (positioning + GPU works reliably)
    //   - Windows: `powershell` ShowWindow(SW_HIDE = 0)
    //
    // Failure of the hide step is non-fatal: the customer just sees
    // a stray Chrome window, which is annoying but doesn't break
    // CDP / scraping. We log a warn and move on.
    if background {
        hide_chrome_window(chrome_pid);
    }

    Ok(())
}

/// Best-effort post-spawn "hide this PID's window" for background
/// mode. Implementation per OS:
#[cfg(target_os = "macos")]
fn hide_chrome_window(pid: u32) {
    // Give Chrome a beat to actually create its window — AppleScript
    // querying `unix id` of a process that hasn't registered with
    // System Events yet just no-ops silently.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        let script = format!(
            "tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to false"
        );
        let res = Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .output();
        match res {
            Ok(o) if o.status.success() => {
                tracing::info!(pid, "background Chrome window hidden via AppleScript");
            }
            Ok(o) => {
                tracing::warn!(
                    pid,
                    stderr = %String::from_utf8_lossy(&o.stderr),
                    "osascript hide failed (non-fatal)"
                );
            }
            Err(e) => {
                tracing::warn!(pid, error = %e, "osascript exec failed (non-fatal)");
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn hide_chrome_window(pid: u32) {
    // PowerShell ShowWindow(handle, SW_HIDE = 0) for the main window
    // of this PID. Same fire-and-forget pattern as macOS.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        let script = format!(
            "Add-Type -Name W -Namespace S -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);'; \
             $p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; \
             if ($p -and $p.MainWindowHandle -ne 0) {{ [S.W]::ShowWindow($p.MainWindowHandle, 0) | Out-Null }}"
        );
        let res = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output();
        match res {
            Ok(o) if o.status.success() => {
                tracing::info!(pid, "background Chrome window hidden via PowerShell");
            }
            Ok(o) => {
                tracing::warn!(
                    pid,
                    stderr = %String::from_utf8_lossy(&o.stderr),
                    "powershell hide failed (non-fatal)"
                );
            }
            Err(e) => {
                tracing::warn!(pid, error = %e, "powershell exec failed (non-fatal)");
            }
        }
    });
}

#[cfg(all(unix, not(target_os = "macos")))]
fn hide_chrome_window(_pid: u32) {
    // Linux: --window-position is honored reliably across all the
    // common WMs (mutter, kwin, X11). No-op.
}

fn pid_file() -> PathBuf {
    // Co-located with the alias store under .corey/ so wiping
    // ~/.hermes/.corey wipes both.
    crate::paths::hermes_data_dir()
        .map(|d| d.join(".corey").join("chrome.pid"))
        .unwrap_or_else(|_| PathBuf::from(".corey/chrome.pid"))
}

/// Best-effort kill of the Chrome we previously spawned. Reads the
/// PID file written by `spawn_chrome` and sends SIGTERM (Unix) /
/// terminates the process (Windows). Used when the Settings panel
/// wants to switch a backgrounded headless Chrome into a visible
/// headed one (Chrome won't share a profile with itself).
///
/// Returns `Ok(true)` if we actually killed something, `Ok(false)`
/// if there was no PID to act on. Failures are logged + swallowed
/// because a stale pid file or a Chrome that already crashed isn't
/// worth bubbling up to the user — the caller falls through to
/// `port_is_listening` to decide what to do next.
fn kill_previous_chrome() -> Result<bool, String> {
    let path = pid_file();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(false);
    };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(&path);
        return Ok(false);
    };
    #[cfg(unix)]
    {
        // Shell out to `kill` rather than pulling in `libc` just for
        // one syscall. SIGTERM (15) is polite — Chrome flushes
        // cookies + session state. SIGKILL would risk a half-flushed
        // sqlite that refuses to open next time.
        let _ = std::process::Command::new("kill")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        // taskkill /PID <pid> /F is the cleanest cross-arch way to
        // terminate without pulling in winapi. The /F forces the
        // close once Chrome doesn't ACK in ~5s; we accept the same
        // sqlite risk as Unix here in practice because Chrome on
        // Windows is generally cooperative.
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = std::fs::remove_file(&path);
    // Give Chrome a beat to release the profile lock. Without this,
    // the immediate respawn fails with "profile in use".
    std::thread::sleep(Duration::from_millis(500));
    // Belt-and-braces: wait up to 2 s for the port to actually free.
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if !port_is_listening(CDP_PORT) {
            break;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(true)
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

    #[test]
    fn downloads_dir_resolves_under_hermes_home() {
        // Drive `COREY_HERMES_DIR` to a tempdir and verify
        // `downloads_dir` points at `<that>/downloads`. Doesn't
        // require Chrome — purely path math. Note: the function
        // intentionally does NOT create the directory (lazy
        // creation by callers that actually need it).
        let _lock = crate::skills::HOME_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-dl-dir-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&tmp).expect("tmp");
        let orig = std::env::var_os("COREY_HERMES_DIR");
        std::env::set_var("COREY_HERMES_DIR", &tmp);

        let resolved = downloads_dir().expect("resolve downloads_dir");
        assert_eq!(resolved, tmp.join("downloads"));
        assert!(
            !resolved.exists(),
            "downloads_dir is lazy — should NOT pre-create"
        );

        if let Some(v) = orig {
            std::env::set_var("COREY_HERMES_DIR", v);
        } else {
            std::env::remove_var("COREY_HERMES_DIR");
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn apply_cdp_download_behavior_errs_quickly_without_chrome() {
        // When nothing is listening on CDP_PORT, the function should
        // give up within its `/json/version` retry deadline (~3 s) and
        // return Err — never block launch indefinitely. This guards
        // against a regression where someone removes the deadline
        // and the IPC turns into a 30-s hang.
        //
        // Skip if SOMETHING is already on 9222 (the developer's own
        // dev session, or a real AI Browser running locally); the
        // test would race against real CDP and be flaky.
        if port_is_listening(CDP_PORT) {
            eprintln!("skipping: port {CDP_PORT} is in use locally");
            return;
        }
        let start = Instant::now();
        let res = apply_cdp_download_behavior();
        let elapsed = start.elapsed();
        assert!(
            res.is_err(),
            "expected Err when nothing listens on CDP_PORT"
        );
        assert!(
            elapsed < Duration::from_secs(6),
            "apply_cdp_download_behavior took {elapsed:?} — should bail in ≤6 s"
        );
    }

    /// Live-Chrome smoke: explicitly call `apply_cdp_download_behavior`
    /// against whatever Chrome is currently listening on `CDP_PORT`.
    /// `#[ignore]`d by default so CI without Chrome stays green; run
    /// locally via
    /// `cargo test apply_cdp_live -- --ignored --nocapture` after
    /// `corey_browser_launch` has put a Chrome on 9222.
    #[test]
    #[ignore]
    fn apply_cdp_live_smoke() {
        assert!(
            port_is_listening(CDP_PORT),
            "live smoke needs a Chrome listening on :{CDP_PORT}"
        );
        apply_cdp_download_behavior()
            .expect("live Chrome should accept Browser.setDownloadBehavior");
    }

    #[test]
    fn seed_chrome_download_prefs_is_idempotent_and_skips_existing() {
        let tmp = std::env::temp_dir().join(format!(
            "caduceus-prefs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(tmp.join("Default")).expect("Default/");

        // First call with no existing Preferences → file is created.
        seed_chrome_download_prefs(&tmp);
        let prefs_path = tmp.join("Default").join("Preferences");
        assert!(prefs_path.exists(), "first call should seed Preferences");
        let original = std::fs::read_to_string(&prefs_path).expect("read prefs");
        let v: serde_json::Value = serde_json::from_str(&original).expect("valid JSON");
        assert_eq!(
            v["download"]["prompt_for_download"].as_bool(),
            Some(false),
            "headless requires prompt_for_download:false"
        );
        assert!(
            v["download"]["default_directory"]
                .as_str()
                .unwrap_or("")
                .ends_with("downloads"),
            "default_directory must point at hermes downloads dir"
        );

        // Second call with `Preferences` already present → must NOT
        // overwrite. Conservative behaviour: user's customizations
        // (post-first-launch from Chrome's UI) survive.
        std::fs::write(&prefs_path, "sentinel-do-not-touch").expect("overwrite");
        seed_chrome_download_prefs(&tmp);
        let kept = std::fs::read_to_string(&prefs_path).expect("re-read");
        assert_eq!(kept, "sentinel-do-not-touch", "existing prefs must survive");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
