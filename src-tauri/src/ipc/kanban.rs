//! Kanban IPC — multi-agent task board.
//!
//! Wraps `hermes kanban` CLI commands to provide a UI for managing
//! multi-agent collaboration tasks.
//!
//! Cross-platform: uses `resolve_hermes_binary()` which handles
//! macOS/Windows/Linux differences. No shell invocation — all args
//! passed via `Command::args()` to avoid injection.

use std::collections::HashMap;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::hermes_config::gateway::resolve_hermes_binary;

/// A Kanban task from `hermes kanban list --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanTask {
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    pub assignee: Option<String>,
    pub status: String,
    pub priority: i32,
    pub workspace_path: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub result: Option<String>,
}

/// List all Kanban tasks.
#[tauri::command]
pub async fn kanban_list() -> Result<Vec<KanbanTask>, String> {
    let binary = resolve_hermes_binary().map_err(|e| format!("hermes not found: {e}"))?;

    let output = Command::new(&binary)
        .args(["kanban", "list", "--json"])
        .output()
        .map_err(|e| format!("failed to run hermes kanban list: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban list failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let tasks: Vec<KanbanTask> =
        serde_json::from_str(&stdout).map_err(|e| format!("failed to parse kanban list: {e}"))?;

    Ok(tasks)
}

/// Create a new Kanban task.
#[tauri::command]
pub async fn kanban_create(
    title: String,
    assignee: Option<String>,
    body: Option<String>,
) -> Result<String, String> {
    // Validate title
    if title.trim().is_empty() {
        return Err("任务标题不能为空".to_string());
    }

    let binary = resolve_hermes_binary().map_err(|e| format!("hermes not found: {e}"))?;

    let mut args = vec!["kanban", "create", &title];

    let assignee_str;
    if let Some(ref a) = assignee {
        assignee_str = a.clone();
        args.push("--assign");
        args.push(&assignee_str);
    }

    let output = Command::new(&binary)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run hermes kanban create: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban create failed: {stderr}"));
    }

    // If body is provided, add it as a comment
    if let Some(b) = body {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Extract task ID from "Created t_XXXXXXXX"
        if let Some(id) = stdout.split_whitespace().nth(1) {
            let _ = Command::new(&binary)
                .args(["kanban", "comment", id, &b])
                .output();
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

/// Complete a Kanban task.
#[tauri::command]
pub async fn kanban_complete(task_id: String, result: Option<String>) -> Result<(), String> {
    let binary = resolve_hermes_binary().map_err(|e| format!("hermes not found: {e}"))?;

    let mut args = vec!["kanban", "complete", &task_id];

    let result_str;
    if let Some(ref r) = result {
        result_str = r.clone();
        args.push("--result");
        args.push(&result_str);
    }

    let output = Command::new(&binary)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run hermes kanban complete: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban complete failed: {stderr}"));
    }

    Ok(())
}

/// Get task details.
#[tauri::command]
pub async fn kanban_show(task_id: String) -> Result<KanbanTask, String> {
    let binary = resolve_hermes_binary().map_err(|e| format!("hermes not found: {e}"))?;

    let output = Command::new(&binary)
        .args(["kanban", "show", &task_id, "--json"])
        .output()
        .map_err(|e| format!("failed to run hermes kanban show: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban show failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let task: KanbanTask =
        serde_json::from_str(&stdout).map_err(|e| format!("failed to parse kanban show: {e}"))?;

    Ok(task)
}

/// Profile info for assignee selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileOption {
    pub id: String,
    pub name: String,
}

/// Extended profile metadata from Pack manifests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileMeta {
    pub id: String,
    pub display_name: String,
    pub pack_id: Option<String>,
    pub pack_name: Option<String>,
}

/// Get profile metadata from all Pack manifests.
/// Returns a map of profile ID -> metadata for UI display.
#[tauri::command]
pub async fn pack_profile_meta() -> Result<Vec<ProfileMeta>, String> {
    use crate::pack::Registry;
    use crate::paths::hermes_data_dir;

    let mut profiles = Vec::new();

    if let Ok(hermes_dir) = hermes_data_dir() {
        let registry = Registry::scan(&hermes_dir);
        for entry in registry.packs {
            if let Some(manifest) = entry.manifest {
                let pack_id = manifest.id.clone();
                let pack_name = manifest.name.clone();
                for profile in manifest.profiles.iter() {
                    profiles.push(ProfileMeta {
                        id: profile.id.clone(),
                        display_name: if profile.name.is_empty() {
                            profile.id.clone()
                        } else {
                            profile.name.clone()
                        },
                        pack_id: Some(pack_id.clone()),
                        pack_name: Some(pack_name.clone()),
                    });
                }
            }
        }
    }

    Ok(profiles)
}

/// List available profiles (assignees).
/// Returns profile ID and display name from Pack manifests.
#[tauri::command]
pub async fn kanban_assignees() -> Result<Vec<ProfileOption>, String> {
    use crate::hermes_profiles;
    use crate::pack::Registry;
    use crate::paths::hermes_data_dir;

    let view = hermes_profiles::list_profiles().map_err(|e| format!("failed to list profiles: {e}"))?;

    // Build a map of profile ID -> display name from Pack manifests
    let mut name_map: HashMap<String, String> = HashMap::new();
    if let Ok(hermes_dir) = hermes_data_dir() {
        let registry = Registry::scan(&hermes_dir);
        for entry in registry.packs {
            if let Some(manifest) = entry.manifest {
                for profile in manifest.profiles.iter() {
                    let display_name = if profile.name.is_empty() {
                        profile.id.clone()
                    } else {
                        profile.name.clone()
                    };
                    name_map.insert(profile.id.clone(), display_name);
                }
            }
        }
    }

    let mut profiles: Vec<ProfileOption> = view
        .profiles
        .into_iter()
        .map(|p| {
            let display_name = name_map.get(&p.name).cloned().unwrap_or_else(|| p.name.clone());
            ProfileOption {
                id: p.name,
                name: display_name,
            }
        })
        .collect();

    profiles.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(profiles)
}

/// Kanban stats (frontend-facing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanStats {
    pub triage: i32,
    pub todo: i32,
    pub ready: i32,
    pub running: i32,
    pub blocked: i32,
    pub done: i32,
}

/// Raw JSON from `hermes kanban stats --json`.
#[derive(Debug, Deserialize)]
struct KanbanStatsRaw {
    by_status: HashMap<String, i32>,
}

#[tauri::command]
pub async fn kanban_stats() -> Result<KanbanStats, String> {
    let binary = resolve_hermes_binary().map_err(|e| format!("hermes not found: {e}"))?;

    let output = Command::new(&binary)
        .args(["kanban", "stats", "--json"])
        .output()
        .map_err(|e| format!("failed to run hermes kanban stats: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban stats failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: KanbanStatsRaw =
        serde_json::from_str(&stdout).map_err(|e| format!("failed to parse kanban stats: {e}"))?;

    let stats = KanbanStats {
        triage: *raw.by_status.get("triage").unwrap_or(&0),
        todo: *raw.by_status.get("todo").unwrap_or(&0),
        ready: *raw.by_status.get("ready").unwrap_or(&0),
        running: *raw.by_status.get("running").unwrap_or(&0),
        blocked: *raw.by_status.get("blocked").unwrap_or(&0),
        done: *raw.by_status.get("done").unwrap_or(&0),
    };

    Ok(stats)
}
