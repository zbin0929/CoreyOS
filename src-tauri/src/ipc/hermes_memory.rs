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
use std::io::{BufRead, BufReader};
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

    let db_path = memory_db_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (db_present, fact_count, recent_fact_count, top_categories) = match memory_db_path() {
        Ok(p) if p.exists() => match read_db_stats(&p) {
            Ok(s) => (
                true,
                Some(s.fact_count),
                Some(s.recent_fact_count),
                s.top_categories,
            ),
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
    for c in rows.flatten() {
        top_categories.push(c);
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

// ───────────────────────── Auto-compression stats ─────────────────────────
//
// Surface evidence that Hermes' built-in `compression:` subsystem
// (see Settings → Context) is actually doing something. Without
// this, users who flip the slider have no visible feedback until
// they accidentally notice their long sessions don't OOM anymore.
//
// We don't store our own counter — Hermes already logs each
// compression event to `~/.hermes/logs/agent.log`. We just scan
// the log on demand and aggregate.

#[derive(Debug, Clone, Serialize, Default)]
pub struct CompressionStats {
    /// Total `Context compression triggered` events seen since the
    /// log file's first entry. Hermes rotates `agent.log` only
    /// manually, so this is effectively "since user installed
    /// Hermes" or "since they last cleared the log".
    pub total_compressions: u32,
    /// Cumulative `tokens saved` reported by `Compressed: ... ~N
    /// tokens saved` lines. Approximate — Hermes' counter rounds
    /// to the nearest 100 tokens — but accurate enough for "did
    /// auto-compress save me anything".
    pub total_tokens_saved: u64,
    /// ISO 8601 timestamp of the most recent compression event,
    /// `None` if no events have ever happened. Useful for the
    /// "last triggered: 2 days ago" copy.
    pub last_triggered_at: Option<String>,
    /// Absolute path the IPC scanned. Surfaced to the UI both as
    /// reassurance ("here's where the data came from") and so a
    /// curious user can grep it manually.
    pub log_path: String,
    /// `true` if the log file existed and was readable. `false`
    /// when Hermes hasn't been run yet, log was deleted, or
    /// permissions denied. Distinct from `total_compressions=0`
    /// (= log exists but no events yet).
    pub log_present: bool,
}

#[tauri::command]
pub async fn hermes_compression_stats() -> IpcResult<CompressionStats> {
    tokio::task::spawn_blocking(read_compression_stats)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_compression_stats join: {e}"),
        })?
}

fn read_compression_stats() -> IpcResult<CompressionStats> {
    let log_path = match hermes_config::hermes_dir() {
        Ok(d) => d.join("logs").join("agent.log"),
        Err(_) => {
            return Ok(CompressionStats::default());
        }
    };
    let log_path_str = log_path.to_string_lossy().into_owned();

    let file = match fs::File::open(&log_path) {
        Ok(f) => f,
        Err(_) => {
            return Ok(CompressionStats {
                log_path: log_path_str,
                log_present: false,
                ..CompressionStats::default()
            });
        }
    };

    let mut total_compressions: u32 = 0;
    let mut total_tokens_saved: u64 = 0;
    let mut last_triggered_at: Option<String> = None;

    // Hermes log format: "YYYY-MM-DD HH:MM:SS,mmm INFO module: msg"
    // — a leading space-separated date+time gives us the timestamp.
    // We grep + parse line-by-line; the file is typically 1-50 MB,
    // BufReader streams in O(filesize) wall time without spiking
    // memory, well within the few-hundred-ms budget for an IPC.
    let reader = BufReader::new(file);
    for line_res in reader.lines() {
        let Ok(line) = line_res else { continue };
        if line.contains("Context compression triggered") {
            total_compressions += 1;
            // Timestamp is the first 19 chars: "2026-04-27 14:23:45".
            // The comma+millis is dropped — date precision is more than
            // enough for the UI's "Last triggered: ..." copy.
            if line.len() >= 19 {
                last_triggered_at = Some(line[..19].to_string());
            }
        } else if let Some(saved) = extract_tokens_saved(&line) {
            total_tokens_saved = total_tokens_saved.saturating_add(saved as u64);
        }
    }

    Ok(CompressionStats {
        total_compressions,
        total_tokens_saved,
        last_triggered_at,
        log_path: log_path_str,
        log_present: true,
    })
}

// ───────────────────────── Session disk usage ─────────────────────────
//
// `~/.hermes/sessions/` accumulates one JSON file per agent session
// (Hermes' own legacy backend, kept alongside the newer state.db
// for compatibility). Corey doesn't manage these files — they're
// owned by Hermes — but we surface the count + total size in the
// Memory settings panel so users can spot-check disk usage and
// trigger an opt-in cleanup when the directory has grown unwieldy.

#[derive(Debug, Clone, Serialize, Default)]
pub struct HermesSessionUsage {
    /// Number of `session_*.json` (or `.jsonl`) files present.
    pub file_count: u32,
    /// Total bytes summed across all session files.
    pub total_bytes: u64,
    /// Earliest mtime (unix ms) seen, or 0 when empty. Lets the UI
    /// answer "how old is the oldest session?" without a second
    /// IPC.
    pub oldest_mtime_ms: i64,
    /// Absolute path scanned. Same reassurance as compression_stats.
    pub sessions_dir: String,
    /// `true` if the directory existed.
    pub present: bool,
}

#[tauri::command]
pub async fn hermes_session_usage() -> IpcResult<HermesSessionUsage> {
    tokio::task::spawn_blocking(read_session_usage)
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_session_usage join: {e}"),
        })?
}

