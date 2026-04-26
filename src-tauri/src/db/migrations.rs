//! Schema versioning for `caduceus.db`.
//!
//! Each migration is a guarded `if version < N { ... }` block, applied
//! in order. New columns are nullable so legacy rows survive without a
//! data backfill where possible; the v5 / v10 sweepers are the only
//! ones that mutate existing data.
//!
//! v7 also re-homes the legacy `scheduler_jobs` table into Hermes' own
//! `~/.hermes/cron/jobs.json` (T6.8) so users don't lose schedules
//! across the upstream-alignment refactor.

use rusqlite::{Connection, OptionalExtension};

pub(super) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
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

    // v9 — Skill version history (T-polish). Every `skills::save` snapshots
    // the PRIOR body into this table before overwriting the file, so a
    // user who deletes an important paragraph can restore it later. Keyed
    // on the posix skill path (`<group>/<name>.md`) to match the id the
    // frontend already uses for get/save/delete. Retention is capped in
    // the Rust layer (keep last 50 per path) rather than in a trigger —
    // keeps the schema transparent + easy to inspect manually.
    if version < 9 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS skill_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                body TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_skill_versions_path_created
                ON skill_versions(path, created_at DESC);
            PRAGMA user_version = 9;
            "#,
        )?;
    }

    // v10 — per-session LLM Profile pin. Nullable TEXT: when set, the
    // chat send layer routes this session's turns through the
    // `hermes:profile:<value>` adapter registered at boot. Decoupled
    // from `adapter_id` (which continues to name the session's owning
    // agent for the sidebar grouping) so picking a profile in the
    // model picker no longer migrates the session across agents.
    //
    // Also heal any pre-v10 row that was (incorrectly) moved across
    // agents by an earlier build of the picker — such rows have
    // `adapter_id` like `hermes:profile:<id>`. We move the suffix
    // into the new `llm_profile_id` column and reset `adapter_id`
    // back to `hermes` so the sidebar grouping is restored.
    if version < 10 {
        conn.execute_batch(
            r#"
            ALTER TABLE sessions ADD COLUMN llm_profile_id TEXT;
            UPDATE sessions
               SET llm_profile_id = substr(adapter_id, length('hermes:profile:') + 1),
                   adapter_id     = 'hermes'
             WHERE adapter_id LIKE 'hermes:profile:%';
            PRAGMA user_version = 10;
            "#,
        )?;
    }

    // v11 (Phase E · P2) — TF-IDF embeddings for semantic search.
    // Stores sparse TF-IDF vectors as JSON for each user message.
    // Enables "find similar historical messages" without external
    // embedding models.
    if version < 11 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS embeddings (
                message_id TEXT PRIMARY KEY,
                vector TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_embeddings_created
                ON embeddings(created_at DESC);
            PRAGMA user_version = 11;
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
fn migrate_v7_scheduler_to_hermes_json(conn: &Connection) -> rusqlite::Result<()> {
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
