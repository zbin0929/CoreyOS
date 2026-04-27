//! Workflow run persistence (v12).
//!
//! Mirrors `state.workflow_runs` (the in-memory `HashMap`) onto SQLite
//! so paused approvals, audit logs, and step-by-step history survive a
//! Corey restart. Without this, the workflow primitive's "audit + human
//! approval + strict step order" pitch is undermined by the fact that
//! one accidental quit nukes everything.
//!
//! Write strategy: **idempotent full-run upsert**. `upsert_run` writes
//! the run header AND every step row in a single transaction. Callers
//! invoke it at every state-transition boundary (run start, after each
//! `execute_with_executor` return, after `workflow_approve`). This is
//! O(steps_per_workflow) per call — single-digit dozens at most — so
//! overhead is negligible compared to a chat completion.
//!
//! Rehydrate strategy: on boot, `load_active_runs` returns runs whose
//! status is `pending` / `running` / `paused`. Terminal runs
//! (`completed` / `failed` / `cancelled`) are NOT rehydrated — they
//! stay queryable via `list_history` but don't pin engine memory or
//! re-trigger any executor logic. This matches the chat sidebar's
//! "active sessions vs. archive" model.

use rusqlite::{params, OptionalExtension};

use super::Db;
use crate::workflow::engine::{RunStatus, StepRun, StepRunStatus, WorkflowRun};

/// Wire-shape for the History list. Drop-in serializable; no engine
/// types (so the frontend doesn't need to import `WorkflowRun` just to
/// render a row in a table).
#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkflowRunSummary {
    pub id: String,
    pub workflow_id: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
    /// Total steps for this run (regardless of status). Saves an extra
    /// query when the History page wants to show "5/6 completed".
    pub step_count: u32,
    pub completed_count: u32,
    pub failed_count: u32,
}

impl Db {
    /// Upsert a run + all its step rows in one transaction. Safe to
    /// call repeatedly with the same run — every call replaces the
    /// step rows wholesale (we DELETE-then-INSERT inside the txn so
    /// step removals from the def show up). Run header uses
    /// ON CONFLICT to preserve `started_at` from the original insert.
    pub fn upsert_workflow_run(&self, run: &WorkflowRun) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock();
        let txn = conn.transaction()?;

        let status = serde_json::to_value(&run.status)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown".into());
        let inputs_json = serde_json::to_string(&run.inputs).unwrap_or_else(|_| "null".to_string());

        txn.execute(
            "INSERT INTO workflow_runs
               (id, workflow_id, status, inputs, error, started_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 status     = excluded.status,
                 inputs     = excluded.inputs,
                 error      = excluded.error,
                 updated_at = excluded.updated_at",
            params![
                run.id,
                run.workflow_id,
                status,
                inputs_json,
                run.error,
                run.started_at_ms,
                run.updated_at_ms,
            ],
        )?;

        // Wholesale replace step rows. Cheaper than diffing — we never
        // have more than ~dozens of steps per run, and the parent
        // run's `updated_at` already pins MRU ordering, so blowing
        // these away each upsert is safe.
        txn.execute(
            "DELETE FROM workflow_step_runs WHERE run_id = ?1",
            params![run.id],
        )?;

        for (step_id, sr) in &run.step_runs {
            let step_status = serde_json::to_value(&sr.status)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown".into());
            let output_json = sr
                .output
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".to_string()));
            txn.execute(
                "INSERT INTO workflow_step_runs
                   (run_id, step_id, status, output, error, duration_ms, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    run.id,
                    step_id,
                    step_status,
                    output_json,
                    sr.error,
                    sr.duration_ms.map(|d| d as i64),
                    run.updated_at_ms,
                ],
            )?;
        }

        txn.commit()?;
        Ok(())
    }

