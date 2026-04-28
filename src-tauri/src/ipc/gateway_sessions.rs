use serde::Serialize;
use std::path::PathBuf;
use tauri::command;

use crate::paths;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySession {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub source: Option<String>,
    pub message_count: i64,
    pub started_at: Option<f64>,
    pub last_activity: Option<f64>,
}

fn state_db_path() -> Result<PathBuf, String> {
    let dir = paths::hermes_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.db"))
}

#[command]
pub fn gateway_sessions_list() -> Result<Vec<GatewaySession>, String> {
    let db_path = state_db_path()?;
    if !db_path.exists() {
        return Ok(vec![]);
    }
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("open state.db: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.model, s.source, s.message_count,
                    s.started_at, MAX(m.timestamp) AS last_activity
             FROM sessions s
             LEFT JOIN messages m ON m.session_id = s.id
             WHERE s.source IS NOT NULL
               AND s.source != 'webui'
               AND s.source != 'cron'
             GROUP BY s.id
             ORDER BY COALESCE(last_activity, s.started_at, 0) DESC
             LIMIT 200",
        )
        .map_err(|e| format!("prepare: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(GatewaySession {
                id: row.get(0)?,
                title: row.get(1).unwrap_or_default(),
                model: row.get(2).unwrap_or(None),
                source: row.get(3).unwrap_or(None),
                message_count: row.get(4).unwrap_or(0),
                started_at: row.get(5).unwrap_or(None),
                last_activity: row.get(6).unwrap_or(None),
            })
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[command]
pub fn gateway_session_messages(
    session_id: String,
) -> Result<Vec<GatewayMessage>, String> {
    let db_path = state_db_path()?;
    if !db_path.exists() {
        return Ok(vec![]);
    }
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("open state.db: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT role, content, timestamp
             FROM messages
             WHERE session_id = ?
             ORDER BY timestamp ASC
             LIMIT 500",
        )
        .map_err(|e| format!("prepare: {e}"))?;

    let rows = stmt
        .query_map([&session_id], |row| {
            Ok(GatewayMessage {
                role: row.get(0)?,
                content: row.get(1)?,
                timestamp: row.get(2)?,
            })
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMessage {
    pub role: String,
    pub content: String,
    pub timestamp: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_test_db() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "corey_test_gateway_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("state.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                model TEXT,
                source TEXT,
                message_count INTEGER DEFAULT 0,
                started_at REAL,
                ended_at REAL,
                end_reason TEXT,
                parent_session_id TEXT
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp REAL NOT NULL
            );
            INSERT INTO sessions (id, title, model, source, message_count, started_at)
                VALUES ('s1', 'CLI chat', 'gpt-4o', 'cli', 2, 1000.0);
            INSERT INTO sessions (id, title, model, source, message_count, started_at)
                VALUES ('s2', 'TG chat', 'claude-3', 'telegram', 1, 2000.0);
            INSERT INTO sessions (id, title, model, source, message_count, started_at)
                VALUES ('s3', 'WebUI', 'gpt-4o', 'webui', 1, 3000.0);
            INSERT INTO sessions (id, title, model, source, message_count, started_at)
                VALUES ('s4', 'Cron', 'gpt-4o', 'cron', 1, 4000.0);
            INSERT INTO messages (session_id, role, content, timestamp)
                VALUES ('s1', 'user', 'hello', 1001.0);
            INSERT INTO messages (session_id, role, content, timestamp)
                VALUES ('s1', 'assistant', 'hi', 1002.0);
            INSERT INTO messages (session_id, role, content, timestamp)
                VALUES ('s2', 'user', 'hi tg', 2001.0);",
        )
        .unwrap();
        drop(conn);
        dir
    }

    fn teardown_test_db(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gateway_sessions_excludes_webui_and_cron() {
        let dir = setup_test_db();
        let db_path = dir.join("state.db");
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.title, s.model, s.source, s.message_count,
                        s.started_at, MAX(m.timestamp) AS last_activity
                 FROM sessions s
                 LEFT JOIN messages m ON m.session_id = s.id
                 WHERE s.source IS NOT NULL
                   AND s.source != 'webui'
                   AND s.source != 'cron'
                 GROUP BY s.id
                 ORDER BY COALESCE(last_activity, s.started_at, 0) DESC",
            )
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows, vec!["s2", "s1"]);
        teardown_test_db(&dir);
    }

    #[test]
    fn gateway_session_messages_returns_ordered() {
        let dir = setup_test_db();
        let db_path = dir.join("state.db");
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT role, content, timestamp
                 FROM messages
                 WHERE session_id = 's1'
                 ORDER BY timestamp ASC",
            )
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("user".into(), "hello".into()),
                ("assistant".into(), "hi".into()),
            ]
        );
        teardown_test_db(&dir);
    }
}
