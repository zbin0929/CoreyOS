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
            "INSERT INTO messages
               (id, session_id, role, content, error, position, created_at,
                prompt_tokens, completion_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 role = excluded.role,
                 content = excluded.content,
                 error = excluded.error,
                 position = excluded.position,
                 -- Preserve existing token counts if the upserter didn't
                 -- supply them (common path: streaming writes content with
                 -- tokens=None; set_message_usage stamps them later, and
                 -- subsequent content upserts should not wipe that).
                 prompt_tokens = COALESCE(excluded.prompt_tokens, prompt_tokens),
                 completion_tokens = COALESCE(excluded.completion_tokens, completion_tokens)",
            params![
                m.id,
                m.session_id,
                m.role,
                m.content,
                m.error,
                m.position,
                m.created_at,
                m.prompt_tokens,
                m.completion_tokens,
            ],
        )?;
        Ok(())
    }

    /// Stamp token usage onto an existing message row. Idempotent — the
    /// streaming `onDone` callback may fire once per turn but Hermes sometimes
    /// redelivers `[DONE]`, and we also want the update to survive the app
    /// being restarted mid-turn (we re-ingest on hydration). Uses a direct
    /// UPDATE so the call avoids touching content/position fields that the
    /// upsert path owns.
    pub fn set_message_usage(
        &self,
        message_id: &str,
        prompt_tokens: Option<i64>,
        completion_tokens: Option<i64>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE messages
                SET prompt_tokens = ?1,
                    completion_tokens = ?2
              WHERE id = ?3",
            params![prompt_tokens, completion_tokens, message_id],
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
            "SELECT id, session_id, role, content, error, position, created_at,
                    prompt_tokens, completion_tokens
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
                    prompt_tokens: row.get(7)?,
                    completion_tokens: row.get(8)?,
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

    // v2: token usage on messages. Nullable so existing rows are untouched
    // (legacy data pre-dates usage ingestion, the Analytics rollup COALESCEs
    // to 0). Ingested by db_message_set_usage when streaming completes.
    if version < 2 {
        conn.execute_batch(
            r#"
            ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER;
            ALTER TABLE messages ADD COLUMN completion_tokens INTEGER;
            PRAGMA user_version = 2;
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
    /// Populated only on assistant messages after the stream completes —
    /// see `set_message_usage`. `None` on user messages and on turns that
    /// finished before usage ingestion landed (Phase 2 T2.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<i64>,
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

// ───────────────────────── Analytics ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayCount {
    /// ISO date `YYYY-MM-DD` (UTC). The frontend localizes on render.
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsTotals {
    pub sessions: i64,
    pub messages: i64,
    pub tool_calls: i64,
    /// Distinct UTC dates on which any message was written.
    pub active_days: i64,
    /// Sum of prompt + completion across all assistant messages that have
    /// usage recorded. Pre-T2.4 rows contribute 0.
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsSummary {
    pub totals: AnalyticsTotals,
    /// Messages/day for the trailing 30 days (inclusive). Dates with zero
    /// messages are omitted — the frontend pads the series for rendering.
    pub messages_per_day: Vec<DayCount>,
    /// `(prompt + completion)`-tokens per UTC day for the trailing 30 days.
    /// Same sparse shape as `messages_per_day`.
    pub tokens_per_day: Vec<DayCount>,
    /// Top 5 models by session count. `unknown` bucket covers NULL model.
    pub model_usage: Vec<NamedCount>,
    /// Top 10 tools by invocation count.
    pub tool_usage: Vec<NamedCount>,
    pub generated_at: i64,
}

impl Db {
    /// Produce everything the Analytics page needs in a single `lock()`.
    /// All timestamps in the DB are Unix ms; `now_ms` is used both for the
    /// 30-day window and for `generated_at` so tests can pin the clock.
    pub fn analytics_summary(&self, now_ms: i64) -> rusqlite::Result<AnalyticsSummary> {
        let conn = self.conn.lock();

        let sessions: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?;
        let messages: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
        let tool_calls: i64 =
            conn.query_row("SELECT COUNT(*) FROM tool_calls", [], |r| r.get(0))?;
        let active_days: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT date(created_at/1000, 'unixepoch')) FROM messages",
            [],
            |r| r.get(0),
        )?;

        // Lifetime token totals. COALESCE + SUM lets pre-T2.4 rows (NULL
        // tokens) contribute 0 without blowing up the SUM on an all-NULL set.
        let (prompt_tokens, completion_tokens): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0)
             FROM messages",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let total_tokens = prompt_tokens + completion_tokens;

        // 30-day window. created_at is ms since epoch.
        let since = now_ms - 30 * 86_400_000;
        let mut stmt = conn.prepare(
            "SELECT date(created_at/1000, 'unixepoch') AS d, COUNT(*)
             FROM messages
             WHERE created_at >= ?1
             GROUP BY d
             ORDER BY d",
        )?;
        let messages_per_day: Vec<DayCount> = stmt
            .query_map(params![since], |row| {
                Ok(DayCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // Tokens per day for the same 30-day window. WHERE clause keeps days
        // with all-NULL tokens from polluting the series with zero rows —
        // SUM over no rows = NULL and we'd get a "zero-count" bucket anyway.
        // Filtering on IS NOT NULL is the cleaner shape for the chart.
        let mut tstmt_day = conn.prepare(
            "SELECT date(created_at/1000, 'unixepoch') AS d,
                    COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS tok
             FROM messages
             WHERE created_at >= ?1
               AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
             GROUP BY d
             HAVING tok > 0
             ORDER BY d",
        )?;
        let tokens_per_day: Vec<DayCount> = tstmt_day
            .query_map(params![since], |row| {
                Ok(DayCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut mstmt = conn.prepare(
            "SELECT COALESCE(NULLIF(model, ''), 'unknown') AS m, COUNT(*)
             FROM sessions
             GROUP BY m
             ORDER BY COUNT(*) DESC
             LIMIT 5",
        )?;
        let model_usage: Vec<NamedCount> = mstmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut tstmt = conn.prepare(
            "SELECT tool, COUNT(*)
             FROM tool_calls
             GROUP BY tool
             ORDER BY COUNT(*) DESC
             LIMIT 10",
        )?;
        let tool_usage: Vec<NamedCount> = tstmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(AnalyticsSummary {
            totals: AnalyticsTotals {
                sessions,
                messages,
                tool_calls,
                active_days,
                prompt_tokens,
                completion_tokens,
                total_tokens,
            },
            messages_per_day,
            tokens_per_day,
            model_usage,
            tool_usage,
            generated_at: now_ms,
        })
    }
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
            prompt_tokens: None,
            completion_tokens: None,
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
            prompt_tokens: None,
            completion_tokens: None,
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
    fn analytics_summary_aggregates_counts_and_windows() {
        let db = Db::open_in_memory().unwrap();

        // Two sessions: one with explicit model, one NULL → falls into `unknown`.
        db.upsert_session(&SessionRow {
            id: "s1".into(),
            title: "t".into(),
            model: Some("deepseek-chat".into()),
            created_at: 1_000,
            updated_at: 1_000,
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s2".into(),
            title: "t".into(),
            model: None,
            created_at: 2_000,
            updated_at: 2_000,
        })
        .unwrap();

        // Two messages in window (5 days ago), one way outside window (45 days).
        let day_ms = 86_400_000i64;
        let now = 50 * day_ms;
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "user".into(),
            content: "x".into(),
            error: None,
            position: 0,
            created_at: now - 5 * day_ms,
            prompt_tokens: Some(11),
            completion_tokens: None,
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m2".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "y".into(),
            error: None,
            position: 1,
            created_at: now - 5 * day_ms + 1_000, // same UTC day as m1
            prompt_tokens: Some(20),
            completion_tokens: Some(33),
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m3".into(),
            session_id: "s2".into(),
            role: "user".into(),
            content: "z".into(),
            error: None,
            position: 0,
            created_at: now - 45 * day_ms, // outside 30-day window
            prompt_tokens: Some(999),
            completion_tokens: Some(999),
        })
        .unwrap();

        // Two tool calls on m1 — same tool counts twice.
        for i in 0..2 {
            db.append_tool_call(&ToolCallRow {
                id: format!("t{i}"),
                message_id: "m1".into(),
                tool: "terminal".into(),
                emoji: None,
                label: None,
                at: now - 5 * day_ms,
            })
            .unwrap();
        }
        db.append_tool_call(&ToolCallRow {
            id: "tw".into(),
            message_id: "m2".into(),
            tool: "web_search".into(),
            emoji: None,
            label: None,
            at: now - 5 * day_ms,
        })
        .unwrap();

        let s = db.analytics_summary(now).unwrap();
        assert_eq!(s.totals.sessions, 2);
        assert_eq!(s.totals.messages, 3);
        assert_eq!(s.totals.tool_calls, 3);
        assert_eq!(s.totals.active_days, 2); // two distinct dates

        // Lifetime token totals: sum across ALL rows (even out-of-window m3
        // contributes to lifetime totals — it's just excluded from the 30d
        // chart below). 11 + 20 + 999 = 1030 prompt, 0 + 33 + 999 = 1032 completion.
        assert_eq!(s.totals.prompt_tokens, 11 + 20 + 999);
        assert_eq!(s.totals.completion_tokens, 33 + 999);
        assert_eq!(
            s.totals.total_tokens,
            s.totals.prompt_tokens + s.totals.completion_tokens
        );

        // Only the in-window day shows up; m3 is excluded by the 30-day filter.
        assert_eq!(s.messages_per_day.len(), 1);
        assert_eq!(s.messages_per_day[0].count, 2);

        // 30d tokens_per_day: only m1 + m2 qualify, same day, sum is 11+20+33.
        assert_eq!(s.tokens_per_day.len(), 1);
        assert_eq!(s.tokens_per_day[0].count, 11 + 20 + 33);

        // Model usage — `deepseek-chat` and `unknown`, order by count desc is
        // ambiguous for equal counts, so just check the set.
        let names: Vec<_> = s.model_usage.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"deepseek-chat"));
        assert!(names.contains(&"unknown"));

        // Tools — terminal (2) must come before web_search (1).
        assert_eq!(s.tool_usage[0].name, "terminal");
        assert_eq!(s.tool_usage[0].count, 2);
        assert_eq!(s.tool_usage[1].name, "web_search");
        assert_eq!(s.tool_usage[1].count, 1);
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
            prompt_tokens: None,
            completion_tokens: None,
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

    #[test]
    fn set_message_usage_stamps_tokens_without_touching_content() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "payload".into(),
            error: None,
            position: 0,
            created_at: 110,
            prompt_tokens: None,
            completion_tokens: None,
        })
        .unwrap();

        // Stamp tokens after the fact (simulating the streaming onDone callback).
        db.set_message_usage("m1", Some(42), Some(7)).unwrap();

        // Re-stamping is allowed (Hermes sometimes redelivers usage).
        db.set_message_usage("m1", Some(42), Some(7)).unwrap();

        let tree = db.load_all().unwrap();
        let m = &tree[0].messages[0].msg;
        assert_eq!(m.content, "payload"); // unchanged
        assert_eq!(m.prompt_tokens, Some(42));
        assert_eq!(m.completion_tokens, Some(7));

        // Lifetime totals reflect the stamp.
        let s = db.analytics_summary(200).unwrap();
        assert_eq!(s.totals.prompt_tokens, 42);
        assert_eq!(s.totals.completion_tokens, 7);
        assert_eq!(s.totals.total_tokens, 49);
    }
}
