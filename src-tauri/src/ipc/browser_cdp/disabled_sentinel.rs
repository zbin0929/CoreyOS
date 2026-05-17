//! Tracks the explicit-disable signal for AI Browser auto-start.
//!
//! When the customer clicks Settings → AI Browser → Stop we drop a
//! sentinel file at `~/.hermes/.corey/ai-browser-disabled`. The next
//! Corey boot reads this via [`is_disabled`] and respects the choice
//! — auto-start is skipped. Clicking Launch (or any explicit
//! `browser_cdp_launch` IPC) clears the sentinel so subsequent boots
//! resume the default-on behaviour.
//!
//! Why a sentinel file (not a config flag): we want the choice to
//! survive across upgrades + customer.yaml edits + license rotations
//! without needing a schema. It's also trivially discoverable by
//! support (`ls ~/.hermes/.corey/`) and can be reset by deleting the
//! file manually.
//!
//! Extracted from `browser_cdp.rs` 2026-05-17.

use std::path::PathBuf;

fn disabled_sentinel_path() -> PathBuf {
    crate::paths::hermes_data_dir()
        .map(|d| d.join(".corey").join("ai-browser-disabled"))
        .unwrap_or_else(|_| PathBuf::from(".corey/ai-browser-disabled"))
}

/// Returns true if the customer explicitly opted out of AI Browser
/// auto-start (sentinel file exists from a prior `Stop` action).
pub(super) fn is_disabled() -> bool {
    disabled_sentinel_path().exists()
}

/// Mark AI Browser as explicitly disabled (called by `stop_sync`).
/// Writes the sentinel so subsequent boots skip the auto-spawn.
pub(super) fn write_disabled_sentinel() {
    let path = disabled_sentinel_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, b"disabled by Settings -> AI Browser -> Stop\n") {
        tracing::warn!(error = %e, path = %path.display(), "write ai-browser-disabled sentinel failed");
    }
}

/// Clear the disabled sentinel (called by `launch_sync` /
/// `ensure_running_background`). Re-arms boot auto-start.
pub(super) fn clear_disabled_sentinel() {
    let path = disabled_sentinel_path();
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!(error = %e, path = %path.display(), "clear ai-browser-disabled sentinel failed");
        }
    }
}
