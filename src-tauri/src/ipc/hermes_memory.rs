//! IPC for Hermes memory provider state + USER.md editing.
//!
//! Surfaces the v9-enabled holographic plugin to the Settings →
//! Memory page so the user can SEE that the agent is actually
//! learning (fact count climbs, category histogram, recent
//! additions) and edit their own profile (`USER.md`) without
//! popping a terminal.
//!
//! This is read-only / very-narrow-write: we don't expose
//! `fact_store add/remove` here because that's the LLM's job
//! through Hermes' tool calls. The user's affordance is
//! "describe a fact in chat and the agent will remember it",
//! not "type a SQL row by hand".

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::error::{IpcError, IpcResult};
use crate::fs_atomic;
use crate::hermes_config;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct HermesMemoryStatus {
    /// Active external memory provider name, or `None` when only the
    /// always-on built-in (USER.md / MEMORY.md) is in use.
    pub provider: Option<String>,
    /// `plugins.hermes-memory-store.auto_extract` — `None` when the
    /// YAML omits the field (Hermes default = `false`).
    pub auto_extract: Option<bool>,
    /// `plugins.hermes-memory-store.temporal_decay_half_life` (days).
    pub temporal_decay_days: Option<u32>,
    /// Absolute path to the holographic SQLite database.
    pub db_path: String,
    /// `true` if the file exists on disk.
    pub db_present: bool,
    /// `SELECT count(*) FROM facts`. `None` when the DB is missing
    /// or the schema doesn't match (a Hermes version drift would
    /// surface here as `None` rather than crash the page).
    pub fact_count: Option<u32>,
    /// Count of facts created in the last 7 days. Same null semantics
    /// as `fact_count`.
    pub recent_fact_count: Option<u32>,
    /// Top categories by count, e.g. `[("preference", 12), …]`.
    /// Capped at 8; empty when DB missing.
    pub top_categories: Vec<CategoryCount>,
    /// `~/.hermes/memories/USER.md` path.
    pub user_md_path: String,
    /// File contents (UTF-8). Empty string when the file is missing.
    pub user_md_content: String,
    /// `true` when the file exists and was readable.
    pub user_md_present: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryCount {
    pub category: String,
    pub count: u32,
}

#[tauri::command]
pub async fn hermes_memory_status() -> IpcResult<HermesMemoryStatus> {
    tokio::task::spawn_blocking(read_status)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_memory_status join: {e}"),
        })?
}

#[tauri::command]
pub async fn hermes_user_md_write(
    content: String,
    state: State<'_, AppState>,
) -> IpcResult<HermesMemoryStatus> {
    let _journal = state.changelog_path.clone();
    tokio::task::spawn_blocking(move || -> IpcResult<()> {
        let path = user_md_path().map_err(|e| IpcError::Internal {
            message: format!("resolve USER.md path: {e}"),
        })?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| IpcError::Internal {
                message: format!("create memories dir: {e}"),
            })?;
        }
        fs_atomic::atomic_write(&path, content.as_bytes(), None).map_err(|e| {
            IpcError::Internal {
                message: format!("write USER.md: {e}"),
            }
        })?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("hermes_user_md_write join: {e}"),
    })??;

    // Refresh the status snapshot for one-round-trip UI reconcile.
    tokio::task::spawn_blocking(read_status)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_memory_status join: {e}"),
        })?
}

// ───────────────────────── implementation ─────────────────────────

