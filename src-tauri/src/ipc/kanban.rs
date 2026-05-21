//! Kanban IPC — multi-agent task board.
//!
//! Wraps `hermes kanban` CLI commands to provide a UI for managing
//! multi-agent collaboration tasks.

use serde::{Deserialize, Serialize};
use std::process::Command;

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
    let output = Command::new("hermes")
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
    let mut args = vec!["kanban", "create", &title];

    let assignee_str;
    if let Some(ref a) = assignee {
        assignee_str = a.clone();
        args.push("--assign");
        args.push(&assignee_str);
    }

    let output = Command::new("hermes")
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
            let _ = Command::new("hermes")
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
    let mut args = vec!["kanban", "complete", &task_id];

    let result_str;
    if let Some(ref r) = result {
        result_str = r.clone();
        args.push("--result");
        args.push(&result_str);
    }

    let output = Command::new("hermes")
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
    let output = Command::new("hermes")
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

/// List available profiles (assignees).
#[tauri::command]
pub async fn kanban_assignees() -> Result<Vec<String>, String> {
    let output = Command::new("hermes")
        .args(["profile", "list"])
        .output()
        .map_err(|e| format!("failed to run hermes profile list: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes profile list failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut profiles = Vec::new();

    for line in stdout.lines().skip(3) {
        // Skip header lines
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 1 {
            let name = parts[0].trim_start_matches('◆').trim();
            if !name.is_empty() && name != "Profile" {
                profiles.push(name.to_string());
            }
        }
    }

    Ok(profiles)
}

/// Kanban stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanStats {
    pub triage: i32,
    pub todo: i32,
    pub ready: i32,
    pub running: i32,
    pub blocked: i32,
    pub done: i32,
}

#[tauri::command]
pub async fn kanban_stats() -> Result<KanbanStats, String> {
    let output = Command::new("hermes")
        .args(["kanban", "stats"])
        .output()
        .map_err(|e| format!("failed to run hermes kanban stats: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("hermes kanban stats failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut stats = KanbanStats {
        triage: 0,
        todo: 0,
        ready: 0,
        running: 0,
        blocked: 0,
        done: 0,
    };

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let count: i32 = parts[1].parse().unwrap_or(0);
            match parts[0] {
                "triage" => stats.triage = count,
                "todo" => stats.todo = count,
                "ready" => stats.ready = count,
                "running" => stats.running = count,
                "blocked" => stats.blocked = count,
                "done" => stats.done = count,
                _ => {}
            }
        }
    }

    Ok(stats)
}
