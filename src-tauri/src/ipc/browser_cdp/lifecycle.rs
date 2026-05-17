//! AI Browser process lifecycle: spawn, kill, PID tracking, window
//! hiding, and the OS-level fallback minimize chain.
//!
//! Owns four concerns that all revolve around "the customer's
//! background Chrome we manage":
//!
//!   - **Spawn**: [`spawn_chrome`] launches the Chromium binary with
//!     the right flags (`--remote-debugging-port=9222`, dedicated
//!     `--user-data-dir`, off-screen `--window-position` on Linux,
//!     LSBackgroundOnly bundle when available on macOS) and writes
//!     the child PID to [`pid_file`] so subsequent boots can find it.
//!   - **Kill**: [`kill_previous_chrome`] reads [`pid_file`] and
//!     SIGTERM-then-SIGKILL the recorded PID. Used by stop_sync and
//!     by relaunch flows that need a clean slate.
//!   - **Patched-bundle detection**: [`is_patched_ai_browser`] (path
//!     match) and [`running_pid_is_patched_bundle`] (ps lookup) tell
//!     `build_status` whether the running Chrome is our patched
//!     `LSBackgroundOnly` Chromium for Testing — used by the Settings
//!     panel to surface "AI Browser is running silently" vs "system
//!     Chrome is visible".
//!   - **Window hiding fallback**: [`os_minimize_chrome_window`] (used
//!     by `cdp_protocol::apply_cdp_post_launch` as fallback when CDP
//!     `Browser.setWindowBounds` hits its macOS bug) plus the
//!     internal `hide_chrome_window` invoked from `spawn_chrome` for
//!     non-patched Chrome on macOS / Windows.
//!
//! Extracted from `browser_cdp.rs` 2026-05-17. All cross-platform
//! `#[cfg]` branches stay here — moving them out of the parent
//! shrinks `browser_cdp.rs` below the AC-1 monitor threshold.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::error::{IpcError, IpcResult};

use super::{port_is_listening, seed_chrome_download_prefs, CDP_PORT};

#[cfg(target_os = "macos")]
use super::chromium_bundle::managed_ai_browser_path;

/// Synchronous OS-level fallback for hiding the background Chrome
/// window when CDP `Browser.setWindowBounds` is unavailable (it has a
/// well-known macOS bug for headed Chromes — see Chromium issue
/// 1140655). We read our own Chrome PID from the file
/// `spawn_chrome` writes and ask the OS window manager to hide
/// **that specific PID** — never the customer's daily-driver Chrome.
///
/// Each platform uses its native primitive:
///   - **macOS**: AppleScript `set visible of (process whose unix id …) to false`
///     (Cmd+H equivalent; no Accessibility permission needed, just
///     a one-time Automation prompt for "System Events").
///   - **Windows**: PowerShell `ShowWindow(MainWindowHandle, SW_HIDE)`.
///   - **Linux**: no-op — `--window-position` is honored reliably
///     across mutter/kwin/X11, so we don't need a fallback here.
///
/// Best-effort: failure is logged warn by the caller and never
/// propagates; the customer just sees a stray Chrome window which is
/// annoying but doesn't break CDP / scraping.
pub(super) fn os_minimize_chrome_window() -> Result<(), String> {
    let pid = read_chrome_pid()?;
    os_minimize_chrome_window_for_pid(pid)
}

#[cfg(target_os = "macos")]
fn os_minimize_chrome_window_for_pid(pid: u32) -> Result<(), String> {
    let script = format!(
        "tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to false"
    );
    let out = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript exec: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "osascript: status={:?} stderr={}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn os_minimize_chrome_window_for_pid(pid: u32) -> Result<(), String> {
    let script = format!(
        "Add-Type -Name W -Namespace S -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);'; \
         $p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; \
         if ($p -and $p.MainWindowHandle -ne 0) {{ [S.W]::ShowWindow($p.MainWindowHandle, 0) | Out-Null }} else {{ Write-Error 'no main window handle' }}"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("powershell exec: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "powershell: status={:?} stderr={}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn os_minimize_chrome_window_for_pid(_pid: u32) -> Result<(), String> {
    Ok(())
}

fn read_chrome_pid() -> Result<u32, String> {
    let path = pid_file();
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("read pid file {}: {e}", path.display()))?;
    raw.trim()
        .parse::<u32>()
        .map_err(|e| format!("parse pid {:?}: {e}", raw.trim()))
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
pub(super) fn spawn_chrome(chrome: &Path, profile: &Path, background: bool) -> IpcResult<()> {
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
    if background && !is_patched_ai_browser(chrome) {
        // Skip the osascript / SW_HIDE dance when we spawned our
        // patched LSBackgroundOnly bundle — the OS already prevents
        // it from registering with System Events (so osascript would
        // emit a harmless but confusing "process whose unix id = N
        // — Invalid index" warn).
        hide_chrome_window(chrome_pid);
    }

    Ok(())
}

/// Companion to `is_patched_ai_browser`: check whether the currently-
/// running Chrome (per `pid_file()`) is the patched LSBackgroundOnly
/// bundle. We resolve the PID's full command line via
/// `ps -p PID -o command=` and substring-match against our managed
/// bundle path. On non-macOS this is always `false` — the
/// LSBackgroundOnly trick is macOS-only.
pub(super) fn running_pid_is_patched_bundle() -> bool {
    #[cfg(target_os = "macos")]
    {
        let Ok(pid) = read_chrome_pid() else {
            return false;
        };
        let Some(managed) = managed_ai_browser_path() else {
            return false;
        };
        // `ps -p PID -o command=` returns the full argv[0], which for a
        // patched-bundle Chrome looks like
        // `/Users/.../ai-browser.app/Contents/MacOS/Google Chrome for Testing ...`.
        let Ok(out) = Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
        else {
            return false;
        };
        if !out.status.success() {
            return false;
        }
        let cmd = String::from_utf8_lossy(&out.stdout);
        cmd.contains(&*managed.to_string_lossy())
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Heuristic: is `chrome` the executable inside our managed
/// `~/.hermes/.corey/ai-browser.app` bundle? Used to skip the post-spawn
/// `hide_chrome_window` call that's redundant (and noisy) for an
/// already-invisible LSBackgroundOnly process.
pub(super) fn is_patched_ai_browser(chrome: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Some(managed) = managed_ai_browser_path() {
            let inner = managed.join("Contents/MacOS/Google Chrome for Testing");
            return chrome == inner;
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = chrome;
        false
    }
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

pub(super) fn pid_file() -> PathBuf {
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
pub(super) fn kill_previous_chrome() -> Result<bool, String> {
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
