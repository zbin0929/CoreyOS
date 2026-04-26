//! T4.6 Runbooks — reusable prompt templates with `{{param}}` placeholders.
//!
//! `name` is UNIQUE so the palette subtitle is unambiguous; rendering is
//! done frontend-side at call time (there's no server-side template
//! engine — keeps the DB surface small).

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Db;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
