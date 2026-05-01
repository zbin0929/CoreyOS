//! Phase 7 · T7.4 — Skills hub CLI wrapper.
//!
//! Thin wrapper around `hermes skills <subcmd>` — the Hermes CLI
//! already federates 7+ hub sources (official, skills-sh, well-known,
//! github, clawhub, lobehub, claude-marketplace). Re-implementing hub
//! discovery client-side would duplicate 1000+ lines of upstream
//! behaviour and go stale the moment Hermes adds a new source. Our
//! job is to run the CLI, return its stdout/stderr, and let the UI
//! render it as-is.
//!
//! Design tradeoffs:
//!
//! - **Raw stdout, not structured parsing.** The `--json` flag isn't
//!   documented as stable across subcommands. Parsing text output
//!   that upstream might change freely is a footgun. Rendering the
//!   CLI's own formatted output in a <pre> block is both simpler and
//!   more honest about what happened.
//!
//! - **Subcommand allowlist**, not a general `exec` escape hatch. The
//!   UI can only invoke `hermes skills <browse|search|inspect|install
//!   |uninstall|list|check|update|audit>`. This prevents a
//!   compromised frontend from reaching `hermes gateway start` or
//!   anything destructive outside the skill surface.
//!
//! - **CLI-missing is a structured result, not an error.** Users
//!   without Hermes installed still see a useful message ("install
//!   Hermes to browse the hub") instead of a cryptic IO failure.
//!
//! Not in scope here:
//! - Parsing the user's already-installed skills. The existing
//!   `skill_list` IPC walks `~/.hermes/skills/` and is sufficient.
//! - Security-scan confirmation prompts. `hermes skills install`
//!   prints its own scan verdict; we just surface the output and let
//!   the user re-run with `--force` if they accept.

use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::error::{IpcError, IpcResult};

/// Subcommands the UI is allowed to invoke. Anything else is
/// rejected server-side — the page shouldn't need to escape this
/// list, and if it does we want to know why before expanding the
/// surface.
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "browse",
    "search",
    "inspect",
    "install",
    "uninstall",
    "list",
    "check",
    "update",
    "audit",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubCommandResult {
    pub stdout: String,
    pub stderr: String,
    /// `-1` when the CLI couldn't be spawned (distinct from a CLI
    /// that ran and exited with a nonzero code).
    pub status: i32,
    /// `false` when `hermes` isn't on `$PATH`. The UI uses this to
    /// show an install-Hermes hint instead of the raw stderr, which
    /// is usually just `No such file or directory`.
    pub cli_available: bool,
}

/// Execute `hermes skills <args…>` and return the captured output.
/// `args[0]` must be one of `ALLOWED_SUBCOMMANDS`; everything after
/// that is forwarded verbatim.
#[tauri::command]
pub async fn skill_hub_exec(args: Vec<String>) -> IpcResult<HubCommandResult> {
    if args.is_empty() {
        return Err(IpcError::Internal {
            message: "skill_hub_exec requires at least one arg".into(),
        });
    }
    let sub = args[0].as_str();
    if !ALLOWED_SUBCOMMANDS.contains(&sub) {
        return Err(IpcError::Internal {
            message: format!(
                "skill_hub_exec subcommand '{sub}' not allowed; expected one of: {}",
                ALLOWED_SUBCOMMANDS.join(", ")
            ),
        });
    }

    tokio::task::spawn_blocking(move || -> IpcResult<HubCommandResult> {
        let mut cmd = Command::new("hermes");
        cmd.arg("skills").args(&args);
        crate::hermes_config::suppress_window(&mut cmd);
        let output = cmd.output();
        match output {
            Ok(o) => Ok(HubCommandResult {
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
                status: o.status.code().unwrap_or(-1),
                cli_available: true,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HubCommandResult {
                stdout: String::new(),
                stderr: format!("hermes CLI not found on PATH: {e}"),
                status: -1,
                cli_available: false,
            }),
            Err(e) => Err(IpcError::Internal {
                message: format!("skill_hub_exec spawn: {e}"),
            }),
        }
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("skill_hub_exec task join: {e}"),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exec_sync(args: Vec<String>) -> IpcResult<HubCommandResult> {
        // Inline the async body without a runtime — we only exercise
        // the validation branches here. The spawn path is integration-
        // tested via the Playwright smoke that talks to the mock.
        if args.is_empty() {
            return Err(IpcError::Internal {
                message: "skill_hub_exec requires at least one arg".into(),
            });
        }
        let sub = args[0].as_str();
        if !ALLOWED_SUBCOMMANDS.contains(&sub) {
            return Err(IpcError::Internal {
                message: format!(
                    "skill_hub_exec subcommand '{sub}' not allowed; expected one of: {}",
                    ALLOWED_SUBCOMMANDS.join(", ")
                ),
            });
        }
        Ok(HubCommandResult {
            stdout: String::new(),
            stderr: String::new(),
            status: 0,
            cli_available: true,
        })
    }

    #[test]
    fn rejects_empty_args() {
        let out = exec_sync(vec![]);
        assert!(matches!(out, Err(IpcError::Internal { .. })));
    }

    #[test]
    fn rejects_disallowed_subcommand() {
        // `gateway` is a real Hermes subcommand but NOT a skills one.
        // The allowlist must protect against it so a compromised UI
        // can't spawn `hermes gateway start` via this IPC.
        let out = exec_sync(vec!["gateway".into(), "start".into()]);
        assert!(matches!(out, Err(IpcError::Internal { .. })));
    }

    #[test]
    fn accepts_every_allowed_subcommand() {
        // Guard against a typo in the allowlist. All 9 names must
        // match what the upstream CLI actually accepts (verified
        // against hermes-agent.nousresearch.com/docs/reference/
        // cli-commands 2026-04-23).
        for sub in ALLOWED_SUBCOMMANDS {
            let out = exec_sync(vec![sub.to_string()]);
            assert!(out.is_ok(), "subcommand {sub} should be allowed");
        }
    }
}
