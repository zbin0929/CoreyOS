//! Sessions and the bulk-hydration tree (`load_all`).
//!
//! Sessions are the spine — every message, tool call, and attachment
//! hangs off them via cascading FKs. `load_all` returns the full tree
//! in one trip for app-startup hydration.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::messages::{AttachmentRow, MessageRow, ToolCallRow};
use super::Db;

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
    /// v10 — optional LLM-Profile pin. When `Some(id)`, chat sends for
    /// this session route through the `hermes:profile:<id>` adapter
    /// instead of whatever the user has globally selected. Independent
    /// of `adapter_id` (sidebar grouping) so picking a profile in the
    /// chat model picker doesn't migrate the session to another agent.
    #[serde(default)]
    pub llm_profile_id: Option<String>,
    #[serde(default)]
    pub gateway_source: Option<String>,
}

fn default_adapter_id() -> String {
    "hermes".to_string()
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

impl Db {
    pub fn upsert_session(&self, s: &SessionRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sessions (id, title, model, created_at, updated_at, adapter_id, llm_profile_id, gateway_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 model = excluded.model,
                 updated_at = excluded.updated_at,
                 adapter_id = COALESCE(sessions.adapter_id, excluded.adapter_id),
                 llm_profile_id = excluded.llm_profile_id,
                 gateway_source = COALESCE(sessions.gateway_source, excluded.gateway_source)",
            params![
                s.id,
                s.title,
                s.model,
                s.created_at,
                s.updated_at,
                s.adapter_id,
                s.llm_profile_id,
                s.gateway_source,
            ],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

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
                    COALESCE(adapter_id, 'hermes'), llm_profile_id, gateway_source
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
                    llm_profile_id: row.get(6)?,
                    gateway_source: row.get(7)?,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{MessageRow, ToolCallRow};

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
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s-claude".into(),
            title: "t".into(),
            model: None,
            created_at: 200,
            updated_at: 200,
            adapter_id: "claude_code".into(),
            llm_profile_id: None,
            gateway_source: None,
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
            llm_profile_id: None,
            gateway_source: None,
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

    /// v10 — llm_profile_id round-trips AND is mutable (unlike
    /// adapter_id). Covers the three flip paths the UI exercises:
    ///   None  → Some (user picks a profile in the chat picker)
    ///   Some → Some (user picks a different profile)
    ///   Some → None (user clears the profile by picking a gateway model)
    #[test]
    fn v10_llm_profile_id_roundtrips_and_is_mutable() {
        let db = Db::open_in_memory().unwrap();
        // Initial insert with no profile.
        db.upsert_session(&SessionRow {
            id: "s".into(),
            title: "t".into(),
            model: None,
            created_at: 1,
            updated_at: 1,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        let row = db.load_all().unwrap().into_iter().next().unwrap().session;
        assert_eq!(row.llm_profile_id, None);

        // Flip to a profile.
        db.upsert_session(&SessionRow {
            id: "s".into(),
            title: "t".into(),
            model: None,
            created_at: 1,
            updated_at: 2,
            adapter_id: "hermes".into(),
            llm_profile_id: Some("glm".into()),
            gateway_source: None,
        })
        .unwrap();
        assert_eq!(
            db.load_all().unwrap()[0].session.llm_profile_id.as_deref(),
            Some("glm")
        );

        // Replace with a different profile.
        db.upsert_session(&SessionRow {
            id: "s".into(),
            title: "t".into(),
            model: None,
            created_at: 1,
            updated_at: 3,
            adapter_id: "hermes".into(),
            llm_profile_id: Some("deepseek".into()),
            gateway_source: None,
        })
        .unwrap();
        assert_eq!(
            db.load_all().unwrap()[0].session.llm_profile_id.as_deref(),
            Some("deepseek")
        );

        // Clear back to None.
        db.upsert_session(&SessionRow {
            id: "s".into(),
            title: "t".into(),
            model: None,
            created_at: 1,
            updated_at: 4,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        assert_eq!(db.load_all().unwrap()[0].session.llm_profile_id, None);
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

    #[test]
    fn v13_gateway_source_roundtrips_and_is_frozen() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&SessionRow {
            id: "s-gw".into(),
            title: "QQ对话".into(),
            model: None,
            created_at: 100,
            updated_at: 100,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: Some("qqbot".into()),
        })
        .unwrap();
        let row = db.load_all().unwrap().into_iter().next().unwrap().session;
        assert_eq!(row.gateway_source.as_deref(), Some("qqbot"));

        db.upsert_session(&SessionRow {
            id: "s-gw".into(),
            title: "QQ对话 v2".into(),
            model: None,
            created_at: 100,
            updated_at: 200,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        let row = db.load_all().unwrap().into_iter().next().unwrap().session;
        assert_eq!(row.title, "QQ对话 v2");
        assert_eq!(
            row.gateway_source.as_deref(),
            Some("qqbot"),
            "gateway_source must be frozen at creation (COALESCE preserves it)"
        );
    }
}
