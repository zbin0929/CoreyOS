//! SQLite-backed persistence for Caduceus state.
//!
//! Originally a single 2k-line `db.rs`; as the schema grew past 11
//! versions and picked up analytics / runbooks / budgets / skill
//! history / knowledge base, the file became hard to navigate. This
//! module splits the implementation by domain while keeping `Db` as a
//! single struct (it still owns one locked `Connection`), so every
//! existing `crate::db::Db` / `crate::db::RunbookRow` / etc. import
//! continues to resolve without churn at call sites.
//!
//! Schema is intentionally minimal — all writes go through this module;
//! the frontend calls IPC on every mutation so the DB is always
//! authoritative. See [`sessions::Db::load_all`] for the single-trip
//! hydration path used at app startup.

use std::path::{Path, PathBuf};

use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;

mod analytics;
mod budgets;
mod knowledge;
mod messages;
mod migrations;
mod runbooks;
mod sessions;
mod skills_history;
mod workflows;

// Public surface — every name listed here was also a direct child of
// `crate::db::` before the split, so existing imports resolve verbatim.
// The `allow(unused_imports)` on the helper types (AnalyticsTotals,
// DayCount, NamedCount, MessageWithTools) preserves the pre-split
// public surface even though current callers only reference the
// wrapping types (AnalyticsSummary, SessionWithMessages).
#[allow(unused_imports)]
pub use analytics::{
    AnalyticsSummary, AnalyticsTotals, CostBreakdown, DayCost, DayCount, ModelCost, NamedCount,
};
pub use budgets::BudgetRow;
pub use messages::{AttachmentRow, MessageRow, ToolCallRow};
pub use runbooks::RunbookRow;
#[allow(unused_imports)]
pub use sessions::{MessageWithTools, SessionRow, SessionWithMessages};
pub use skills_history::{SkillVersion, SkillVersionSummary};
pub use workflows::WorkflowRunSummary;

pub struct Db {
    // Visible to every submodule in this crate::db tree so each
    // domain can do `self.conn.lock()` without going through a
    // helper; still private to outside callers.
    pub(in crate::db) conn: Mutex<Connection>,
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
        migrations::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory DB for unit tests. Migrations still run.
    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Escape hatch for code that needs raw connection access — currently
    /// only the embedding/RAG IPC paths that run custom SQL outside the
    /// typed DTO surface. Holds the connection `Mutex` for the returned
    /// guard's lifetime, so don't keep it around across `.await` points.
    pub fn conn_raw(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock()
    }
}

/// Resolve the on-disk DB path (`<app_data_dir>/caduceus.db`). Must be
/// resolved inside Tauri's `setup()` hook because `app.path().app_data_dir()`
/// isn't available earlier.
pub fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("caduceus.db")
}
