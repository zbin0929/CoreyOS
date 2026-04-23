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
            "INSERT INTO sessions (id, title, model, created_at, updated_at, adapter_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 model = excluded.model,
                 updated_at = excluded.updated_at,
                 -- T5.5c — don't let a late upsert migrate a session across
                 -- adapters. adapter_id is set at creation and frozen for
                 -- the session's lifetime; the COALESCE preserves whatever
                 -- was there even if the caller forgets to pass it.
                 adapter_id = COALESCE(sessions.adapter_id, excluded.adapter_id)",
            params![
                s.id,
                s.title,
                s.model,
                s.created_at,
                s.updated_at,
                s.adapter_id,
            ],
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
                prompt_tokens, completion_tokens, feedback)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
                 completion_tokens = COALESCE(excluded.completion_tokens, completion_tokens),
                 -- T6.1 — feedback is set via `set_message_feedback` after
                 -- the stream completes (or cleared to NULL on toggle-off).
                 -- Subsequent content upserts (legacy code paths) pass
                 -- feedback=None and MUST NOT wipe a real rating.
                 feedback = COALESCE(excluded.feedback, feedback)",
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
                m.feedback,
            ],
        )?;
        Ok(())
    }

    /// T6.1 — stamp or clear a 👍/👎 rating on an assistant message.
    /// `value` must be `Some("up")`, `Some("down")`, or `None` (clear).
    /// Any other string is rejected so we don't end up with garbage in
    /// the column that the analytics rollup would silently ignore.
    pub fn set_message_feedback(
        &self,
        message_id: &str,
        value: Option<&str>,
    ) -> rusqlite::Result<()> {
        if let Some(v) = value {
            if v != "up" && v != "down" {
                return Err(rusqlite::Error::InvalidParameterName(format!(
                    "feedback must be 'up', 'down', or null (got {v:?})"
                )));
            }
        }
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE messages SET feedback = ?1 WHERE id = ?2",
            params![value, message_id],
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

    // ─── attachments ─────────────────────────────────────────────────

    /// Insert a new attachment row. Caller supplies the id (same uuid the
    /// `attachments` module stamped onto the staged file) so duplicate
    /// inserts are a client bug, not a silent upsert.
    pub fn insert_attachment(&self, a: &AttachmentRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO attachments (id, message_id, name, mime, size, path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                a.id,
                a.message_id,
                a.name,
                a.mime,
                a.size,
                a.path,
                a.created_at
            ],
        )?;
        Ok(())
    }

    /// Delete a single attachment row. The on-disk file is removed by the
    /// IPC handler (`ipc::attachments::attachment_delete`) separately — the
    /// DB row and the file have distinct failure modes and the frontend
    /// sees both over two calls.
    pub fn delete_attachment(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ─── bulk load for hydration ─────────────────────────────────────

    /// Load the full tree in one trip. Sessions come back ordered by
    /// `updated_at DESC` (MRU first — same order the UI expects). Messages
    /// and tool_calls are attached in insertion order.
    pub fn load_all(&self) -> rusqlite::Result<Vec<SessionWithMessages>> {
        let conn = self.conn.lock();

        // 1) Sessions (MRU first). `adapter_id` comes out of the v5
        // migration with a backfilled `'hermes'` for pre-T5.5c rows; we
        // still COALESCE to `'hermes'` defensively in case a row was
        // written via a buggy path that left it NULL.
        let mut stmt = conn.prepare(
            "SELECT id, title, model, created_at, updated_at,
                    COALESCE(adapter_id, 'hermes')
             FROM sessions ORDER BY updated_at DESC",
        )?;
        let sessions: Vec<SessionRow> = stmt
            .query_map([], |row| {
                Ok(SessionRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    model: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    adapter_id: row.get(5)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // 2) All messages, sorted by (session_id, position).
        let mut mstmt = conn.prepare(
            "SELECT id, session_id, role, content, error, position, created_at,
                    prompt_tokens, completion_tokens, feedback
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
                    feedback: row.get(9)?,
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

        // 4) All attachments, sorted by (message_id, created_at). Cheap
        //    even at O(10k) rows — clients never hydrate that deep.
        let mut astmt = conn.prepare(
            "SELECT id, message_id, name, mime, size, path, created_at
             FROM attachments ORDER BY message_id, created_at",
        )?;
        let attachments: Vec<AttachmentRow> = astmt
            .query_map([], |row| {
                Ok(AttachmentRow {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    name: row.get(2)?,
                    mime: row.get(3)?,
                    size: row.get(4)?,
                    path: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // Fold into the nested shape. O(N) with a couple of HashMaps.
        use std::collections::HashMap;
        let mut tc_by_msg: HashMap<String, Vec<ToolCallRow>> = HashMap::new();
        for t in tool_calls {
            tc_by_msg.entry(t.message_id.clone()).or_default().push(t);
        }
        let mut att_by_msg: HashMap<String, Vec<AttachmentRow>> = HashMap::new();
        for a in attachments {
            att_by_msg.entry(a.message_id.clone()).or_default().push(a);
        }
        let mut msgs_by_session: HashMap<String, Vec<MessageWithTools>> = HashMap::new();
        for m in messages {
            let tcs = tc_by_msg.remove(&m.id).unwrap_or_default();
            let atts = att_by_msg.remove(&m.id).unwrap_or_default();
            msgs_by_session
                .entry(m.session_id.clone())
                .or_default()
                .push(MessageWithTools {
                    msg: m,
                    tool_calls: tcs,
                    attachments: atts,
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

    // v3: Phase 4 T4.6 runbooks. `template` holds the raw prompt body with
    // `{{param}}` placeholders; parameters are derived at render time so we
    // don't need a separate schema column. `scope_profile` is NULL for
    // "global" runbooks (usable in any profile) or a profile name otherwise.
    // v3 also adds the budgets table (T4.4) so a single migration bump
    // covers both — neither feature ships a separate v.
    if version < 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS runbooks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                template TEXT NOT NULL,
                scope_profile TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_runbooks_updated ON runbooks(updated_at DESC);

            CREATE TABLE IF NOT EXISTS budgets (
                id TEXT PRIMARY KEY,
                scope_kind TEXT NOT NULL,
                scope_value TEXT,
                amount_cents INTEGER NOT NULL,
                period TEXT NOT NULL,
                action_on_breach TEXT NOT NULL DEFAULT 'notify',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope_kind, scope_value);

            PRAGMA user_version = 3;
            "#,
        )?;
    }

    // v4: Phase 1 T1.5 — chat attachments. Each row points at a file staged
    // under `~/.hermes/attachments/<uuid>.<ext>`; on-disk cleanup is the
    // caller's job (we cascade the row via `ON DELETE CASCADE` but don't
    // sweep orphaned files — a manual `hermes clean` subcommand can do that
    // later if it becomes a real problem).
    if version < 4 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                size INTEGER NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id, created_at);
            PRAGMA user_version = 4;
            "#,
        )?;
    }

    // v5: Phase 5 T5.5c — per-session `adapter_id` for the unified inbox.
    // Legacy rows predate multi-adapter support and all came from Hermes,
    // so we backfill `'hermes'` (NOT NULL after the backfill to keep the
    // UI's merge/filter logic total). The index gets the inbox-filter
    // query path (list-by-adapter, MRU-first) to an index lookup.
    if version < 5 {
        conn.execute_batch(
            r#"
            ALTER TABLE sessions ADD COLUMN adapter_id TEXT;
            UPDATE sessions SET adapter_id = 'hermes' WHERE adapter_id IS NULL;
            CREATE INDEX IF NOT EXISTS idx_sessions_adapter_updated
                ON sessions(adapter_id, updated_at DESC);
            PRAGMA user_version = 5;
            "#,
        )?;
    }

    // v6 (2026-04-23 am): Scheduler — cron-driven prompt runs.
    //
    // Intentionally left empty at v6 post-T6.8 (2026-04-23 pm): the
    // Scheduler MVP created a `scheduler_jobs` table here. T6.8 drops
    // that table at v7 and migrates any pre-T6.8 rows into Hermes's
    // native `~/.hermes/cron/jobs.json` during the v7 bump. We keep
    // the CREATE TABLE for the duration of v6 so users who boot an
    // old Corey build against a v5 DB still get a working schema
    // before T6.8's v7 migration runs.
    if version < 6 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS scheduler_jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cron_expression TEXT NOT NULL,
                prompt TEXT NOT NULL,
                adapter_id TEXT NOT NULL DEFAULT 'hermes',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run_at INTEGER,
                last_run_ok INTEGER,
                last_run_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_enabled
                ON scheduler_jobs(enabled, updated_at DESC);
            PRAGMA user_version = 6;
            "#,
        )?;
    }

    // v7 (2026-04-23 pm · T6.8): Scheduler refactor — wrap Hermes's
    // native cron. The old `scheduler_jobs` table duplicated what
    // Hermes stores in `~/.hermes/cron/jobs.json`. See
    // `docs/10-product-audit-2026-04-23.md` and `hermes_cron.rs`.
    //
    // Migration: if the table has rows AND Hermes's jobs.json does NOT
    // already exist, export the rows to it so users don't lose their
    // schedules. Then drop the table.
    //
    // We deliberately skip the export if jobs.json exists — Hermes
    // may have been managing its own jobs alongside Corey's, and
    // overwriting would delete them.
    if version < 7 {
        migrate_v7_scheduler_to_hermes_json(conn)?;
        conn.execute_batch(
            r#"
            DROP INDEX IF EXISTS idx_scheduler_jobs_enabled;
            DROP TABLE IF EXISTS scheduler_jobs;
            PRAGMA user_version = 7;
            "#,
        )?;
    }

    // v8 (2026-04-23 pm · T6.1): per-message 👍/👎 feedback.
    // Nullable TEXT column; legal values are 'up', 'down', or NULL
    // (unrated). Only assistant messages are rated in the UI, but the
    // column lives on every row so the analytics rollup doesn't need
    // an extra JOIN. Pre-T6.1 rows stay NULL and contribute 0 to the
    // counts.
    if version < 8 {
        conn.execute_batch(
            r#"
            ALTER TABLE messages ADD COLUMN feedback TEXT;
            PRAGMA user_version = 8;
            "#,
        )?;
    }

    Ok(())
}

/// One-shot: read legacy `scheduler_jobs` rows and, if Hermes's
/// `jobs.json` doesn't exist yet, seed it so the user's schedules
/// survive T6.8. Errors during export are LOGGED and swallowed — a
/// missing `~/.hermes/` dir (user hasn't run Hermes yet) is common and
/// shouldn't block Corey's startup.
fn migrate_v7_scheduler_to_hermes_json(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    // Is there anything to migrate?
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduler_jobs'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !table_exists {
        return Ok(());
    }

    // Only export if Hermes's file doesn't exist — never clobber
    // upstream state.
    let jobs_path = match crate::hermes_cron::jobs_path() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "T6.8: could not resolve hermes jobs.json path; skipping migration");
            return Ok(());
        }
    };
    if jobs_path.exists() {
        tracing::info!(
            "T6.8: ~/.hermes/cron/jobs.json already exists; leaving legacy scheduler_jobs untouched"
        );
        return Ok(());
    }

    // Read legacy rows.
    let mut stmt = conn.prepare(
        "SELECT id, name, cron_expression, prompt, enabled, created_at, updated_at
         FROM scheduler_jobs",
    )?;
    let mut rows: Vec<crate::hermes_cron::HermesJob> = Vec::new();
    let iter = stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        let name: String = r.get(1)?;
        let cron_expression: String = r.get(2)?;
        let prompt: String = r.get(3)?;
        let enabled: bool = r.get(4)?;
        let created_at: i64 = r.get(5)?;
        let updated_at: i64 = r.get(6)?;
        Ok(crate::hermes_cron::HermesJob {
            id,
            name: Some(name),
            schedule: cron_expression,
            prompt,
            paused: !enabled,
            corey_created_at: Some(created_at),
            corey_updated_at: Some(updated_at),
            ..crate::hermes_cron::HermesJob::default()
        })
    })?;
    for row in iter {
        match row {
            Ok(j) => rows.push(j),
            Err(e) => {
                tracing::warn!(error = %e, "T6.8: skipping unreadable legacy scheduler row");
            }
        }
    }
    if rows.is_empty() {
        return Ok(());
    }

    match crate::hermes_cron::save_jobs(&rows) {
        Ok(()) => {
            tracing::info!(
                count = rows.len(),
                path = %jobs_path.display(),
                "T6.8: migrated legacy scheduler rows to Hermes jobs.json"
            );
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                path = %jobs_path.display(),
                "T6.8: failed to write Hermes jobs.json; legacy rows remain in SQLite until next boot"
            );
        }
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
    /// T5.5c — which adapter created this session. Drives the unified
    /// inbox's per-row adapter badge + active-adapter filter.
    /// `#[serde(default)]` so pre-T5.5c callers (e.g. an older frontend)
    /// still deserialise; the DB backfills `'hermes'` for rows that
    /// predate the column.
    #[serde(default = "default_adapter_id")]
    pub adapter_id: String,
}