    /// Reload non-terminal runs into `(id, run)` pairs. The caller
    /// (`lib.rs` setup) inserts these into `state.workflow_runs` so a
    /// paused approval keeps its IPC handles after a restart.
    ///
    /// Terminal runs are EXCLUDED — they're history; the History page
    /// queries them on demand via `list_workflow_history`.
    pub fn load_active_workflow_runs(&self) -> rusqlite::Result<Vec<WorkflowRun>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, workflow_id, status, inputs, error, started_at, updated_at
             FROM workflow_runs
             WHERE status IN ('pending', 'running', 'paused')",
        )?;
        let mut runs: Vec<WorkflowRun> = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                let workflow_id: String = r.get(1)?;
                let status_str: String = r.get(2)?;
                let inputs_str: String = r.get(3)?;
                let error: Option<String> = r.get(4)?;
                let started_at_ms: i64 = r.get(5)?;
                let updated_at_ms: i64 = r.get(6)?;
                let status: RunStatus =
                    serde_json::from_value(serde_json::Value::String(status_str))
                        .unwrap_or(RunStatus::Pending);
                let inputs: serde_json::Value =
                    serde_json::from_str(&inputs_str).unwrap_or(serde_json::Value::Null);
                Ok(WorkflowRun {
                    id,
                    workflow_id,
                    status,
                    inputs,
                    step_runs: std::collections::HashMap::new(),
                    error,
                    started_at_ms,
                    updated_at_ms,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        // Hydrate step rows in a second pass so we can use a prepared
        // statement reused across runs.
        let mut step_stmt = conn.prepare(
            "SELECT step_id, status, output, error, duration_ms
             FROM workflow_step_runs
             WHERE run_id = ?1",
        )?;
        for run in &mut runs {
            let mut rows = step_stmt.query(params![run.id])?;
            while let Some(row) = rows.next()? {
                let step_id: String = row.get(0)?;
                let status_str: String = row.get(1)?;
                let output_str: Option<String> = row.get(2)?;
                let error: Option<String> = row.get(3)?;
                let duration_ms: Option<i64> = row.get(4)?;

                let status: StepRunStatus =
                    serde_json::from_value(serde_json::Value::String(status_str))
                        .unwrap_or(StepRunStatus::Pending);
                let output: Option<serde_json::Value> =
                    output_str.and_then(|s| serde_json::from_str(&s).ok());
                run.step_runs.insert(
                    step_id.clone(),
                    StepRun {
                        step_id,
                        status,
                        output,
                        error,
                        duration_ms: duration_ms.map(|d| d as u64),
                    },
                );
            }
        }
        Ok(runs)
    }

    /// History list (terminal + active mixed, MRU first). `limit`
    /// caps the result so an audit-heavy user doesn't blow render
    /// time. Filter by `workflow_id` is optional — `None` returns
    /// all workflows' runs interleaved by recency.
    pub fn list_workflow_history(
        &self,
        workflow_id: Option<&str>,
        limit: u32,
    ) -> rusqlite::Result<Vec<WorkflowRunSummary>> {
        let conn = self.conn.lock();
        let limit = limit.clamp(1, 1000);

        // Two query shapes (with vs. without filter) to keep params
        // typed; rusqlite isn't great with optional WHERE fragments.
        // The intermediate `let summaries = ...;` binding (rather than
        // returning the collect() expression directly out of the
        // if/else block) is required because `query_map` returns a
        // `MappedRows` iterator that borrows from `stmt`. Without the
        // binding, the iterator's destructor outlives `stmt`'s drop
        // at the block's `}` and rustc rejects with E0597.
        let summaries: Vec<WorkflowRunSummary> = if let Some(wf) = workflow_id {
            let mut stmt = conn.prepare(
                "SELECT id, workflow_id, status, error, started_at, updated_at
                 FROM workflow_runs
                 WHERE workflow_id = ?1
                 ORDER BY started_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![wf, limit as i64], |r| {
                    Ok(WorkflowRunSummary {
                        id: r.get(0)?,
                        workflow_id: r.get(1)?,
                        status: r.get(2)?,
                        error: r.get(3)?,
                        started_at: r.get(4)?,
                        updated_at: r.get(5)?,
                        step_count: 0,
                        completed_count: 0,
                        failed_count: 0,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, workflow_id, status, error, started_at, updated_at
                 FROM workflow_runs
                 ORDER BY started_at DESC
                 LIMIT ?1",
            )?;
            let rows = stmt
                .query_map(params![limit as i64], |r| {
                    Ok(WorkflowRunSummary {
                        id: r.get(0)?,
                        workflow_id: r.get(1)?,
                        status: r.get(2)?,
                        error: r.get(3)?,
                        started_at: r.get(4)?,
                        updated_at: r.get(5)?,
                        step_count: 0,
                        completed_count: 0,
                        failed_count: 0,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // Per-run step counts in a second pass. SQLite handles ~thousands
        // of these in single-digit ms; not worth a more clever query.
        let mut count_stmt = conn.prepare(
            "SELECT
                 COUNT(*),
                 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
             FROM workflow_step_runs
             WHERE run_id = ?1",
        )?;
        let mut out = summaries;
        for s in &mut out {
            let row = count_stmt
                .query_row(params![s.id], |r| {
                    let total: u32 = r.get::<_, i64>(0)? as u32;
                    let completed: i64 = r.get::<_, Option<i64>>(1)?.unwrap_or(0);
                    let failed: i64 = r.get::<_, Option<i64>>(2)?.unwrap_or(0);
                    Ok((total, completed as u32, failed as u32))
                })
                .optional()?;
            if let Some((total, c, f)) = row {
                s.step_count = total;
                s.completed_count = c;
                s.failed_count = f;
            }
        }
        Ok(out)
    }

    /// Fetch one full run (header + steps) — used by a "view past run"
    /// affordance. Returns `Ok(None)` if the run id doesn't exist.
    pub fn get_workflow_run(&self, run_id: &str) -> rusqlite::Result<Option<WorkflowRun>> {
        let conn = self.conn.lock();
        let header = conn
            .query_row(
                "SELECT id, workflow_id, status, inputs, error, started_at, updated_at
                 FROM workflow_runs
                 WHERE id = ?1",
                params![run_id],
                |r| {
                    let id: String = r.get(0)?;
                    let workflow_id: String = r.get(1)?;
                    let status_str: String = r.get(2)?;
                    let inputs_str: String = r.get(3)?;
                    let error: Option<String> = r.get(4)?;
                    let started_at_ms: i64 = r.get(5)?;
                    let updated_at_ms: i64 = r.get(6)?;
                    let status: RunStatus =
                        serde_json::from_value(serde_json::Value::String(status_str))
                            .unwrap_or(RunStatus::Pending);
                    let inputs: serde_json::Value =
                        serde_json::from_str(&inputs_str).unwrap_or(serde_json::Value::Null);
                    Ok(WorkflowRun {
                        id,
                        workflow_id,
                        status,
                        inputs,
                        step_runs: std::collections::HashMap::new(),
                        error,
                        started_at_ms,
                        updated_at_ms,
                    })
                },
            )
            .optional()?;
        let Some(mut run) = header else {
            return Ok(None);
        };

        let mut stmt = conn.prepare(
            "SELECT step_id, status, output, error, duration_ms
             FROM workflow_step_runs
             WHERE run_id = ?1",
        )?;
        let mut rows = stmt.query(params![run_id])?;
        while let Some(row) = rows.next()? {
            let step_id: String = row.get(0)?;
            let status_str: String = row.get(1)?;
            let output_str: Option<String> = row.get(2)?;
            let error: Option<String> = row.get(3)?;
            let duration_ms: Option<i64> = row.get(4)?;
            let status: StepRunStatus =
                serde_json::from_value(serde_json::Value::String(status_str))
                    .unwrap_or(StepRunStatus::Pending);
            let output: Option<serde_json::Value> =
                output_str.and_then(|s| serde_json::from_str(&s).ok());
            run.step_runs.insert(
                step_id.clone(),
                StepRun {
                    step_id,
                    status,
                    output,
                    error,
                    duration_ms: duration_ms.map(|d| d as u64),
                },
            );
        }
        Ok(Some(run))
    }

    /// Hard-delete a run + its steps. Used by the History view's
    /// trash affordance. CASCADE on the FK takes care of step rows.
    pub fn delete_workflow_run(&self, run_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM workflow_runs WHERE id = ?1", params![run_id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::engine::{RunStatus, StepRun, StepRunStatus, WorkflowRun};
    use serde_json::json;

    fn make_run(id: &str, wf: &str, status: RunStatus) -> WorkflowRun {
        let mut sr = std::collections::HashMap::new();
        sr.insert(
            "validate".into(),
            StepRun {
                step_id: "validate".into(),
                status: StepRunStatus::Completed,
                output: Some(json!({"ok": true})),
                error: None,
                duration_ms: Some(123),
            },
        );
        sr.insert(
            "approval".into(),
            StepRun {
                step_id: "approval".into(),
                status: StepRunStatus::AwaitingApproval,
                output: Some(json!({"message": "please review"})),
                error: None,
                duration_ms: None,
            },
        );
        WorkflowRun {
            id: id.into(),
            workflow_id: wf.into(),
            status,
            inputs: json!({"campaign": "spring"}),
            step_runs: sr,
            error: None,
            started_at_ms: 1_700_000_000_000,
            updated_at_ms: 1_700_000_001_000,
        }
    }

    #[test]
    fn upsert_then_load_active_round_trip() {
        let db = Db::open_in_memory().unwrap();
        let r = make_run("run-1", "wf-promo", RunStatus::Paused);
        db.upsert_workflow_run(&r).unwrap();

        let active = db.load_active_workflow_runs().unwrap();
        assert_eq!(active.len(), 1);
        let got = &active[0];
        assert_eq!(got.id, "run-1");
        assert_eq!(got.workflow_id, "wf-promo");
        assert_eq!(got.status, RunStatus::Paused);
        assert_eq!(got.step_runs.len(), 2);
        assert_eq!(
            got.step_runs.get("approval").unwrap().status,
            StepRunStatus::AwaitingApproval
        );
    }

    #[test]
    fn terminal_runs_excluded_from_active_load() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_workflow_run(&make_run("done", "w", RunStatus::Completed))
            .unwrap();
        db.upsert_workflow_run(&make_run("failed", "w", RunStatus::Failed))
            .unwrap();
        db.upsert_workflow_run(&make_run("paused", "w", RunStatus::Paused))
            .unwrap();
        let active = db.load_active_workflow_runs().unwrap();
        let ids: Vec<&str> = active.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["paused"]);
    }

    #[test]
    fn upsert_replaces_step_rows() {
        let db = Db::open_in_memory().unwrap();
        let mut r = make_run("run-1", "w", RunStatus::Running);
        db.upsert_workflow_run(&r).unwrap();

        // Drop one step, mutate another; second upsert should reflect this.
        r.step_runs.remove("approval");
        if let Some(s) = r.step_runs.get_mut("validate") {
            s.duration_ms = Some(999);
        }
        db.upsert_workflow_run(&r).unwrap();

        let got = db.get_workflow_run("run-1").unwrap().unwrap();
        assert_eq!(got.step_runs.len(), 1);
        assert_eq!(got.step_runs["validate"].duration_ms, Some(999));
    }

    #[test]
    fn history_includes_terminal_runs_with_step_counts() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_workflow_run(&make_run("a", "wf", RunStatus::Completed))
            .unwrap();
        db.upsert_workflow_run(&make_run("b", "wf", RunStatus::Failed))
            .unwrap();
        let h = db.list_workflow_history(Some("wf"), 50).unwrap();
        assert_eq!(h.len(), 2);
        assert!(h.iter().all(|s| s.step_count == 2));
        assert!(h.iter().all(|s| s.completed_count == 1));
    }

    #[test]
    fn delete_cascades_to_steps() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_workflow_run(&make_run("run-1", "wf", RunStatus::Paused))
            .unwrap();
        db.delete_workflow_run("run-1").unwrap();
        assert!(db.get_workflow_run("run-1").unwrap().is_none());
        // Step rows should be gone via CASCADE.
        let conn = db.conn.lock();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workflow_step_runs WHERE run_id = ?1",
                params!["run-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
