//! T4.4 Budgets — cost caps per scope (global / model / profile / adapter / channel).
//!
//! `scope_kind` is a TEXT column rather than a Rust enum so adding a new
//! scope later doesn't require a schema change. Tokens → cost conversion
//! happens frontend-side against a price table; this module is purely storage.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Db;

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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