fn default_adapter_id() -> String {
    "hermes".to_string()
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
    /// T6.1 — per-message rating. Legal values: `"up"`, `"down"`, or
    /// `None` (unrated). `#[serde(default)]` lets pre-T6.1 frontend
    /// payloads (and the content-only upserts the streaming code
    /// still emits) deserialise without the field; the upsert path
    /// COALESCEs NULL so missing-in-the-wire never clobbers a real
    /// rating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
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

/// Phase 1 · T1.5 — attachment row. Paired with a message; the staged
/// blob lives on disk at `path`. See `src/attachments.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentRow {
    pub id: String,
    pub message_id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub path: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageWithTools {
    #[serde(flatten)]
    pub msg: MessageRow,
    pub tool_calls: Vec<ToolCallRow>,
    /// Attachments on the user message (and occasionally on assistant
    /// messages if a provider returns files — none do today, but the
    /// schema doesn't forbid it).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AttachmentRow>,
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
    /// T6.1 — lifetime 👍 / 👎 counts across all messages. Pre-T6.1
    /// rows (feedback=NULL) contribute 0 to both.
    pub feedback_up: i64,
    pub feedback_down: i64,
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
    /// T5.6 — session count per adapter. Backfilled rows predating
    /// T5.5c land under `'hermes'` (the v5 migration fills NULL with
    /// 'hermes'). No `LIMIT` here since the adapter space is tiny
    /// (3 today, likely ≤ 6 ever); the UI renders the full list.
    pub adapter_usage: Vec<NamedCount>,
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

        // T6.1 — lifetime feedback counts. Two cheap scans over a column
        // that's NULL for every pre-T6.1 row. Could be done in one query
        // with SUM(CASE WHEN ...) but the two COUNTs are clearer and the
        // cost is negligible even at 100k messages.
        let feedback_up: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE feedback = 'up'",
            [],
            |r| r.get(0),
        )?;
        let feedback_down: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE feedback = 'down'",
            [],
            |r| r.get(0),
        )?;

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

        // T5.6 — sessions grouped by adapter. The COALESCE mirrors
        // `load_all`: any NULL row (shouldn't happen post-v5 backfill
        // but defensive code is cheap) lands under `'hermes'`. No
        // LIMIT: the adapter registry is small and the UI wants the
        // full set.
        let mut astmt = conn.prepare(
            "SELECT COALESCE(NULLIF(adapter_id, ''), 'hermes') AS a, COUNT(*)
             FROM sessions
             GROUP BY a
             ORDER BY COUNT(*) DESC",
        )?;
        let adapter_usage: Vec<NamedCount> = astmt
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
                feedback_up,
                feedback_down,
            },
            messages_per_day,
            tokens_per_day,
            model_usage,
            tool_usage,
            adapter_usage,
            generated_at: now_ms,
        })
    }
}