fn read_session_usage() -> IpcResult<HermesSessionUsage> {
    let dir = match hermes_config::hermes_dir() {
        Ok(d) => d.join("sessions"),
        Err(_) => return Ok(HermesSessionUsage::default()),
    };
    let dir_str = dir.to_string_lossy().into_owned();
    let entries = match fs::read_dir(&dir) {
        Ok(it) => it,
        Err(_) => {
            return Ok(HermesSessionUsage {
                sessions_dir: dir_str,
                present: false,
                ..HermesSessionUsage::default()
            });
        }
    };

    let mut count: u32 = 0;
    let mut bytes: u64 = 0;
    let mut oldest: i64 = i64::MAX;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Two formats coexist: `session_<id>.json` (Hermes index
        // sidecar) and `session_<ts>_<id>.jsonl` (per-session
        // transcript). We count both — they're all noise the user
        // might want to GC.
        if !name.starts_with("session_") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        count = count.saturating_add(1);
        bytes = bytes.saturating_add(meta.len());
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                let ms = dur.as_millis() as i64;
                if ms < oldest {
                    oldest = ms;
                }
            }
        }
    }
    Ok(HermesSessionUsage {
        file_count: count,
        total_bytes: bytes,
        oldest_mtime_ms: if count == 0 { 0 } else { oldest },
        sessions_dir: dir_str,
        present: true,
    })
}

/// Delete every `session_*` file in `~/.hermes/sessions/` whose
/// mtime is older than `older_than_days`. Returns the number of
/// files actually removed.
///
/// Conservative: we only touch files matching the `session_`
/// prefix so a stray user file in the dir isn't hit. We also
/// preserve `sessions.json` (the index sidecar) — deleting that
/// would break Hermes's own bookkeeping.
#[tauri::command]
pub async fn hermes_session_cleanup(older_than_days: u32) -> IpcResult<u32> {
    tokio::task::spawn_blocking(move || cleanup_sessions(older_than_days))
        .await
        .map_err(|e| IpcError::Internal {
            message: format!("hermes_session_cleanup join: {e}"),
        })?
}

