//! v9 — Skill version history (T-polish).
//!
//! Every `skills::save` snapshots the PRIOR body into this table before
//! overwriting the file, so a user who deletes an important paragraph can
//! restore it later. Retention is capped at 50 per path in the Rust layer
//! (rather than in a trigger) so the schema stays transparent and easy to
//! inspect manually.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Db;

/// Metadata row for the version-list UI. We deliberately don't carry
/// the body here — it's only fetched when the user clicks "Restore" /
/// "Preview" on a specific version (see `get_skill_version`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillVersionSummary {
    pub id: i64,
    pub size: i64,
    pub created_at: i64,
}

/// Full version row including the snapshotted body. Returned by
/// `skill_version_get`; used on restore and preview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillVersion {
    pub id: i64,
    pub path: String,
    pub body: String,
    pub size: i64,
    pub created_at: i64,
}

impl Db {
    pub fn snapshot_skill_version(
        &self,
        path: &str,
        body: &str,
        created_at: i64,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO skill_versions (path, body, size, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![path, body, body.len() as i64, created_at],
        )?;
        // Evict beyond 50 per path. DELETE subselect avoids a full
        // table scan when the index on (path, created_at DESC) is hit.
        conn.execute(
            "DELETE FROM skill_versions
             WHERE path = ?1
               AND id NOT IN (
                   SELECT id FROM skill_versions
                   WHERE path = ?1
                   ORDER BY created_at DESC
                   LIMIT 50
               )",
            params![path],
        )?;
        Ok(())
    }

    pub fn list_skill_versions(&self, path: &str) -> rusqlite::Result<Vec<SkillVersionSummary>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, size, created_at
             FROM skill_versions
             WHERE path = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![path], |r| {
                Ok(SkillVersionSummary {
                    id: r.get(0)?,
                    size: r.get(1)?,
                    created_at: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_skill_version(&self, id: i64) -> rusqlite::Result<Option<SkillVersion>> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT id, path, body, size, created_at FROM skill_versions WHERE id = ?1",
                params![id],
                |r| {
                    Ok(SkillVersion {
                        id: r.get(0)?,
                        path: r.get(1)?,
                        body: r.get(2)?,
                        size: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// v9 — skill version history: snapshots retain, retention caps, and
    /// get-by-id round-trips the body verbatim.
    #[test]
    fn v9_skill_versions_snapshot_list_get_and_cap_retention() {
        let db = Db::open_in_memory().unwrap();
        // Empty before any snapshot.
        assert!(db.list_skill_versions("x.md").unwrap().is_empty());

        // 55 snapshots for one path, with strictly increasing timestamps
        // so the DESC ordering is unambiguous.
        for i in 0..55 {
            db.snapshot_skill_version("x.md", &format!("body-{i}"), 1000 + i)
                .unwrap();
        }
        // Second path isolates correctly.
        db.snapshot_skill_version("other.md", "o1", 10).unwrap();

        let list = db.list_skill_versions("x.md").unwrap();
        // Retention caps at 50 — first 5 should have been evicted.
        assert_eq!(list.len(), 50);
        // Newest first: created_at=1054 for the i=54 snapshot.
        assert_eq!(list[0].created_at, 1054);
        // Oldest surviving is i=5 (created_at=1005).
        assert_eq!(list.last().unwrap().created_at, 1005);

        // Other path unaffected by the cap on `x.md`.
        assert_eq!(db.list_skill_versions("other.md").unwrap().len(), 1);

        // Round-trip body by id.
        let newest_id = list[0].id;
        let row = db.get_skill_version(newest_id).unwrap().unwrap();
        assert_eq!(row.path, "x.md");
        assert_eq!(row.body, "body-54");
        assert_eq!(row.size, "body-54".len() as i64);

        // Missing id returns None, not Err.
        assert!(db.get_skill_version(9_999_999).unwrap().is_none());
    }
}