// ───────────────────────── Runbooks (T4.6) ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunbookRow {
    pub id: String,
    pub name: String,
    /// Short human description. Shown in the palette subtitle + detail view.
    pub description: Option<String>,
    /// Raw template with `{{param}}` placeholders. No server-side rendering;
    /// the frontend substitutes before sending.
    pub template: String,
    /// `None` = global (usable from any profile); otherwise a profile name.
    /// We don't currently filter on this, but keep it so a future "scope"
    /// switch doesn't require a migration.
    pub scope_profile: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Db {
    pub fn list_runbooks(&self) -> rusqlite::Result<Vec<RunbookRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, template, scope_profile, created_at, updated_at
             FROM runbooks
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RunbookRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    template: r.get(3)?,
                    scope_profile: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn upsert_runbook(&self, rb: &RunbookRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO runbooks
               (id, name, description, template, scope_profile, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description,
                 template = excluded.template,
                 scope_profile = excluded.scope_profile,
                 updated_at = excluded.updated_at",
            params![
                rb.id,
                rb.name,
                rb.description,
                rb.template,
                rb.scope_profile,
                rb.created_at,
                rb.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_runbook(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM runbooks WHERE id = ?1", params![id])?;
        Ok(())
    }
}

// ───────────────────────── Budgets (T4.4) ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetRow {
    pub id: String,
    /// One of `"global"`, `"model"`, `"profile"`, `"adapter"`, `"channel"`.
    /// String rather than enum so adding new scopes later doesn't force a
    /// schema change.
    pub scope_kind: String,
    /// Scope identifier (e.g. a model id). Ignored when `scope_kind="global"`.
    pub scope_value: Option<String>,
    /// Budget cap in cents. Tokens → cost is done frontend-side against a
    /// price table; the DB is purely the store.
    pub amount_cents: i64,
    /// `"day"`, `"week"`, `"month"`.
    pub period: String,
    /// `"notify"`, `"block"`, or `"notify_block"`.
    pub action_on_breach: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Db {
    pub fn list_budgets(&self) -> rusqlite::Result<Vec<BudgetRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, scope_kind, scope_value, amount_cents, period,
                    action_on_breach, created_at, updated_at
             FROM budgets
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BudgetRow {
                    id: r.get(0)?,
                    scope_kind: r.get(1)?,
                    scope_value: r.get(2)?,
                    amount_cents: r.get(3)?,
                    period: r.get(4)?,
                    action_on_breach: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn upsert_budget(&self, b: &BudgetRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO budgets
               (id, scope_kind, scope_value, amount_cents, period,
                action_on_breach, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 scope_kind = excluded.scope_kind,
                 scope_value = excluded.scope_value,
                 amount_cents = excluded.amount_cents,
                 period = excluded.period,
                 action_on_breach = excluded.action_on_breach,
                 updated_at = excluded.updated_at",
            params![
                b.id,
                b.scope_kind,
                b.scope_value,
                b.amount_cents,
                b.period,
                b.action_on_breach,
                b.created_at,
                b.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_budget(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM budgets WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Scheduler jobs (2026-04-23 am) — DELETED 2026-04-23 pm (T6.8).
    // Cron is now owned by Hermes; see `src-tauri/src/hermes_cron.rs`
    // for the JSON-backed replacement, and the v7 migration above for
    // the one-time export of legacy rows into `~/.hermes/cron/jobs.json`.
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
            adapter_id: "hermes".into(),
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
            feedback: None,
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

    /// T5.5c — adapter_id round-trips through upsert/load and upserting
    /// an existing session MUST NOT migrate it to a different adapter.
    #[test]
    fn t55c_session_adapter_id_roundtrips_and_is_frozen() {
        let db = Db::open_in_memory().unwrap();

        db.upsert_session(&SessionRow {
            id: "s-hermes".into(),
            title: "t".into(),
            model: None,
            created_at: 100,
            updated_at: 100,
            adapter_id: "hermes".into(),
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s-claude".into(),
            title: "t".into(),
            model: None,
            created_at: 200,
            updated_at: 200,
            adapter_id: "claude_code".into(),
        })
        .unwrap();

        let tree = db.load_all().unwrap();
        assert_eq!(tree.len(), 2);
        let by_id: std::collections::HashMap<&str, &str> = tree
            .iter()
            .map(|s| (s.session.id.as_str(), s.session.adapter_id.as_str()))
            .collect();
        assert_eq!(by_id["s-hermes"], "hermes");
        assert_eq!(by_id["s-claude"], "claude_code");

        // Re-upsert with a DIFFERENT adapter id — the COALESCE in the
        // ON CONFLICT branch must preserve the original (adapter is
        // frozen at creation; sessions don't migrate).
        db.upsert_session(&SessionRow {
            id: "s-hermes".into(),
            title: "t2".into(),
            model: None,
            created_at: 100,
            updated_at: 500,
            adapter_id: "aider".into(), // attempted hijack — should be ignored
        })
        .unwrap();
        let tree = db.load_all().unwrap();
        let hermes_row = tree.iter().find(|s| s.session.id == "s-hermes").unwrap();
        assert_eq!(
            hermes_row.session.adapter_id, "hermes",
            "adapter_id must not migrate across upserts"
        );
        assert_eq!(hermes_row.session.title, "t2", "other fields DO update");
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
            feedback: None,
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

    /// T5.6 — adapter_usage aggregation. Three sessions split across
    /// two adapters; the summary must reflect the counts with the
    /// larger bucket first (matches ORDER BY COUNT DESC).
    #[test]
    fn t56_analytics_adapter_usage_groups_by_adapter_id() {
        let db = Db::open_in_memory().unwrap();
        for (i, adapter) in ["hermes", "hermes", "claude_code"].iter().enumerate() {
            db.upsert_session(&SessionRow {
                id: format!("s{i}"),
                title: "t".into(),
                model: None,
                created_at: (i as i64) * 1_000,
                updated_at: (i as i64) * 1_000,
                adapter_id: (*adapter).into(),
            })
            .unwrap();
        }
        let summary = db.analytics_summary(10_000).unwrap();
        let by_name: Vec<(&str, i64)> = summary
            .adapter_usage
            .iter()
            .map(|c| (c.name.as_str(), c.count))
            .collect();
        assert_eq!(by_name, vec![("hermes", 2), ("claude_code", 1)]);
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
            adapter_id: "hermes".into(),
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s2".into(),
            title: "t".into(),
            model: None,
            created_at: 2_000,
            updated_at: 2_000,
            adapter_id: "hermes".into(),
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
            feedback: None,
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
            feedback: None,
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
            feedback: None,
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
            feedback: None,
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

    // ──── T4.6 Runbooks ────

    #[test]
    fn runbook_upsert_list_delete_round_trip() {
        let db = Db::open_in_memory().unwrap();
        let rb = RunbookRow {
            id: "rb1".into(),
            name: "daily-standup".into(),
            description: Some("Daily standup summary".into()),
            template: "Summarize: {{bullets}}".into(),
            scope_profile: None,
            created_at: 100,
            updated_at: 100,
        };
        db.upsert_runbook(&rb).unwrap();

        // Upsert a second runbook — list comes back MRU-first.
        let rb2 = RunbookRow {
            id: "rb2".into(),
            name: "pr-review".into(),
            description: None,
            template: "Review: {{diff}}".into(),
            scope_profile: Some("work".into()),
            created_at: 200,
            updated_at: 200,
        };
        db.upsert_runbook(&rb2).unwrap();
        let rows = db.list_runbooks().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "rb2");
        assert_eq!(rows[1].id, "rb1");

        // Update rb1 → should bubble to the top.
        db.upsert_runbook(&RunbookRow {
            updated_at: 300,
            name: "daily-standup-v2".into(),
            ..rb.clone()
        })
        .unwrap();
        let rows = db.list_runbooks().unwrap();
        assert_eq!(rows[0].id, "rb1");
        assert_eq!(rows[0].name, "daily-standup-v2");

        // Delete.
        db.delete_runbook("rb1").unwrap();
        let rows = db.list_runbooks().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "rb2");
    }

    #[test]
    fn runbook_name_uniqueness_rejects_duplicates() {
        let db = Db::open_in_memory().unwrap();
        let rb = RunbookRow {
            id: "rb1".into(),
            name: "dup".into(),
            description: None,
            template: "a".into(),
            scope_profile: None,
            created_at: 1,
            updated_at: 1,
        };
        db.upsert_runbook(&rb).unwrap();

        // Same name, different id → UNIQUE constraint fails.
        let err = db.upsert_runbook(&RunbookRow {
            id: "rb2".into(),
            ..rb
        });
        assert!(err.is_err());
    }

    // ──── T4.4 Budgets ────

    #[test]
    fn budget_upsert_list_delete_round_trip() {
        let db = Db::open_in_memory().unwrap();
        let b = BudgetRow {
            id: "b1".into(),
            scope_kind: "global".into(),
            scope_value: None,
            amount_cents: 500,
            period: "day".into(),
            action_on_breach: "notify".into(),
            created_at: 10,
            updated_at: 10,
        };
        db.upsert_budget(&b).unwrap();

        let b2 = BudgetRow {
            id: "b2".into(),
            scope_kind: "model".into(),
            scope_value: Some("gpt-4o".into()),
            amount_cents: 2000,
            period: "month".into(),
            action_on_breach: "notify_block".into(),
            created_at: 20,
            updated_at: 20,
        };
        db.upsert_budget(&b2).unwrap();

        let rows = db.list_budgets().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "b2");

        // Update the amount → upsert returns the new value.
        db.upsert_budget(&BudgetRow {
            amount_cents: 3000,
            updated_at: 30,
            ..b2.clone()
        })
        .unwrap();
        let rows = db.list_budgets().unwrap();
        assert_eq!(rows[0].amount_cents, 3000);

        db.delete_budget("b1").unwrap();
        db.delete_budget("b2").unwrap();
        assert!(db.list_budgets().unwrap().is_empty());
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
            feedback: None,
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

    // ──── T6.1 feedback ────

    fn sample_msg(id: &str, ts: i64) -> MessageRow {
        MessageRow {
            id: id.into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "hi".into(),
            error: None,
            position: 0,
            created_at: ts,
            prompt_tokens: None,
            completion_tokens: None,
            feedback: None,
        }
    }

    /// `set_message_feedback` round-trips 'up'/'down'/NULL and rejects
    /// garbage so the analytics rollup never has to filter bad rows.
    #[test]
    fn t61_set_message_feedback_accepts_up_down_null_and_rejects_other() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        db.upsert_message(&sample_msg("m1", 110)).unwrap();

        // Stamp up.
        db.set_message_feedback("m1", Some("up")).unwrap();
        let tree = db.load_all().unwrap();
        assert_eq!(tree[0].messages[0].msg.feedback.as_deref(), Some("up"));

        // Switch to down.
        db.set_message_feedback("m1", Some("down")).unwrap();
        let tree = db.load_all().unwrap();
        assert_eq!(tree[0].messages[0].msg.feedback.as_deref(), Some("down"));

        // Clear.
        db.set_message_feedback("m1", None).unwrap();
        let tree = db.load_all().unwrap();
        assert!(tree[0].messages[0].msg.feedback.is_none());

        // Garbage value is rejected.
        assert!(db.set_message_feedback("m1", Some("meh")).is_err());
    }

    /// Content-only upserts (the streaming code path) pass feedback=None.
    /// The COALESCE in ON CONFLICT must preserve the rating set by a
    /// prior `set_message_feedback` call.
    #[test]
    fn t61_upsert_message_preserves_feedback_across_content_updates() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        db.upsert_message(&sample_msg("m1", 110)).unwrap();
        db.set_message_feedback("m1", Some("up")).unwrap();

        // Simulate a subsequent content-only upsert (as if the user
        // re-opened the session and zustand flushed a patch).
        db.upsert_message(&MessageRow {
            content: "revised content".into(),
            ..sample_msg("m1", 110)
        })
        .unwrap();

        let tree = db.load_all().unwrap();
        let m = &tree[0].messages[0].msg;
        assert_eq!(m.content, "revised content");
        assert_eq!(
            m.feedback.as_deref(),
            Some("up"),
            "content-only upsert must not wipe the rating"
        );
    }

    /// Analytics rollup reports the 👍/👎 counts; NULL rows contribute 0.
    #[test]
    fn t61_analytics_summary_counts_feedback() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        for (i, fb) in ["up", "up", "down", ""].iter().enumerate() {
            let mut m = sample_msg(&format!("m{i}"), 100 + i as i64);
            m.position = i as i64;
            db.upsert_message(&m).unwrap();
            if !fb.is_empty() {
                db.set_message_feedback(&m.id, Some(fb)).unwrap();
            }
        }
        let s = db.analytics_summary(1_000).unwrap();
        assert_eq!(s.totals.feedback_up, 2);
        assert_eq!(s.totals.feedback_down, 1);
    }
}