fn cleanup_sessions(older_than_days: u32) -> IpcResult<u32> {
    let dir = hermes_config::hermes_dir()
        .map_err(|e| IpcError::Internal {
            message: format!("resolve hermes dir: {e}"),
        })?
        .join("sessions");
    if !dir.exists() {
        return Ok(0);
    }
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(
            (older_than_days as u64) * 24 * 3600,
        ))
        .unwrap_or(std::time::UNIX_EPOCH);

    let entries = fs::read_dir(&dir).map_err(|e| IpcError::Internal {
        message: format!("read sessions dir: {e}"),
    })?;
    let mut removed: u32 = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().into_owned();
        // sessions.json (no `_` after the stem) is Hermes's own
        // index — leaving it alone keeps Hermes happy.
        if !name.starts_with("session_") {
            continue;
        }
        if name == "sessions.json" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified > cutoff {
            continue;
        }
        if fs::remove_file(entry.path()).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

/// Parse the integer N out of `Compressed: A -> B messages (~N tokens
/// saved, P%)`. Returns `None` for any other shape. We deliberately
/// avoid pulling in the `regex` crate — this is one fixed format and
/// a tiny scanner is faster + 0 deps.
fn extract_tokens_saved(line: &str) -> Option<u32> {
    let marker = "tokens saved";
    let pos = line.find(marker)?;
    // Walk backward from `marker` past whitespace to find the digit
    // run. Format: "~12345 tokens saved", or rarely "12345 tokens
    // saved" if Hermes ever drops the tilde.
    let prefix = line[..pos].trim_end();
    let digits: String = prefix
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tokens_saved_with_tilde() {
        assert_eq!(
            extract_tokens_saved(
                "2026-04-27 14:23:45,123 INFO agent.context_compressor: Compressed: 12 -> 6 messages (~4500 tokens saved, 35%)"
            ),
            Some(4500)
        );
    }

    #[test]
    fn parses_tokens_saved_without_tilde() {
        assert_eq!(
            extract_tokens_saved("Compressed: 12 -> 6 messages (12345 tokens saved, 80%)"),
            Some(12345)
        );
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert_eq!(extract_tokens_saved("INFO: gateway started"), None);
        assert_eq!(extract_tokens_saved("tokens saved without number"), None);
    }
}

// ───────────────────────── Fact retrieval (P1-1) ─────────────────────────
//
// Read-only queries against Hermes' `memory_store.db`.
// Three operations:
//   1. `memory_fact_search` — FTS5 + trust-weighted search
//   2. `memory_entity_list` — all entities sorted by fact count
//   3. `memory_entity_facts` — facts linked to a specific entity
//
// All gracefully degrade: if the DB is missing or the schema has
// changed under us, the caller gets an empty vec and the chat
// proceeds without fact enrichment.

