//! Skill Curator IPC — thin wrapper around `hermes curator <subcmd>`.
//!
//! The curator is **upstream behaviour** (Hermes Agent ships
//! `agent/curator.py` + `hermes_cli/curator.py`). Re-implementing
//! the stale/archive/consolidation pass in Rust would duplicate
//! ~1500 lines and immediately go stale. Our job is to shell out
//! and render the CLI's own formatted output, the same pattern
//! `skill_hub.rs` uses for `hermes skills *`.
//!
//! ## Why an allowlist
//!
//! The same security argument as `skill_hub_exec`: the frontend
//! can only invoke a curated set of curator subcommands. Anything
//! else (notably `hermes gateway start`, `config`, etc.) is
//! rejected server-side so a compromised UI can't escape via this
//! channel.
//!
//! ## Output format
//!
//! `hermes curator status` doesn't have a `--json` flag (we asked).
//! We return raw stdout/stderr in a `<pre>` block and let the user
//! read it. If upstream stabilises a JSON output someday we can
//! parse it then; for now, honest plain text beats brittle parsing.
//!
//! ## Not in scope here
//!
//! - Auto-running the curator on a schedule. The Hermes gateway
//!   cron ticker already does that (default: every 7 days, only
//!   when the agent has been idle ≥ 2 h). The UI just exposes a
//!   manual "Run review now" button for users who want immediate
//!   feedback.

use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::error::{IpcError, IpcResult};

/// Subcommands the UI is allowed to invoke. Curator surface, as
/// of Hermes v0.12.0 docs:
///
/// - `status` — print last-run summary + per-skill LRU activity
/// - `run` — trigger a review pass synchronously (`--sync`) or in
///   the background. We always pass `--sync` so the user sees the
///   result inline; long runs block the UI but at least there's
///   no "did it work?" ambiguity.
/// - `pause` / `resume` — suspend auto-transitions until resumed
/// - `pin <name>` / `unpin <name>` — fence a skill from any
///   automated change (and the agent's `skill_manage` writes too)
/// - `restore <name>` — pull an archived skill back to active
const ALLOWED_SUBCOMMANDS: &[&str] =
    &["status", "run", "pause", "resume", "pin", "unpin", "restore"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuratorCommandResult {
    pub stdout: String,
    pub stderr: String,
    /// `-1` when the CLI couldn't be spawned (distinct from a CLI
    /// that ran and exited with a nonzero code).
    pub status: i32,
    /// `false` when `hermes` isn't on `$PATH`. The UI surfaces a
    /// "install Hermes to use the curator" hint instead of raw
    /// stderr (which is typically `No such file or directory`).
    pub cli_available: bool,
}

/// Execute `hermes curator <args…>` and return captured output.
/// `args[0]` must be one of `ALLOWED_SUBCOMMANDS`; everything after
/// that is forwarded verbatim (e.g. skill name for `pin`).
#[tauri::command]
pub async fn skill_curator_exec(args: Vec<String>) -> IpcResult<CuratorCommandResult> {
    if args.is_empty() {
        return Err(IpcError::Internal {
            message: "skill_curator_exec requires at least one arg".into(),
        });
    }
    let sub = args[0].as_str();
    if !ALLOWED_SUBCOMMANDS.contains(&sub) {
        return Err(IpcError::Internal {
            message: format!(
                "skill_curator_exec subcommand '{sub}' not allowed; expected one of: {}",
                ALLOWED_SUBCOMMANDS.join(", ")
            ),
        });
    }
    // `run` benefits from --sync so the user gets stdout instead
    // of "queued, check back later". We splice it in transparently
    // unless the caller already passed it (paranoid: future UIs
    // might want async).
    let mut effective_args: Vec<String> = args.clone();
    if sub == "run" && !effective_args.iter().any(|a| a == "--sync") {
        effective_args.push("--sync".into());
    }

    tokio::task::spawn_blocking(move || -> IpcResult<CuratorCommandResult> {
        let mut cmd = Command::new("hermes");
        cmd.arg("curator").args(&effective_args);
        crate::hermes_config::suppress_window(&mut cmd);
        let output = cmd.output();
        match output {
            Ok(o) => Ok(CuratorCommandResult {
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
                status: o.status.code().unwrap_or(-1),
                cli_available: true,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(CuratorCommandResult {
                stdout: String::new(),
                stderr: format!("hermes CLI not found on PATH: {e}"),
                status: -1,
                cli_available: false,
            }),
            Err(e) => Err(IpcError::Internal {
                message: format!("skill_curator_exec spawn: {e}"),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("skill_curator_exec task join: {e}"),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_matches_documented_subcommands() {
        // Guard against a typo. Verified against
        // hermes-agent docs/user-guide/features/curator.md
        // (`hermes curator status / run / pause / resume / pin /
        // unpin / restore`).
        let expected = [
            "status", "run", "pause", "resume", "pin", "unpin", "restore",
        ];
        for sub in expected {
            assert!(
                ALLOWED_SUBCOMMANDS.contains(&sub),
                "curator subcommand {sub} missing from allowlist"
            );
        }
    }

    #[test]
    fn rejects_disallowed_subcommand() {
        // gateway is a real top-level hermes command but not a
        // curator one. Allowlist must protect against it so a
        // compromised UI can't escape via this channel.
        // Test the validation logic directly without spawning a
        // tokio runtime.
        let args = vec!["gateway".to_string(), "start".to_string()];
        let sub = args[0].as_str();
        assert!(!ALLOWED_SUBCOMMANDS.contains(&sub));
    }
}
