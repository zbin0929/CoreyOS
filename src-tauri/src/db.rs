//! SQLite-backed persistence for Caduceus chat state (sessions, messages,
//! tool-call annotations). Replaces the pre-Sprint-5C zustand/persist
//! localStorage blob so data survives browser-cache clears and is queryable
//! for the Phase 2 Analytics page.
//!
//! Schema is intentionally minimal — three tables with FK cascades. All writes
//! go through this module; the frontend calls IPC on every mutation so the DB
//! is always authoritative. `load_all` returns the full tree in one call for
//! app-startup hydration.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (or create) the DB at `path` and apply pending migrations.
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        // Sensible defaults for a single-writer desktop app.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory DB for unit tests. Migrations still run.
    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ─── sessions ─────────────────────────────────────────────────────

    pub fn upsert_session(&self, s: &SessionRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sessions (id, title, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 model = excluded.model,
                 updated_at = excluded.updated_at",
            params![s.id, s.title, s.model, s.created_at, s.updated_at],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ─── messages ─────────────────────────────────────────────────────

    pub fn upsert_message(&self, m: &MessageRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, error, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 role = excluded.role,
                 content = excluded.content,
                 error = excluded.error,
                 position = excluded.position",
            params![
                m.id,
                m.session_id,
                m.role,
                m.content,
                m.error,
                m.position,
                m.created_at,
            ],
        )?;
        Ok(())
    }

    // ─── tool calls ──────────────────────────────────────────────────

    pub fn append_tool_call(&self, t: &ToolCallRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR IGNORE INTO tool_calls (id, message_id, tool, emoji, label, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![t.id, t.message_id, t.tool, t.emoji, t.label, t.at],
        )?;
        Ok(())
    }

    // ─── bulk load for hydration ─────────────────────────────────────

    /// Load the full tree in one trip. Sessions come back ordered by
    /// `updated_at DESC` (MRU first — same order the UI expects). Messages
    /// and tool_calls are attached in insertion order.
    pub fn load_all(&self) -> rusqlite::Result<Vec<SessionWithMessages>> {
        let conn = self.conn.lock();

        // 1) Sessions (MRU first).
        let mut stmt = conn.prepare(
            "SELECT id, title, model, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
        )?;
        let sessions: Vec<SessionRow> = stmt
            .query_map([], |row| {
                Ok(SessionRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    model: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // 2) All messages, sorted by (session_id, position).
        let mut mstmt = conn.prepare(
            "SELECT id, session_id, role, content, error, position, created_at
             FROM messages ORDER BY session_id, position",
        )?;
        let messages: Vec<MessageRow> = mstmt
            .query_map([], |row| {
                Ok(MessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    error: row.get(4)?,
                    position: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // 3) All tool calls, sorted by (message_id, at).
        let mut tstmt = conn.prepare(
            "SELECT id, message_id, tool, emoji, label, at FROM tool_calls ORDER BY message_id, at",
        )?;
        let tool_calls: Vec<ToolCallRow> = tstmt
            .query_map([], |row| {
                Ok(ToolCallRow {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    tool: row.get(2)?,
                    emoji: row.get(3)?,
                    label: row.get(4)?,
                    at: row.get(5)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // Fold into the nested shape. O(N) with a couple of HashMaps.
        use std::collections::HashMap;
        let mut tc_by_msg: HashMap<String, Vec<ToolCallRow>> = HashMap::new();
        for t in tool_calls {
            tc_by_msg.entry(t.message_id.clone()).or_default().push(t);
        }
        let mut msgs_by_session: HashMap<String, Vec<MessageWithTools>> = HashMap::new();
        for m in messages {
            let tcs = tc_by_msg.remove(&m.id).unwrap_or_default();
            msgs_by_session
                .entry(m.session_id.clone())
                .or_default()
                .push(MessageWithTools {
                    msg: m,
                    tool_calls: tcs,
                });
        }

        Ok(sessions
            .into_iter()
            .map(|s| {
                let msgs = msgs_by_session.remove(&s.id).unwrap_or_default();
                SessionWithMessages {
                    session: s,
                    messages: msgs,
                }
            })
            .collect())
    }

    pub fn path_for_diagnostics(&self) -> String {
        self.conn
            .lock()
            .path()
            .map(|p| p.to_owned())
            .unwrap_or_else(|| ":memory:".to_string())
    }
}

/// Resolve the on-disk DB path (`<app_data_dir>/caduceus.db`). Must be
/// resolved inside Tauri's `setup()` hook because `app.path().app_data_dir()`
/// isn't available earlier.
pub fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("caduceus.db")
}

// ───────────────────────── Schema + migrations ─────────────────────────

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .optional()?
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                error TEXT,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, position);

            CREATE TABLE IF NOT EXISTS tool_calls (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                tool TEXT NOT NULL,
                emoji TEXT,
                label TEXT,
                at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id, at);

            PRAGMA user_version = 1;
            "#,
        )?;
    }

    Ok(())
}

// ───────────────────────── DTOs ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    /// Legacy per-session model override. Kept for forward-compat; not
    /// actively used since Sprint 5 (model choice is per-Hermes-config).
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub error: Option<String>,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRow {
    pub id: String,
    pub message_id: String,
    pub tool: String,
    pub emoji: Option<String>,
    pub label: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageWithTools {
    #[serde(flatten)]
    pub msg: MessageRow,
    pub tool_calls: Vec<ToolCallRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionWithMessages {
    #[serde(flatten)]
    pub session: SessionRow,
    pub messages: Vec<MessageWithTools>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_session(id: &str, ts: i64) -> SessionRow {
        SessionRow {
            id: id.into(),
            title: "t".into(),
            model: None,
            created_at: ts,
            updated_at: ts,
        }
    }

    #[test]
    fn round_trip_session_message_tool() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "user".into(),
            content: "hi".into(),
            error: None,
            position: 0,
            created_at: 110,
        })
        .unwrap();
        db.append_tool_call(&ToolCallRow {
            id: "t1".into(),
            message_id: "m1".into(),
            tool: "terminal".into(),
            emoji: Some("💻".into()),
            label: Some("pwd".into()),
            at: 120,
        })
        .unwrap();

        let tree = db.load_all().unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].session.id, "s1");
        assert_eq!(tree[0].messages.len(), 1);
        assert_eq!(tree[0].messages[0].tool_calls.len(), 1);
        assert_eq!(tree[0].messages[0].tool_calls[0].tool, "terminal");
    }

    #[test]
    fn session_mru_ordering() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("old", 100)).unwrap();
        db.upsert_session(&sample_session("new", 200)).unwrap();
        db.upsert_session(&sample_session("mid", 150)).unwrap();

        let tree = db.load_all().unwrap();
        let ids: Vec<_> = tree.iter().map(|s| s.session.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn deleting_session_cascades_messages_and_tools() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "user".into(),
            content: "x".into(),
            error: None,
            position: 0,
            created_at: 110,
        })
        .unwrap();
        db.append_tool_call(&ToolCallRow {
            id: "t1".into(),
            message_id: "m1".into(),
            tool: "terminal".into(),
            emoji: None,
            label: None,
            at: 120,
        })
        .unwrap();
        db.delete_session("s1").unwrap();

        let tree = db.load_all().unwrap();
        assert_eq!(tree.len(), 0);
    }

    #[test]
    fn upsert_message_updates_content() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        let base = MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "hel".into(),
            error: None,
            position: 0,
            created_at: 110,
        };
        db.upsert_message(&base).unwrap();
        db.upsert_message(&MessageRow {
            content: "hello world".into(),
            ..base.clone()
        })
        .unwrap();

        let tree = db.load_all().unwrap();
        assert_eq!(tree[0].messages[0].msg.content, "hello world");
    }
}