#[derive(Debug, Clone, Serialize)]
pub struct MemoryFactHit {
    pub fact_id: i64,
    pub content: String,
    pub category: String,
    pub trust_score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryEntity {
    pub entity_id: i64,
    pub name: String,
    pub entity_type: String,
    pub fact_count: i64,
}

#[tauri::command]
pub async fn memory_fact_search(
    query: String,
    limit: Option<u32>,
) -> IpcResult<Vec<MemoryFactHit>> {
    let lim = limit.unwrap_or(5).min(20);
    tokio::task::spawn_blocking(move || {
        let path = memory_db_path().map_err(|e| IpcError::Internal {
            message: format!("memory db path: {e}"),
        })?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = rusqlite::Connection::open(&path).map_err(|e| IpcError::Internal {
            message: format!("open memory_store.db: {e}"),
        })?;

        let sanitized = sanitize_fact_query(&query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        let sql = "SELECT f.fact_id, f.content, f.category, f.trust_score \
             FROM facts_fts fts \
             JOIN facts f ON f.fact_id = fts.rowid \
             WHERE facts_fts MATCH ? AND f.trust_score >= 0.3 \
             ORDER BY fts.rank, f.trust_score DESC \
             LIMIT ?";
        let mut stmt = conn.prepare(sql).map_err(|e| IpcError::Internal {
            message: format!("prepare fact search: {e}"),
        })?;
        let rows = stmt
            .query_map(rusqlite::params![sanitized, lim], |row| {
                Ok(MemoryFactHit {
                    fact_id: row.get::<_, i64>(0)?,
                    content: row.get::<_, String>(1)?,
                    category: row.get::<_, String>(2)?,
                    trust_score: row.get::<_, f64>(3)?,
                })
            })
            .map_err(|e| IpcError::Internal {
                message: format!("execute fact search: {e}"),
            })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("memory_fact_search join: {e}"),
    })?
}

#[tauri::command]
pub async fn memory_entity_list(limit: Option<u32>) -> IpcResult<Vec<MemoryEntity>> {
    let lim = limit.unwrap_or(50).min(200);
    tokio::task::spawn_blocking(move || {
        let path = memory_db_path().map_err(|e| IpcError::Internal {
            message: format!("memory db path: {e}"),
        })?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = rusqlite::Connection::open(&path).map_err(|e| IpcError::Internal {
            message: format!("open memory_store.db: {e}"),
        })?;

        let sql = "SELECT e.entity_id, e.name, e.entity_type, COUNT(fe.fact_id) AS fc \
             FROM entities e \
             LEFT JOIN fact_entities fe ON fe.entity_id = e.entity_id \
             GROUP BY e.entity_id \
             ORDER BY fc DESC \
             LIMIT ?";
        let mut stmt = conn.prepare(sql).map_err(|e| IpcError::Internal {
            message: format!("prepare entity list: {e}"),
        })?;
        let rows = stmt
            .query_map(rusqlite::params![lim], |row| {
                Ok(MemoryEntity {
                    entity_id: row.get::<_, i64>(0)?,
                    name: row.get::<_, String>(1)?,
                    entity_type: row.get::<_, String>(2)?,
                    fact_count: row.get::<_, i64>(3)?,
                })
            })
            .map_err(|e| IpcError::Internal {
                message: format!("execute entity list: {e}"),
            })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("memory_entity_list join: {e}"),
    })?
}

#[tauri::command]
pub async fn memory_entity_facts(
    entity_name: String,
    limit: Option<u32>,
) -> IpcResult<Vec<MemoryFactHit>> {
    let lim = limit.unwrap_or(10).min(50);
    tokio::task::spawn_blocking(move || {
        let path = memory_db_path().map_err(|e| IpcError::Internal {
            message: format!("memory db path: {e}"),
        })?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = rusqlite::Connection::open(&path).map_err(|e| IpcError::Internal {
            message: format!("open memory_store.db: {e}"),
        })?;

        let sql = "SELECT f.fact_id, f.content, f.category, f.trust_score \
             FROM facts f \
             JOIN fact_entities fe ON fe.fact_id = f.fact_id \
             JOIN entities e ON e.entity_id = fe.entity_id \
             WHERE e.name LIKE ? AND f.trust_score >= 0.3 \
             ORDER BY f.trust_score DESC \
             LIMIT ?";
        let mut stmt = conn.prepare(sql).map_err(|e| IpcError::Internal {
            message: format!("prepare entity facts: {e}"),
        })?;
        let pattern = format!("%{}%", entity_name);
        let rows = stmt
            .query_map(rusqlite::params![pattern, lim], |row| {
                Ok(MemoryFactHit {
                    fact_id: row.get::<_, i64>(0)?,
                    content: row.get::<_, String>(1)?,
                    category: row.get::<_, String>(2)?,
                    trust_score: row.get::<_, f64>(3)?,
                })
            })
            .map_err(|e| IpcError::Internal {
                message: format!("execute entity facts: {e}"),
            })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("memory_entity_facts join: {e}"),
    })?
}

fn sanitize_fact_query(raw: &str) -> String {
    let q = raw.trim();
    if q.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(q.len());
    for token in q.split_whitespace() {
        let clean: String = token
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if clean.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&clean);
    }
    if out.is_empty() {
        return String::new();
    }
    out
}

// ───────────────────────── P2: Corey entity relations ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct EntityRelation {
    pub from_id: i64,
    pub to_id: i64,
    pub from_name: String,
    pub to_name: String,
    pub rel_type: String,
    pub confidence: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphQueryResult {
    pub entities: Vec<MemoryEntity>,
    pub relations: Vec<EntityRelation>,
}

fn ensure_corey_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS corey_entity_relations (
            from_id    INTEGER,
            to_id      INTEGER,
            rel_type   TEXT NOT NULL,
            confidence REAL DEFAULT 0.5,
            source     TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (from_id, to_id, rel_type)
        );
        CREATE INDEX IF NOT EXISTS idx_corey_rel_from ON corey_entity_relations(from_id);
        CREATE INDEX IF NOT EXISTS idx_corey_rel_to ON corey_entity_relations(to_id);
        CREATE INDEX IF NOT EXISTS idx_corey_rel_type ON corey_entity_relations(rel_type);

