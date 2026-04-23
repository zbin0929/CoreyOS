//! Phase 0 "hello disk" demo — proves the IPC pipe + sandbox + Rust fs
//! round-trip works end-to-end.
//!
//! Flow: frontend `invoke()` → Tauri IPC → `sandbox::fs::read_dir_count` →
//! `PathAuthority::check` (denylist + roots) → `tokio::fs` → back.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::sandbox::fs as sbx_fs;
use crate::sandbox::SandboxMode;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct HomeStats {
    pub path: String,
    pub entry_count: usize,
    pub sandbox_mode: &'static str,
}

#[tauri::command]
pub async fn home_stats(state: State<'_, AppState>) -> IpcResult<HomeStats> {
    // Use the real authority mode instead of inferring from `roots.is_empty()`.
    // Post-sandbox-GA, DevAllow can coexist with a seeded ~/.hermes root, so
    // the old heuristic was wrong in steady state.
    let sandbox_mode = match state.authority.mode() {
        SandboxMode::DevAllow => "dev-allow",
        SandboxMode::Enforced => "enforced",
    };

    // Pick a guaranteed-allowed path to probe. Historically this hit
    // `$HOME`, which worked in DevAllow but started tripping
    // `SandboxConsentRequired` in Enforced mode once the user added
    // a narrower root (the common case: only `~/.hermes/`). Instead,
    // probe the first workspace root; fall back to `$HOME` only when
    // no roots exist (true first launch, still in DevAllow).
    let roots = state.authority.roots();
    let probe_path = if let Some(first) = roots.first() {
        first.path.clone()
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| IpcError::Internal {
                message: "HOME not set".into(),
            })?;
        PathBuf::from(home)
    };

    let entry_count = sbx_fs::read_dir_count(&state.authority, &probe_path)
        .await
        .map_err(IpcError::from)?;

    Ok(HomeStats {
        path: probe_path.display().to_string(),
        entry_count,
        sandbox_mode,
    })
}