fn read_status() -> IpcResult<HermesMemoryStatus> {
    // Read the YAML for the fields `read_view` doesn't expose —
    // `memory.provider` and the `plugins.hermes-memory-store.*` group.
    // Cheap (one stat + one parse), and avoids growing the
    // `HermesConfigView` shape with niche fields only this page needs.
    let (provider, auto_extract, decay) = read_memory_yaml_fields().unwrap_or((None, None, None));

    let db_path = memory_db_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let (db_present, fact_count, recent_fact_count, top_categories) = match memory_db_path() {
        Ok(p) if p.exists() => match read_db_stats(&p) {
            Ok(s) => (true, Some(s.fact_count), Some(s.recent_fact_count), s.top_categories),
            // DB exists but schema query failed — treat as "present
            // but unreadable" (None counts) so the UI can show
            // "Hermes hasn't extracted any facts yet" rather than a
            // misleading "0 facts" implying an empty schema.
            Err(_) => (true, None, None, Vec::new()),
        },
        _ => (false, None, None, Vec::new()),
    };

    let (user_md_present, user_md_content, user_md_path) = match user_md_path() {
        Ok(p) => {
            let path_str = p.to_string_lossy().into_owned();
            match fs::read_to_string(&p) {
                Ok(c) => (true, c, path_str),
                Err(_) => (false, String::new(), path_str),
            }
        }
        Err(_) => (false, String::new(), String::new()),
    };

    Ok(HermesMemoryStatus {
        provider,
        auto_extract,
        temporal_decay_days: decay,
        db_path,
        db_present,
        fact_count,
        recent_fact_count,
        top_categories,
        user_md_path,
        user_md_content,
        user_md_present,
    })
}

fn read_memory_yaml_fields() -> Option<(Option<String>, Option<bool>, Option<u32>)> {
    let path = hermes_config::hermes_dir().ok()?.join("config.yaml");
    let raw = fs::read_to_string(&path).ok()?;
    let doc: serde_yaml::Value = serde_yaml::from_str(&raw).ok()?;
    let map = doc.as_mapping()?;

    let provider = map
        .get(serde_yaml::Value::String("memory".into()))
        .and_then(|v| v.as_mapping())
        .and_then(|m| m.get(serde_yaml::Value::String("provider".into())))
        .and_then(serde_yaml::Value::as_str)
        .map(str::to_owned);

    let plugin_map = map
        .get(serde_yaml::Value::String("plugins".into()))
        .and_then(|v| v.as_mapping())
        .and_then(|m| m.get(serde_yaml::Value::String("hermes-memory-store".into())))
        .and_then(|v| v.as_mapping());

    let auto_extract = plugin_map
        .and_then(|m| m.get(serde_yaml::Value::String("auto_extract".into())))
        .and_then(serde_yaml::Value::as_bool);

    let decay = plugin_map
        .and_then(|m| m.get(serde_yaml::Value::String("temporal_decay_half_life".into())))
        .and_then(serde_yaml::Value::as_u64)
        .map(|v| v as u32);

    Some((provider, auto_extract, decay))
}

struct DbStats {
    fact_count: u32,
    recent_fact_count: u32,
    top_categories: Vec<CategoryCount>,
}

fn read_db_stats(path: &std::path::Path) -> rusqlite::Result<DbStats> {
    let conn = rusqlite::Connection::open(path)?;

    let fact_count: u32 = conn
        .query_row("SELECT count(*) FROM facts", [], |row| row.get::<_, i64>(0))
        .map(|v| v as u32)?;

    // SQLite's `datetime('now', '-7 days')` gives UTC; the schema
    // stores `created_at` as `CURRENT_TIMESTAMP` (also UTC), so this
    // comparison is consistent across timezones without us having to
    // do anything fancy.
    let recent_fact_count: u32 = conn
        .query_row(
            "SELECT count(*) FROM facts WHERE created_at >= datetime('now', '-7 days')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v as u32)
        .unwrap_or(0);

    let mut stmt = conn.prepare(
        "SELECT category, count(*) AS n FROM facts \
         GROUP BY category ORDER BY n DESC LIMIT 8",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CategoryCount {
            category: row.get::<_, String>(0)?,
            count: row.get::<_, i64>(1)? as u32,
        })
    })?;

    let mut top_categories = Vec::new();
    for r in rows {
        if let Ok(c) = r {
            top_categories.push(c);
        }
    }

    Ok(DbStats {
        fact_count,
        recent_fact_count,
        top_categories,
    })
}

fn memory_db_path() -> std::io::Result<PathBuf> {
    Ok(hermes_config::hermes_dir()?.join("memory_store.db"))
}

fn user_md_path() -> std::io::Result<PathBuf> {
    Ok(hermes_config::hermes_dir()?
        .join("memories")
        .join("USER.md"))
}
