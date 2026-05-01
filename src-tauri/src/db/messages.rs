//! Messages, tool calls, attachments, and TF-IDF embeddings.
//!
//! All of these are message-shaped — they hang off a `messages` row via
//! a foreign key — so they share a module to keep the related upserts
//! and ON CONFLICT semantics in one place.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Db;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_token_latency_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_latency_ms: Option<i64>,
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

impl Db {
    pub fn upsert_message(&self, m: &MessageRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO messages
               (id, session_id, role, content, error, position, created_at,
                prompt_tokens, completion_tokens, feedback,
                first_token_latency_ms, total_latency_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                 role = excluded.role,
                 content = excluded.content,
                 error = excluded.error,
                 position = excluded.position,
                 prompt_tokens = COALESCE(excluded.prompt_tokens, prompt_tokens),
                 completion_tokens = COALESCE(excluded.completion_tokens, completion_tokens),
                 feedback = COALESCE(excluded.feedback, feedback),
                 first_token_latency_ms = COALESCE(excluded.first_token_latency_ms, first_token_latency_ms),
                 total_latency_ms = COALESCE(excluded.total_latency_ms, total_latency_ms)",
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
                m.first_token_latency_ms,
                m.total_latency_ms,
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

    // ─── TF-IDF embeddings (Phase E · P2) ────────────────────────────

    pub fn upsert_embedding(&self, message_id: &str, vector_json: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO embeddings (message_id, vector, created_at)
             VALUES (?1, ?2, unixepoch())
             ON CONFLICT(message_id) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at",
            params![message_id, vector_json],
        )?;
        Ok(())
    }

    pub fn sample_message_contents(&self, limit: usize) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT content FROM messages WHERE role = 'user' AND content != ''
             ORDER BY RANDOM() LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| row.get(0))?;
        rows.collect()
    }

    pub fn search_similar_messages(
        &self,
        query_vector_json: &str,
        limit: usize,
    ) -> rusqlite::Result<Vec<(String, String, String)>> {
        let query_vec = crate::tfidf::TfidfVector::from_json(query_vector_json);
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT e.message_id, e.vector, m.content
             FROM embeddings e
             JOIN messages m ON m.id = e.message_id
             WHERE m.content != ''
             ORDER BY e.created_at DESC
             LIMIT 500",
        )?;
        let rows = stmt.query_map([], |row| {
            let msg_id: String = row.get(0)?;
            let vec_json: String = row.get(1)?;
            let content: String = row.get(2)?;
            Ok((msg_id, vec_json, content))
        })?;

        let mut scored: Vec<(f64, String, String)> = rows
            .filter_map(|r| r.ok())
            .map(|(msg_id, vec_json, content)| {
                let vec = crate::tfidf::TfidfVector::from_json(&vec_json);
                let sim = query_vec.cosine_similarity(&vec);
                (sim, msg_id, content)
            })
            .filter(|(sim, _, _)| *sim > 0.15)
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        Ok(scored
            .into_iter()
            .map(|(_, msg_id, content)| (msg_id, content, format!("{:.2}", 0.0)))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sessions::SessionRow;

    fn sample_session(id: &str, ts: i64) -> SessionRow {
        SessionRow {
            id: id.into(),
            title: "t".into(),
            model: None,
            created_at: ts,
            updated_at: ts,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        }
    }

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
            first_token_latency_ms: None,
            total_latency_ms: None,
        }
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
            first_token_latency_ms: None,
            total_latency_ms: None,
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
            feedback: None,
            first_token_latency_ms: None,
            total_latency_ms: None,
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
        let s = db.analytics_summary(200, None).unwrap();
        assert_eq!(s.totals.prompt_tokens, 42);
        assert_eq!(s.totals.completion_tokens, 7);
        assert_eq!(s.totals.total_tokens, 49);
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
}