        CREATE TABLE IF NOT EXISTS corey_entity_mentions (
            entity_id    INTEGER,
            session_id   TEXT NOT NULL,
            mentioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            source       TEXT DEFAULT 'chat',
            PRIMARY KEY (entity_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_corey_mention_entity ON corey_entity_mentions(entity_id);",
    )?;
    Ok(())
}

#[tauri::command]
pub async fn corey_relation_add(
    from_entity_name: String,
    to_entity_name: String,
    rel_type: String,
    source: Option<String>,
) -> IpcResult<()> {
    let src = source.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        let path = memory_db_path().map_err(|e| IpcError::Internal {
            message: format!("memory db path: {e}"),
        })?;
        if !path.exists() {
            return Err(IpcError::Internal {
                message: "memory_store.db not found".into(),
            });
        }
        let conn = rusqlite::Connection::open(&path).map_err(|e| IpcError::Internal {
            message: format!("open memory_store.db: {e}"),
        })?;
        ensure_corey_tables(&conn).map_err(|e| IpcError::Internal {
            message: format!("ensure corey tables: {e}"),
        })?;

        let from_id: i64 = conn
            .query_row(
                "SELECT entity_id FROM entities WHERE name LIKE ? LIMIT 1",
                rusqlite::params![format!("%{}%", from_entity_name)],
                |row| row.get(0),
            )
            .map_err(|e| IpcError::Internal {
                message: format!("entity '{}' not found: {e}", from_entity_name),
            })?;
        let to_id: i64 = conn
            .query_row(
                "SELECT entity_id FROM entities WHERE name LIKE ? LIMIT 1",
                rusqlite::params![format!("%{}%", to_entity_name)],
                |row| row.get(0),
            )
            .map_err(|e| IpcError::Internal {
                message: format!("entity '{}' not found: {e}", to_entity_name),
            })?;

        conn.execute(
            "INSERT OR IGNORE INTO corey_entity_relations (from_id, to_id, rel_type, source) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![from_id, to_id, rel_type, src],
        )
        .map_err(|e| IpcError::Internal {
            message: format!("insert relation: {e}"),
        })?;

        Ok(())
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("corey_relation_add join: {e}"),
    })?
}

