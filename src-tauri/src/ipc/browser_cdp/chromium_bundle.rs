//! macOS-only AI Browser bundle preparation: locates a Chrome-for-Testing
//! / Chromium binary on the system (system-installed or in the Playwright
//! cache), copies it into `~/.hermes/.corey/ai-browser.app` via `ditto`,
//! and patches `Info.plist` to add `LSBackgroundOnly=true` so Chrome
//! doesn't grab the dock / take focus when the agent drives it.
//!
//! Extracted from `browser_cdp.rs` 2026-05-17 — this is the chunk
//! `progress.txt` flags as needing extension (LSUIElement + ad-hoc
//! re-sign + Chrome-for-Testing portable download). Keeping it in its
//! own file lets that work grow without bloating the parent.
//!
//! Public surface: a single `prepare_ai_browser_macos()` function with
//! cfg-gated fallbacks. The macOS implementation walks the lookup
//! chain (system install → Playwright cache → none); every other OS
//! returns `None`.

use std::path::PathBuf;

#[cfg(target_os = "macos")]
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
pub(super) fn prepare_ai_browser_macos() -> Option<PathBuf> {
    let source = locate_chrome_for_testing_macos()?;
    let source_app = source_bundle_root(&source)?;

    let managed_app = managed_ai_browser_path()?;
    let managed_exec = managed_app.join("Contents/MacOS/Google Chrome for Testing");

    let needs_patch = match (
        std::fs::metadata(&managed_exec).and_then(|m| m.modified()),
        std::fs::metadata(source_app.join("Contents/MacOS/Google Chrome for Testing"))
            .and_then(|m| m.modified()),
    ) {
        (Ok(target_t), Ok(src_t)) => target_t < src_t,
        (Err(_), Ok(_)) => true,
        _ => true,
    };

    if needs_patch {
        if let Err(e) = patch_chromium_bundle(&source_app, &managed_app) {
            tracing::warn!(
                source = %source_app.display(),
                target = %managed_app.display(),
                error = %e,
                "AI Browser patch failed — falling back to system Chrome"
            );
            return None;
        }
        tracing::info!(
            target = %managed_app.display(),
            "AI Browser: patched LSBackgroundOnly Chromium ready"
        );
    }

    if managed_exec.exists() {
        Some(managed_exec)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn locate_chrome_for_testing_macos() -> Option<PathBuf> {
    // 1) Direct user install
    for app in &[
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ] {
        let p = Path::new(app);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    // 2) Playwright / Patchright cache (~/Library/Caches/ms-playwright/chromium-NNNN/...)
    let home = std::env::var_os("HOME")?;
    let cache_root = PathBuf::from(home).join("Library/Caches/ms-playwright");
    if !cache_root.is_dir() {
        return None;
    }
    let mut newest: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(&cache_root).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("chromium-") {
            continue;
        }
        // Build version suffix as integer for newest-first selection;
        // unparseable suffix falls back to 0 so it ranks last.
        let ver: u64 = name.trim_start_matches("chromium-").parse().unwrap_or(0);
        for sub in &["chrome-mac-arm64", "chrome-mac-x64"] {
            let candidate = entry
                .path()
                .join(sub)
                .join("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
            if candidate.exists() && newest.as_ref().map(|(v, _)| ver > *v).unwrap_or(true) {
                newest = Some((ver, candidate.clone()));
            }
        }
    }
    newest.map(|(_, p)| p)
}

/// Given the path to a Chromium executable inside `Contents/MacOS/...`,
/// return the path to the enclosing `.app` bundle root.
#[cfg(target_os = "macos")]
pub(super) fn source_bundle_root(exec: &Path) -> Option<PathBuf> {
    exec.ancestors().nth(3).map(PathBuf::from)
}

#[cfg(target_os = "macos")]
pub(super) fn managed_ai_browser_path() -> Option<PathBuf> {
    crate::paths::hermes_data_dir()
        .ok()
        .map(|d| d.join(".corey").join("ai-browser.app"))
}

#[cfg(target_os = "macos")]
pub(super) fn patch_chromium_bundle(source_app: &Path, target_app: &Path) -> Result<(), String> {
    if let Some(parent) = target_app.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir target parent: {e}"))?;
    }
    // Remove stale target first; `ditto` to an existing dir creates
    // weird overlays.
    if target_app.exists() {
        std::fs::remove_dir_all(target_app).map_err(|e| format!("remove stale target: {e}"))?;
    }
    // `ditto` (not `cp -R`) — cp corrupts the bundle's code-signature
    // metadata, which breaks ICU loading at runtime. Spike confirmed
    // ditto is the only safe copy on macOS.
    let out = Command::new("/usr/bin/ditto")
        .arg(source_app)
        .arg(target_app)
        .output()
        .map_err(|e| format!("ditto exec: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ditto failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    // Add LSBackgroundOnly via PlistBuddy. Spike found that LSUIElement
    // breaks Chromium ICU loading; LSBackgroundOnly works.
    let info_plist = target_app.join("Contents/Info.plist");
    // PlistBuddy `Add` fails if the key already exists — try Set first.
    let set_res = Command::new("/usr/libexec/PlistBuddy")
        .args([
            "-c",
            "Set :LSBackgroundOnly true",
            &info_plist.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("PlistBuddy set exec: {e}"))?;
    if !set_res.status.success() {
        let add_res = Command::new("/usr/libexec/PlistBuddy")
            .args([
                "-c",
                "Add :LSBackgroundOnly bool true",
                &info_plist.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("PlistBuddy add exec: {e}"))?;
        if !add_res.status.success() {
            return Err(format!(
                "PlistBuddy add LSBackgroundOnly failed: {}",
                String::from_utf8_lossy(&add_res.stderr)
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn prepare_ai_browser_macos() -> Option<PathBuf> {
    None
}
