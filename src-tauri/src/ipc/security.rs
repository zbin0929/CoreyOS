//! Security-status IPC.
//!
//! Surfaces Corey's pre_tool_call guard health to the Settings UI so
//! customers (and us, during support calls) can tell at a glance
//! whether the L3 hard-defence layer is actually live.
//!
//! The 2026-05-11 incident root cause was that the guard was
//! *physically installed* but *not registered* in `config.yaml`, so
//! it never fired. We had no UI signal to catch that — this IPC
//! fixes the visibility gap.

use serde::{Deserialize, Serialize};

use crate::error::IpcError;

use crate::error::IpcResult;
use crate::hermes_hooks;
use crate::paths;

/// Snapshot returned by [`security_status_get`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    /// Path to the guard script Corey ships. `None` if we couldn't
    /// resolve the Hermes data dir (no home? dev env weirdness?).
    pub guard_script_path: Option<String>,
    /// Does the guard script exist at the expected path?
    pub guard_script_installed: bool,
    /// Does `config.yaml` list the guard path under
    /// `hooks.pre_tool_call`? Even when installed, an unregistered
    /// script is DORMANT — Hermes never invokes it.
    pub guard_hook_registered: bool,
    /// Is `hooks_auto_accept: true`? If false, Hermes will block on
    /// a TTY prompt the first time each hook fires, which deadlocks
    /// on background channels (cron, WhatsApp, Slack).
    pub hooks_auto_accept: bool,
    /// Tail scan of `~/.hermes/corey-guards/guard.log` — how many
    /// times the guard ran (FIRED) and how many of those led to a
    /// BLOCK decision. `(0, 0)` = guard log missing (never fired).
    pub recent_fires: u64,
    pub recent_blocks: u64,
    /// Human-readable severity summary. Frontend uses this to decide
    /// badge colour: `ok`, `warn`, `crit`.
    pub overall: SecurityStatusLevel,
    /// List of concrete complaints, each a short i18n-friendly
    /// marker string the UI maps to localised copy.
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecurityStatusLevel {
    /// Guard installed + registered + auto-accept on + recent activity.
    Ok,
    /// Installed + registered, but auto-accept off OR no recent
    /// activity in log. Works in an interactive session, breaks for
    /// cron / IM channels.
    Warn,
    /// Guard missing or unregistered. Destructive ops unprotected.
    Crit,
}

/// Get current status. Never fails — a missing Hermes dir just
/// returns all-false-and-crit so the UI flags it.
#[tauri::command]
pub async fn security_status_get() -> IpcResult<SecurityStatus> {
    let Ok(hermes_dir) = paths::hermes_data_dir() else {
        return Ok(SecurityStatus {
            guard_script_path: None,
            guard_script_installed: false,
            guard_hook_registered: false,
            hooks_auto_accept: false,
            recent_fires: 0,
            recent_blocks: 0,
            overall: SecurityStatusLevel::Crit,
            issues: vec!["hermes_dir_unresolved".into()],
        });
    };

    let guard_path = hermes_dir.join("corey-guards").join("file-ops-guard.py");
    let guard_installed = guard_path.exists();
    let hook_registered = hermes_hooks::is_hook_registered(&hermes_dir).unwrap_or(false);
    let auto_accept = hermes_hooks::is_auto_accept_enabled(&hermes_dir).unwrap_or(false);
    let (fires, blocks) = hermes_hooks::count_recent_guard_events(&hermes_dir, 2000);

    let mut issues = Vec::new();
    if !guard_installed {
        issues.push("guard_script_missing".into());
    }
    if !hook_registered {
        issues.push("guard_hook_unregistered".into());
    }
    if !auto_accept {
        issues.push("hooks_auto_accept_false".into());
    }
    if guard_installed && hook_registered && fires == 0 {
        issues.push("guard_never_fired".into());
    }

    let overall = if !guard_installed || !hook_registered {
        SecurityStatusLevel::Crit
    } else if !auto_accept || fires == 0 {
        SecurityStatusLevel::Warn
    } else {
        SecurityStatusLevel::Ok
    };

    Ok(SecurityStatus {
        guard_script_path: Some(guard_path.to_string_lossy().to_string()),
        guard_script_installed: guard_installed,
        guard_hook_registered: hook_registered,
        hooks_auto_accept: auto_accept,
        recent_fires: fires as u64,
        recent_blocks: blocks as u64,
        overall,
        issues,
    })
}

/// Manually re-run the boot-time reconcile. Exposed to the UI so
/// users can click a "Fix now" button after clearing a false-config
/// state (e.g. Hermes rewrote config.yaml and clobbered our hook).
#[tauri::command]
pub async fn security_reconcile() -> IpcResult<SecurityStatus> {
    if let Ok(hermes_dir) = paths::hermes_data_dir() {
        // Best-effort: log-and-continue. The UI reads final status
        // below regardless of success so the user sees the outcome.
        if let Err(e) = hermes_hooks::seed_guards_script(&hermes_dir) {
            tracing::warn!(error = %e, "security_reconcile: seed failed");
        }
        if let Err(e) = hermes_hooks::ensure_hook_registered(&hermes_dir) {
            tracing::warn!(error = %e, "security_reconcile: hook registration failed");
        }
    }
    security_status_get().await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardResolveArgs {
    pub id: String,
    pub allowed: bool,
}

#[tauri::command]
pub async fn guard_prompt_resolve(args: GuardResolveArgs) -> IpcResult<()> {
    crate::mcp_server::guard::resolve_guard_prompt(&args.id, args.allowed)
        .await
        .map_err(|e| IpcError::Internal { message: e })
}