#[tauri::command]
pub async fn corey_graph_query(
    entity_name: String,
    depth: Option<u32>,
) -> IpcResult<GraphQueryResult> {
    let max_depth = depth.unwrap_or(2).min(4);
    tokio::task::spawn_blocking(move || {
        let path = memory_db_path().map_err(|e| IpcError::Internal {
            message: format!("memory db path: {e}"),
        })?;
        if !path.exists() {
            return Ok(GraphQueryResult {
                entities: Vec::new(),
                relations: Vec::new(),
            });
        }
        let conn = rusqlite::Connection::open(&path).map_err(|e| IpcError::Internal {
            message: format!("open memory_store.db: {e}"),
        })?;
        let _ = ensure_corey_tables(&conn);

        let start_id: Option<i64> = conn
            .query_row(
                "SELECT entity_id FROM entities WHERE name LIKE ? LIMIT 1",
                rusqlite::params![format!("%{}%", entity_name)],
                |row| row.get(0),
            )
            .ok();

        let start_id = match start_id {
            Some(id) => id,
            None => {
                return Ok(GraphQueryResult {
                    entities: Vec::new(),
                    relations: Vec::new(),
                });
            }
        };

        let mut visited: std::collections::HashSet<i64> = std::collections::HashSet::new();
        visited.insert(start_id);
        let mut frontier: Vec<i64> = vec![start_id];
        let mut all_relations: Vec<EntityRelation> = Vec::new();

        for _ in 0..max_depth {
            let mut next_frontier: Vec<i64> = Vec::new();
            for eid in &frontier {
                let mut stmt = conn
                    .prepare(
                        "SELECT cr.from_id, cr.to_id, cr.rel_type, cr.confidence, cr.source, \
                     e1.name, e2.name \
                     FROM corey_entity_relations cr \
                     JOIN entities e1 ON e1.entity_id = cr.from_id \
                     JOIN entities e2 ON e2.entity_id = cr.to_id \
                     WHERE cr.from_id = ?1 OR cr.to_id = ?1",
                    )
                    .map_err(|e| IpcError::Internal {
                        message: format!("prepare graph: {e}"),
                    })?;

                let rows = stmt
                    .query_map(rusqlite::params![eid], |row| {
                        Ok(EntityRelation {
                            from_id: row.get::<_, i64>(0)?,
                            to_id: row.get::<_, i64>(1)?,
                            from_name: row.get::<_, String>(5)?,
                            to_name: row.get::<_, String>(6)?,
                            rel_type: row.get::<_, String>(2)?,
                            confidence: row.get::<_, f64>(3)?,
                            source: row.get::<_, String>(4)?,
                        })
                    })
                    .map_err(|e| IpcError::Internal {
                        message: format!("exec graph: {e}"),
                    })?;

                for r in rows.flatten() {
                    all_relations.push(r.clone());
                    if !visited.contains(&r.from_id) {
                        visited.insert(r.from_id);
                        next_frontier.push(r.from_id);
                    }
                    if !visited.contains(&r.to_id) {
                        visited.insert(r.to_id);
                        next_frontier.push(r.to_id);
                    }
                }
            }
            if next_frontier.is_empty() {
                break;
            }
            frontier = next_frontier;
        }

        let id_list: Vec<String> = visited.iter().map(|id| id.to_string()).collect();
        let placeholders = id_list.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT e.entity_id, e.name, e.entity_type, COUNT(fe.fact_id) AS fc \
             FROM entities e \
             LEFT JOIN fact_entities fe ON fe.entity_id = e.entity_id \
             WHERE e.entity_id IN ({}) \
             GROUP BY e.entity_id",
            placeholders
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| IpcError::Internal {
            message: format!("prepare entity batch: {e}"),
        })?;
        let params: Vec<&dyn rusqlite::ToSql> = visited
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok(MemoryEntity {
                    entity_id: row.get::<_, i64>(0)?,
                    name: row.get::<_, String>(1)?,
                    entity_type: row.get::<_, String>(2)?,
                    fact_count: row.get::<_, i64>(3)?,
                })
            })
            .map_err(|e| IpcError::Internal {
                message: format!("exec entity batch: {e}"),
            })?;

        let mut entities = Vec::new();
        for r in rows.flatten() {
            entities.push(r);
        }

        Ok(GraphQueryResult {
            entities,
            relations: all_relations,
        })
    })
    .await
    .map_err(|e| IpcError::Internal {
        message: format!("corey_graph_query join: {e}"),
    })?
}
